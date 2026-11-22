/**
 * Pencatatan biaya bahan produksi yang sederhana: pemilik cukup mencatat pembelian bahan.
 * Tidak ada resep, takaran, jumlah hasil, atau HPP per unit. Sistem hanya membedakan
 * "biaya bahan produksi" dari "biaya operasional" supaya laporan bisa membandingkannya dengan penjualan.
 */

export type KategoriBiaya = 'bahan_produksi' | 'operasional';

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
