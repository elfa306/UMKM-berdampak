/**
 * Pencatatan biaya bahan produksi yang sederhana: pemilik cukup mencatat pembelian bahan.
 * Tidak ada resep, takaran, jumlah hasil, atau HPP per unit. Sistem hanya membedakan
 * "biaya bahan produksi" dari "biaya operasional" supaya laporan bisa membandingkannya dengan penjualan.
 */

export type KategoriBiaya = 'bahan_produksi' | 'operasional';
export type PeriodeBiaya = 'harian' | 'bulanan';

// Biaya rutin satu periode tidak dibebankan sekaligus pada ringkasan untung harian.
const BIAYA_BULANAN = /\b(listrik|pln|token|pdam|wifi|internet|sewa|kontrakan|langganan|gas|elpiji|lpg)\b/i;

export function klasifikasiPeriodeBiaya(keterangan: string): PeriodeBiaya {
  return BIAYA_BULANAN.test(keterangan) ? 'bulanan' : 'harian';
}

export function isBiayaBulanan(row: { periode_biaya?: string | null; keterangan?: string }): boolean {
  if (row.periode_biaya === 'bulanan') return true;
  if (row.periode_biaya === 'harian') return false;
  return BIAYA_BULANAN.test(row.keterangan ?? '');
}

/** Cocokkan nama produk secara tepat. Nama tidak cocok atau duplikat yang ambigu menghasilkan null. */
export function cocokkanProdukTepat(nama: string, produk: Array<{ id: string; nama: string }>): string | null {
  const normalisasi = (value: string) => value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
  const target = normalisasi(nama);
  if (!target) return null;
  const ids = new Set(produk.filter((item) => normalisasi(item.nama) === target).map((item) => item.id));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Hanya transaksi biaya yang benar-benar diklasifikasikan sebagai bahan produksi. */
export function isConfirmedMaterialExpense(row: { jenis: string; kategori_biaya?: string | null }): boolean {
  return row.jenis === 'biaya' && row.kategori_biaya === 'bahan_produksi';
}

const OPERASIONAL = /\b(listrik|pln|token|pdam|air|wifi|internet|sewa|kontrakan|gaji|upah|pulsa|elpiji|gas|pajak|transport|bensin|parkir|servis|perbaikan|utilitas|operasional|iklan|promosi)\b/;
const BAHAN = /\b(bahan|baku|tepung|terigu|gula|telur|minyak|mentega|margarin|susu|cokelat|coklat|beras|garam|bumbu|rempah|sayur|daging|ayam|ikan|buah|kopi|teh|keju|ragi|kemasan|plastik|dus|kardus|boks|toples|stok|kulakan|belanja)\b/;

/** Mengenali jenis biaya dari keterangan. Null berarti belum jelas, sehingga Cashie boleh bertanya. */
export function klasifikasiBiaya(keterangan: string): KategoriBiaya | null {
  const text = keterangan.toLowerCase();
  if (OPERASIONAL.test(text)) return 'operasional';
  if (BAHAN.test(text)) return 'bahan_produksi';
  return null;
}

/** Pilihan kategori pada form Catat (label tetap dipakai sebagai keterangan bila pemilik tidak menulis apa pun). */
export function kategoriDariPilihan(label: string, keterangan: string): KategoriBiaya {
  const dariTeks = klasifikasiBiaya(keterangan);
  if (dariTeks === 'operasional') return 'operasional';
  return label === 'Belanja bahan baku' ? 'bahan_produksi' : 'operasional';
}

/** Menambahkan kategori ke baris biaya; baris penjualan tidak diubah. */
export function tandaiBiaya<T extends { jenis: string; keterangan: string; kategori_biaya?: KategoriBiaya }>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row.jenis !== 'biaya' || row.kategori_biaya) return row;
    const kategori = klasifikasiBiaya(row.keterangan);
    return kategori ? { ...row, kategori_biaya: kategori } : row;
  });
}

/** True bila galat database menandakan kolom relasi produk belum ada (migration v22 belum dijalankan). */
export function kolomProdukBelumAda(message?: string | null): boolean {
  return Boolean(message && /produk_terkait/i.test(message));
}

/** Membuang kolom relasi produk dari payload (untuk mengulang simpan sebelum migration v22 dijalankan). */
export function tanpaKolomProduk<T extends Record<string, unknown>>(row: T): Omit<T, 'produk_terkait' | 'produk_terkait_id'> {
  const { produk_terkait: _nama, produk_terkait_id: _id, ...sisa } = row;
  return sisa;
}

/** True bila galat database menandakan kolom kategori_biaya belum ada (migration v21 belum dijalankan). */
export function kolomKategoriBelumAda(message?: string | null): boolean {
  return Boolean(message && /kategori_biaya|produk_terkait/i.test(message));
}

/** Jawaban lisan atas "untuk bahan produksi atau operasional?". */
export function jawabanKategori(raw: string): { kategori: KategoriBiaya; produk: string | null } | null {
  const text = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const count = text.split(' ').filter(Boolean).length;
  if (!text || count > 10) return null;
  const operasional = /\b(operasional|listrik|sewa|gaji|upah|utilitas|lainnya|lain lain|bukan bahan)\b/.test(text);
  const bahan = /\b(bahan|produksi|stok|belanja|bikin|membuat|buat)\b/.test(text) && !/\bbukan bahan\b/.test(text);
  if (operasional === bahan) return null;
  if (operasional) return { kategori: 'operasional', produk: null };
  const produk = text.match(/\buntuk\s+(?:bikin\s+|membuat\s+|buat\s+)?([a-z0-9]+(?:\s[a-z0-9]+){0,2})/)?.[1] ?? null;
  const dipangkas = produk?.replace(/^(?:bahan|produksi)\s+/, '') ?? null;
  const bersih = dipangkas && !/^(bahan|produksi|usaha|jualan|dagangan)$/.test(dipangkas) ? dipangkas : null;
  return { kategori: 'bahan_produksi', produk: bersih };
}

export type BiayaPerProduk = {
  produkId: string | null;
  nama: string;
  penjualan: number;
  qtyTerjual: number;
  biayaBahanTercatat: number;
  selisih: number;
};

type BarisTransaksi = { jenis: string; jumlah: number | string; qty?: number | string | null; product_id?: string | null; kategori_biaya?: string | null; produk_terkait_id?: string | null };

/**
 * Membandingkan penjualan tiap produk dengan biaya bahan yang dicatat untuk produk itu.
 * Biaya bahan tanpa relasi produk dikumpulkan di satu baris "Belum dikaitkan ke produk".
 * Selisih = penjualan dikurangi biaya bahan tercatat (bukan laba kotor: pemakaian bahan belum dihitung).
 */
export function ringkasBiayaPerProduk(rows: BarisTransaksi[], namaProduk: Map<string, string>): BiayaPerProduk[] {
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const peta = new Map<string | null, BiayaPerProduk>();
  const ambil = (id: string | null) => {
    let item = peta.get(id);
    if (!item) {
      item = { produkId: id, nama: id === null ? 'Belum dikaitkan ke produk' : namaProduk.get(id) ?? 'Produk dihapus', penjualan: 0, qtyTerjual: 0, biayaBahanTercatat: 0, selisih: 0 };
      peta.set(id, item);
    }
    return item;
  };
  for (const row of rows) {
    if (row.jenis === 'penjualan' && row.product_id) {
      const item = ambil(row.product_id);
      item.penjualan += num(row.jumlah);
      item.qtyTerjual += row.qty == null ? 1 : num(row.qty);
    } else if (row.jenis === 'biaya' && row.kategori_biaya === 'bahan_produksi') {
      ambil(row.produk_terkait_id ?? null).biayaBahanTercatat += num(row.jumlah);
    }
  }
  return [...peta.values()]
    .map((item) => ({ ...item, selisih: item.penjualan - item.biayaBahanTercatat }))
    .sort((a, b) => (a.produkId === null ? 1 : 0) - (b.produkId === null ? 1 : 0) || b.penjualan - a.penjualan);
}
