import { supabase } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tx } from './accounting';

export type Hari = { id: string; tanggal: string; modal: number; txs: Tx[] };

/** Dipakai route server: client berisi token pengguna (RLS tetap berlaku) beserta ID pengguna. */
export type FetchHariSource = { client: SupabaseClient; userId: string };

// Ambil sesi harian + transaksi + HPP dari jurnal akuntansi pada rentang tanggal.
// Tanpa `source`, memakai client browser dan pengguna yang sedang login (perilaku lama).
export async function fetchHari(start: string, end: string, source?: FetchHariSource): Promise<Hari[]> {
  const db = source?.client ?? supabase;
  let userId = source?.userId;
  if (!userId) {
    const { data: authData } = await supabase.auth.getUser();
    userId = authData.user?.id;
  }
  if (!userId) return [];

  const { data: ses, error } = await db
    .from('daily_sessions')
    .select('id,tanggal,modal_harian')
    .eq('user_id', userId)
    .gte('tanggal', start)
    .lte('tanggal', end)
    .order('tanggal', { ascending: false });
  if (error) throw new Error(error.message);
  const hari: Hari[] = (ses ?? []).map((s) => ({ id: s.id, tanggal: s.tanggal, modal: Number(s.modal_harian), txs: [] }));
  if (!hari.length) return hari;

  const byId = new Map(hari.map((h) => [h.id, h]));
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await db
      .from('transactions')
      .select('*, daily_sessions!inner(tanggal)')
      .eq('user_id', userId)
      .gte('daily_sessions.tanggal', start)
      .lte('daily_sessions.tanggal', end)
      .order('created_at')
      .range(from, from + 999);
    if (e2) throw new Error(e2.message);
    (data ?? []).forEach((r: any) => byId.get(r.session_id)?.txs.push({ ...r, jumlah: Number(r.jumlah) } as Tx));
    if ((data ?? []).length < 1000) break;
  }

  // Untuk sesi baru (modal_harian = 0), gunakan HPP dari jurnal akun 5000/5100.
  // Catatan modal_harian historis tetap dipertahankan sebagai fallback untuk data lama.
  const entryDates = new Map<string, string>();
  const entryIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: entryError } = await db
      .from('journal_entries')
      .select('id,entry_date')
      .eq('user_id', userId)
      .gte('entry_date', start)
      .lte('entry_date', end)
      .order('entry_date')
      .range(from, from + 999);
    if (entryError) throw new Error(entryError.message);
    (data ?? []).forEach((entry) => {
      entryIds.push(entry.id);
      entryDates.set(entry.id, entry.entry_date);
    });
    if ((data ?? []).length < 1000) break;
  }

  const hppPerTanggal = new Map<string, number>();
  for (let i = 0; i < entryIds.length; i += 200) {
    const ids = entryIds.slice(i, i + 200);
    const { data, error: lineError } = await db
      .from('journal_lines')
      .select('entry_id,debit,credit')
      .eq('user_id', userId)
      .in('entry_id', ids)
      .in('account_code', ['5000', '5100']);
    if (lineError) throw new Error(lineError.message);
    (data ?? []).forEach((line) => {
      const tanggal = entryDates.get(line.entry_id);
      if (!tanggal) return;
      hppPerTanggal.set(tanggal, (hppPerTanggal.get(tanggal) ?? 0) + Number(line.debit) - Number(line.credit));
    });
  }

  for (const item of hari) {
    const hppJurnal = hppPerTanggal.get(item.tanggal) ?? 0;
    if (item.modal <= 0 && hppJurnal > 0) item.modal = hppJurnal;
  }
  return hari;
}
