// Satu tempat untuk "bahasa pasar". Ubah di sini, semua halaman ikut berubah.
export const ISTILAH = {
  labaBersih: 'Untung Bersih',
  labaSementara: 'Untung bersih sementara',
  modal: 'Modal Belanja',
  pendapatan: 'Uang Masuk',
  beban: 'Biaya Lain',
  bebanKet: 'Biaya lain (gas, plastik, parkir)',
  tunai: 'Jual Tunai',
  qris: 'Jual QRIS',
  bep: 'Target Balik Modal',
} as const;

// Teks utama kartu saldo di layar Kasir
export const teksBalikModal = (labaBersih: number, rupiahFn: (n: number) => string) =>
  labaBersih < 0 ? `Kurang ${rupiahFn(-labaBersih)} lagi biar Balik Modal!` : ISTILAH.labaSementara;
