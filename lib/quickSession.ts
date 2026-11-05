import { supabase } from './supabase';

/** Satu baris transaksi yang baru dicatat lewat modal Catat Transaksi. */
export type QuickSavedRow = {
  id: string;
  jenis: 'penjualan' | 'biaya';
  keterangan: string;
  jumlah: number;
  metode: 'tunai' | 'qris' | null;
  qty: number;
  created_at: string;
  payment_source?: string;
};

/** Dikirim lewat event "cava:transaction-saved" supaya beranda ikut memperbarui datanya. */
export type QuickSavedDetail = {
  /** true bila tercatat di Mode Tamu (tidak ada database); beranda menambahkan barisnya langsung. */
  guest: boolean;
  rows: QuickSavedRow[];
};

export const TRANSACTION_SAVED_EVENT = 'cava:transaction-saved';
export const OPEN_CATAT_EVENT = 'cava:open-catat';

/** Buka modal Catat Transaksi dari mana saja (modalnya dipasang di BottomNav). */
export function bukaCatatTransaksi(opts: { type?: 'masuk' | 'keluar'; metode?: 'tunai' | 'qris' } = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CATAT_EVENT, { detail: opts }));
}

export function announceTransactionSaved(detail?: QuickSavedDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TRANSACTION_SAVED_EVENT, { detail }));
}

/** Produk contoh untuk Mode Tamu (sama dengan yang tampil di beranda). */
export const SAMPLE_PRODUCTS = [
  { id: 'sample-1', nama: 'Kopi Cava Latte', harga: 18000 },
  { id: 'sample-2', nama: 'Roti Bakar Kaya', harga: 15000 },
  { id: 'sample-3', nama: 'Gula Pasir Kristal', harga: 17500 },
];

/** Ambil sesi harian untuk tanggal ini; dibuat (modal 0) bila belum ada. */
export async function ensureTodaySession(tanggal: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('daily_sessions')
    .select('id')
    .eq('tanggal', tanggal)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from('daily_sessions')
    .insert({ tanggal, modal_harian: 0 })
    .select('id')
    .single();
  if (error || !created) {
    // Bisa saja sesi baru dibuat dari perangkat lain di saat yang sama.
    const { data: again } = await supabase.from('daily_sessions').select('id').eq('tanggal', tanggal).maybeSingle();
    return (again?.id as string | undefined) ?? null;
  }
  return created.id as string;
}
