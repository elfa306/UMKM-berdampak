export type Product = { id: string; nama: string; harga: number };
export type Tx = {
  id: string;
  jenis: 'penjualan' | 'biaya';
  keterangan: string;
  jumlah: number;
  qty: number;
  metode: 'tunai' | 'qris' | null;
  created_at: string;
};

export const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

// Tanggal hari ini (YYYY-MM-DD) di zona WIB
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

/**
 * Pemetaan "Dual-View":
 * - Modal harian  -> HPP (pembelian bahan baku hari itu)
 * - Transaksi 'penjualan' -> Pendapatan (tunai / QRIS)
 * - Transaksi 'biaya' -> Beban operasional
 * Posisi layar depan = labaBersih; dimulai dari -modal, impas saat 0.
 */
export function summarize(modal: number, txs: Tx[]) {
  const sum = (f: (t: Tx) => boolean) => txs.filter(f).reduce((a, t) => a + t.jumlah, 0);
  const tunai = sum((t) => t.jenis === 'penjualan' && t.metode === 'tunai');
  const qris = sum((t) => t.jenis === 'penjualan' && t.metode === 'qris');
  const pendapatan = tunai + qris;
  const hpp = modal;
  const labaKotor = pendapatan - hpp;
  const beban = sum((t) => t.jenis === 'biaya');
  const labaBersih = labaKotor - beban;
  const totalBiaya = hpp + beban;
  const progress = totalBiaya > 0 ? Math.min(100, Math.round((pendapatan / totalBiaya) * 100)) : 0;
  return { tunai, qris, pendapatan, hpp, labaKotor, beban, labaBersih, totalBiaya, progress };
}

// ---- Helper tampilan & input ----
export const angka = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/\D/g, ''));
const d12 = (iso: string) => new Date(iso + 'T12:00:00');
export const tglPendek = (iso: string) =>
  d12(iso).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const tglPanjang = (iso: string) =>
  d12(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const labaLabel = (n: number) => (n > 0 ? 'Untung' : n < 0 ? 'Rugi' : 'Balik Modal');

// Rupiah dengan tanda untuk daftar mutasi: +Rp 15.000 / -Rp 4.000
export const rupiahTanda = (n: number, masuk: boolean) => `${masuk ? '+' : '-'}${rupiah(Math.abs(n))}`;
// Format ringkas untuk sumbu grafik: 1,5 rb / 2 jt
export const rupiahRingkas = (n: number) =>
  new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const PALET = ['#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#8b5cf6', '#0ea5e9', '#f43f5e', '#14b8a6', '#fb923c', '#6366f1'];
