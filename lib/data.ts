import { supabase } from './supabase';
import type { Tx } from './accounting';

export type Hari = { id: string; tanggal: string; modal: number; txs: Tx[] };

// Ambil sesi harian + transaksinya pada rentang tanggal (terbaru dulu)
export async function fetchHari(start: string, end: string): Promise<Hari[]> {
  const { data: ses, error } = await supabase
    .from('daily_sessions').select('id,tanggal,modal_harian')
    .gte('tanggal', start).lte('tanggal', end).order('tanggal', { ascending: false });
  if (error) throw new Error(error.message);
  const hari: Hari[] = (ses ?? []).map((s) => ({ id: s.id, tanggal: s.tanggal, modal: Number(s.modal_harian), txs: [] }));
  if (!hari.length) return hari;

  const byId = new Map(hari.map((h) => [h.id, h]));
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await supabase
      .from('transactions').select('*, daily_sessions!inner(tanggal)')
      .gte('daily_sessions.tanggal', start).lte('daily_sessions.tanggal', end)
      .order('created_at').range(from, from + 999);
    if (e2) throw new Error(e2.message);
    (data ?? []).forEach((r: any) => byId.get(r.session_id)?.txs.push({ ...r, jumlah: Number(r.jumlah) } as Tx));
    if ((data ?? []).length < 1000) break;
  }
  return hari;
}
