// Pemetaan produk dagangan -> bahan baku pokok.
// Dipakai sebagai kamus cadangan bila Gemini belum diisi / gagal, dan sebagai tipe bersama.

export type Bahan = { nama: string; kueri: string }; // kueri = kata kunci pencarian harga
export type PetaBahan = { produk: string; bahan: Bahan[] }[];

const B = (nama: string, kueri: string): Bahan => ({ nama, kueri });

const KAMUS: { cocok: RegExp; bahan: Bahan[] }[] = [
  { cocok: /nasi goreng|nasgor|nasi uduk|nasi/i, bahan: [B('Beras', 'beras premium 5 kg'), B('Bawang Merah', 'bawang merah 1 kg'), B('Cabai Merah', 'cabai merah 1 kg'), B('Minyak Goreng', 'minyak goreng 2 liter'), B('Telur', 'telur ayam 1 kg')] },
  { cocok: /mie|bakmi|mi ayam/i, bahan: [B('Tepung Terigu', 'tepung terigu 1 kg'), B('Daging Ayam', 'daging ayam 1 kg'), B('Bawang Putih', 'bawang putih 1 kg'), B('Kecap Manis', 'kecap manis 600 ml')] },
  { cocok: /es teh|teh/i, bahan: [B('Teh Celup', 'teh celup 25 kantong'), B('Gula Pasir', 'gula pasir 1 kg')] },
  { cocok: /kopi|latte|cappuccino/i, bahan: [B('Kopi Bubuk', 'kopi bubuk 200 gram'), B('Gula Pasir', 'gula pasir 1 kg'), B('Susu Kental Manis', 'susu kental manis 370 gram')] },
  { cocok: /bakwan|gorengan|tahu|tempe|pisang goreng|cireng|risol/i, bahan: [B('Tepung Terigu', 'tepung terigu 1 kg'), B('Minyak Goreng', 'minyak goreng 2 liter'), B('Bawang Putih', 'bawang putih 1 kg')] },
  { cocok: /ayam goreng|ayam geprek|ayam/i, bahan: [B('Daging Ayam', 'daging ayam 1 kg'), B('Minyak Goreng', 'minyak goreng 2 liter'), B('Cabai Rawit', 'cabai rawit 1 kg'), B('Tepung Bumbu', 'tepung bumbu serbaguna 200 gram')] },
  { cocok: /bakso|soto|sop/i, bahan: [B('Daging Sapi', 'daging sapi 1 kg'), B('Tepung Tapioka', 'tepung tapioka 500 gram'), B('Bawang Putih', 'bawang putih 1 kg')] },
  { cocok: /sate/i, bahan: [B('Daging Ayam', 'daging ayam 1 kg'), B('Kacang Tanah', 'kacang tanah 1 kg'), B('Kecap Manis', 'kecap manis 600 ml')] },
  { cocok: /roti|kue|donat|brownies|bolu/i, bahan: [B('Tepung Terigu', 'tepung terigu 1 kg'), B('Gula Pasir', 'gula pasir 1 kg'), B('Telur', 'telur ayam 1 kg'), B('Margarin', 'margarin 200 gram')] },
  { cocok: /sambal|pecel|gado|lotek/i, bahan: [B('Cabai Merah', 'cabai merah 1 kg'), B('Bawang Merah', 'bawang merah 1 kg'), B('Kacang Tanah', 'kacang tanah 1 kg')] },
  { cocok: /jus|susu|boba|minuman|es /i, bahan: [B('Gula Pasir', 'gula pasir 1 kg'), B('Susu Kental Manis', 'susu kental manis 370 gram')] },
];

export const bahanStatis = (produk: string): Bahan[] => KAMUS.find((k) => k.cocok.test(produk))?.bahan ?? [];

export type BahanGabung = { bahan: Bahan; produk: string[] };

// Gabungkan bahan yang sama dari banyak produk; bahan yang dipakai paling banyak produk di urutan atas
export function gabungBahan(peta: PetaBahan): BahanGabung[] {
  const m = new Map<string, BahanGabung>();
  for (const p of peta) {
    for (const b of p.bahan) {
      const k = b.nama.trim().toLowerCase();
      const x = m.get(k) ?? { bahan: b, produk: [] };
      if (!x.produk.includes(p.produk)) x.produk.push(p.produk);
      m.set(k, x);
    }
  }
  return [...m.values()].sort((a, b) => b.produk.length - a.produk.length);
}

// Harga "wajar": median setelah membuang harga yang terlalu jauh (aksesori, paket besar, dll.)
export function hargaWajar(harga: number[]): { median: number; min: number; jumlah: number } | null {
  const h = harga.filter((x) => x > 0).sort((a, b) => a - b);
  if (h.length < 2) return h.length === 1 ? { median: h[0], min: h[0], jumlah: 1 } : null;
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const m0 = med(h);
  const bersih = h.filter((x) => x >= m0 * 0.4 && x <= m0 * 2.5);
  return { median: Math.round(med(bersih)), min: bersih[0], jumlah: bersih.length };
}
