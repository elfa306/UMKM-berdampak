/**
 * Mesin aturan pesan proaktif Cashie.
 *
 * Prinsip:
 * - Setiap pesan lahir dari data aktual (transaksi, sesi harian, produksi), bukan asumsi AI.
 *   Angka yang disebut di pesan selalu berasal dari data yang sama yang disertakan di `bukti`.
 * - Fungsi ini murni (tanpa akses database/jaringan) sehingga mudah diuji.
 * - Kapan pesan boleh tampil diatur terpisah oleh lib/cashieInterrupt.ts.
 */

export type NudgeTx = {
  id: string;
  jenis: 'penjualan' | 'biaya';
  keterangan: string;
  jumlah: number;
  qty: number;
  created_at: string; // ISO timestamp
  tanggal: string;    // YYYY-MM-DD (tanggal sesi harian)
  product_id?: string | null;
};

export type NudgeInput = {
  hariIni: string;     // YYYY-MM-DD (WIB)
  jamWIB: number;      // 0–23
  menitWIB: number;    // 0–59
  profil: { jenis_usaha?: string | null; tanggal_mulai_usaha?: string | null } | null;
  /** Transaksi ±90 hari terakhir, termasuk hari ini. */
  tx: NudgeTx[];
  /** id produk → nama, untuk menamai penjualan yang terhubung ke produk. */
  namaProduk: Record<string, string>;
  /** Produk aktif yang dijual (id → nama), dipakai untuk "produk kurang laku". */
  produkDijual: Record<string, string>;
  /** Tanggal (YYYY-MM-DD) produksi selesai dalam ±8 minggu terakhir. */
  hariProduksi: string[];
};

export type NudgeKind = 'start' | 'pengeluaran' | 'produksi' | 'kondisi' | 'tutup';

export type Nudge = {
  /** Kunci topik untuk mencegah pengulangan. */
  key: string;
  kind: NudgeKind;
  /** Makin besar makin didahulukan. */
  priority: number;
  text: string;
  /** Hari minimal sebelum topik yang sama boleh diulang. */
  cooldownDays: number;
  /** Pesan yang terikat jam (mis. menjelang tutup) boleh melewati jeda antar pesan. */
  bypassGap?: boolean;
  /** Data yang menjadi dasar pesan, untuk audit dan pengujian. */
  bukti: Record<string, unknown>;
};

export const NUDGE_LIMITS = {
  usahaBaruHari: 14,
  biayaNaikPersen: 20,
  biayaNaikMinimal: 50_000,
  penjualanTurunRasio: 0.7,
  penjualanTurunMinimalHariPembanding: 6,
  produkNaikRasio: 1.3,
  produkNaikMinimalSebelumnya: 5,
  produkNaikMinimalSelisih: 3,
  biayaTakBiasaKali: 3,
  biayaTakBiasaMinimal: 100_000,
  biayaTakBiasaMinimalData: 8,
  jamTutupBawaan: 20,
  jamTutupBatasAtas: 21, // setelah ini masuk jam tenang Cashie
} as const;

// ───────────────────────── util tanggal & angka ─────────────────────────

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function geserTanggal(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function namaHari(iso: string): string {
  return HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function awalPekan(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Minggu
  return geserTanggal(iso, -((dow + 6) % 7)); // Senin
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function jamWIBDari(iso: string): number {
  const jam = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(iso));
  const [h, m] = jam.split(':').map(Number);
  return (h % 24) + m / 60;
}

const adalahManufaktur = (jenis?: string | null) => jenis === 'manufaktur' || jenis === 'campuran';

function labelProduk(t: NudgeTx, namaProduk: Record<string, string>): string {
  if (t.product_id && namaProduk[t.product_id]) return namaProduk[t.product_id];
  return t.keterangan.trim();
}

/** Kunci pengelompokan produk: id bila ada, selain itu keterangan yang dinormalkan. */
function kunciProduk(t: NudgeTx): string {
  return t.product_id ? `p:${t.product_id}` : `k:${t.keterangan.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function normalisasiBiaya(ket: string): string {
  return ket.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

type TotalProduk = { label: string; qty: number; omzet: number };

function totalPerProduk(tx: NudgeTx[], namaProduk: Record<string, string>): Map<string, TotalProduk> {
  const hasil = new Map<string, TotalProduk>();
  for (const t of tx) {
    if (t.jenis !== 'penjualan') continue;
    const kunci = kunciProduk(t);
    const cur = hasil.get(kunci) ?? { label: labelProduk(t, namaProduk), qty: 0, omzet: 0 };
    cur.qty += t.qty;
    cur.omzet += t.jumlah;
    hasil.set(kunci, cur);
  }
  return hasil;
}

const dalamRentang = (t: NudgeTx, dari: string, sampai: string) => t.tanggal >= dari && t.tanggal <= sampai;

// ───────────────────────── aturan ─────────────────────────

/** A. Awal aktivitas (dipakai sebagai sapaan pembuka hari). */
function aturanAwal(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  if (i.jamWIB >= 11) return out; // pembuka hari hanya relevan di pagi hari

  const txHariIni = i.tx.filter((t) => t.tanggal === i.hariIni);
  if (txHariIni.length > 0) return out; // sudah ada aktivitas, tidak perlu menanyakan rencana

  const mulai = i.profil?.tanggal_mulai_usaha ?? null;
  const usiaHari = mulai ? Math.round((Date.parse(`${i.hariIni}T00:00:00Z`) - Date.parse(`${mulai}T00:00:00Z`)) / 86_400_000) : null;
  const belumAdaTransaksi = i.tx.length === 0;
  if (belumAdaTransaksi || (usiaHari !== null && usiaHari >= 0 && usiaHari <= NUDGE_LIMITS.usahaBaruHari)) {
    out.push({
      key: 'start:usaha-baru', kind: 'start', priority: 90, cooldownDays: 1,
      text: 'Bagaimana persiapan usaha hari ini? Ada yang perlu kita siapkan?',
      bukti: { usiaHari, jumlahTransaksi: i.tx.length },
    });
  }

  const kemarin = geserTanggal(i.hariIni, -1);
  const txKemarin = i.tx.filter((t) => t.tanggal === kemarin && t.jenis === 'penjualan');
  if (txKemarin.length > 0) {
    const perProduk = [...totalPerProduk(txKemarin, i.namaProduk).values()].sort((a, b) => b.qty - a.qty || b.omzet - a.omzet);
    const teratas = perProduk[0];
    const total = sum(txKemarin.map((t) => t.jumlah));
    out.push({
      key: 'start:kemarin', kind: 'start', priority: 80, cooldownDays: 1,
      text: `Kemarin ${teratas.label} paling banyak terjual (${teratas.qty} terjual), total penjualan ${rp(total)}. Hari ini mau menyiapkan jumlah yang sama?`,
      bukti: { tanggal: kemarin, produk: teratas.label, qty: teratas.qty, totalPenjualan: total },
    });
  }

  out.push({
    key: 'start:rencana', kind: 'start', priority: 60, cooldownDays: 1,
    text: adalahManufaktur(i.profil?.jenis_usaha)
      ? 'Hari ini ada rencana produksi apa?'
      : 'Mau mulai dari mengecek persediaan atau menyiapkan dagangan hari ini?',
    bukti: { jenisUsaha: i.profil?.jenis_usaha ?? null },
  });
  return out;
}

/** B. Pengeluaran: biaya rutin bulanan yang belum tercatat dan pengeluaran tak biasa. */
function aturanPengeluaran(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const bulanIni = i.hariIni.slice(0, 7);
  const hariKe = Number(i.hariIni.slice(8, 10));
  const biaya = i.tx.filter((t) => t.jenis === 'biaya');

  // Biaya rutin bulanan: tercatat di ≥2 dari 3 bulan lalu (maks 2x per bulan), belum ada bulan ini.
  const grup = new Map<string, { label: string; perBulan: Map<string, number[]> }>();
  for (const t of biaya) {
    const norm = normalisasiBiaya(t.keterangan);
    if (norm.length < 3) continue;
    const bulan = t.tanggal.slice(0, 7);
    const g = grup.get(norm) ?? { label: t.keterangan.trim(), perBulan: new Map() };
    g.perBulan.set(bulan, [...(g.perBulan.get(bulan) ?? []), Number(t.tanggal.slice(8, 10))]);
    grup.set(norm, g);
  }
  const bulanLalu = [1, 2, 3].map((n) => {
    const d = new Date(`${bulanIni}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 7);
  });
  const rutin: Nudge[] = [];
  for (const [norm, g] of grup) {
    if (g.perBulan.has(bulanIni)) continue;
    const bulanAda = bulanLalu.filter((b) => g.perBulan.has(b));
    if (bulanAda.length < 2) continue;
    if (bulanAda.some((b) => (g.perBulan.get(b) ?? []).length > 2)) continue; // bukan tagihan bulanan
    const hariBiasa = Math.round(median(bulanAda.map((b) => median(g.perBulan.get(b) ?? []))));
    if (hariKe < hariBiasa) continue;
    rutin.push({
      key: `biaya-berulang:${norm.replace(/\s/g, '-').slice(0, 40)}`, kind: 'pengeluaran', priority: 70, cooldownDays: 7,
      text: `Pengeluaran “${g.label}” biasanya tercatat sekitar tanggal ${hariBiasa}. Bulan ini sudah tercatat belum?`,
      bukti: { bulanTercatat: bulanAda, tanggalBiasa: hariBiasa, hariIniTanggal: hariKe },
    });
  }
  rutin.sort((a, b) => Number((a.bukti.tanggalBiasa as number)) - Number((b.bukti.tanggalBiasa as number)));
  if (rutin[0]) out.push(rutin[0]);

  // Pengeluaran tak biasa hari ini: ≥3x median biaya 90 hari terakhir dan ≥ Rp100.000.
  const jumlahBiaya = biaya.filter((t) => t.tanggal < i.hariIni).map((t) => t.jumlah);
  if (jumlahBiaya.length >= NUDGE_LIMITS.biayaTakBiasaMinimalData) {
    const med = median(jumlahBiaya);
    const besar = biaya
      .filter((t) => t.tanggal === i.hariIni && t.jumlah >= NUDGE_LIMITS.biayaTakBiasaMinimal && t.jumlah >= med * NUDGE_LIMITS.biayaTakBiasaKali)
      .sort((a, b) => b.jumlah - a.jumlah)[0];
    if (besar) {
      out.push({
        key: `biaya-tak-biasa:${besar.id}`, kind: 'pengeluaran', priority: 75, cooldownDays: 30,
        text: `Pengeluaran “${besar.keterangan.trim()}” ${rp(besar.jumlah)} hari ini jauh di atas biasanya (nilai tengah pengeluaran ${rp(med)}). Mau kita periksa?`,
        bukti: { id: besar.id, jumlah: besar.jumlah, nilaiTengah: med, jumlahData: jumlahBiaya.length },
      });
    }
  }
  return out;
}

/** C. Produksi: kebiasaan produksi per hari dan produk yang penjualannya naik. */
function aturanProduksi(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const manufaktur = adalahManufaktur(i.profil?.jenis_usaha);

  if (i.jamWIB >= 6 && i.jamWIB < 15 && !i.hariProduksi.includes(i.hariIni)) {
    const hari = namaHari(i.hariIni);
    const serupa = [...new Set(i.hariProduksi)].filter((d) => d < i.hariIni && namaHari(d) === hari);
    if (serupa.length >= 3) {
      out.push({
        key: 'produksi-rutin', kind: 'produksi', priority: 65, cooldownDays: 1,
        text: `Biasanya hari ${hari} kamu mulai menyiapkan produksi (${serupa.length} kali dalam 8 minggu terakhir). Ada perubahan rencana?`,
        bukti: { hari, jumlah: serupa.length },
      });
    }
  }

  const akhir = i.hariIni;
  const mingguIni = i.tx.filter((t) => dalamRentang(t, geserTanggal(akhir, -6), akhir));
  const mingguLalu = i.tx.filter((t) => dalamRentang(t, geserTanggal(akhir, -13), geserTanggal(akhir, -7)));
  const ini = totalPerProduk(mingguIni, i.namaProduk);
  const lalu = totalPerProduk(mingguLalu, i.namaProduk);
  const naik = [...ini.entries()]
    .map(([k, v]) => ({ k, label: v.label, sekarang: v.qty, sebelumnya: lalu.get(k)?.qty ?? 0 }))
    .filter((p) => p.sebelumnya >= NUDGE_LIMITS.produkNaikMinimalSebelumnya
      && p.sekarang >= p.sebelumnya * NUDGE_LIMITS.produkNaikRasio
      && p.sekarang - p.sebelumnya >= NUDGE_LIMITS.produkNaikMinimalSelisih)
    .sort((a, b) => (b.sekarang - b.sebelumnya) - (a.sekarang - a.sebelumnya))[0];
  if (naik) {
    out.push({
      key: `produk-naik:${naik.k}`.slice(0, 60), kind: 'produksi', priority: 62, cooldownDays: 7,
      text: `Penjualan ${naik.label} naik dari ${naik.sebelumnya} menjadi ${naik.sekarang} dalam 7 hari terakhir. Apakah kamu ingin menambah ${manufaktur ? 'produksi' : 'stok'}?`,
      bukti: { produk: naik.label, sebelumnya: naik.sebelumnya, sekarang: naik.sekarang },
    });
  }
  return out;
}

/** D. Kondisi usaha: biaya naik, penjualan turun, produk laris/kurang laku. */
function aturanKondisi(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const akhir = i.hariIni;

  // Biaya 7 hari terakhir vs 7 hari sebelumnya.
  const biayaIni = sum(i.tx.filter((t) => t.jenis === 'biaya' && dalamRentang(t, geserTanggal(akhir, -6), akhir)).map((t) => t.jumlah));
  const biayaLalu = sum(i.tx.filter((t) => t.jenis === 'biaya' && dalamRentang(t, geserTanggal(akhir, -13), geserTanggal(akhir, -7))).map((t) => t.jumlah));
  if (biayaLalu > 0 && biayaIni >= biayaLalu * (1 + NUDGE_LIMITS.biayaNaikPersen / 100) && biayaIni - biayaLalu >= NUDGE_LIMITS.biayaNaikMinimal) {
    const persen = Math.round(((biayaIni - biayaLalu) / biayaLalu) * 100);
    out.push({
      key: 'biaya-naik', kind: 'kondisi', priority: 55, cooldownDays: 7,
      text: `Total pengeluaran 7 hari terakhir ${rp(biayaIni)}, naik ${persen}% dari ${rp(biayaLalu)} pada 7 hari sebelumnya. Mau kita lihat rinciannya?`,
      bukti: { biayaIni, biayaLalu, persen },
    });
  }

  // Penjualan 3 hari buka terakhir vs 14 hari buka sebelumnya (hari tutup tidak dihitung).
  const penjualanPerHari = new Map<string, number>();
  for (const t of i.tx) if (t.jenis === 'penjualan' && t.tanggal < i.hariIni) penjualanPerHari.set(t.tanggal, (penjualanPerHari.get(t.tanggal) ?? 0) + t.jumlah);
  const hariBuka = [...penjualanPerHari.keys()].sort().reverse();
  const terbaru = hariBuka.slice(0, 3);
  const pembanding = hariBuka.slice(3, 17);
  if (terbaru.length === 3 && pembanding.length >= NUDGE_LIMITS.penjualanTurunMinimalHariPembanding) {
    const rataBaru = sum(terbaru.map((d) => penjualanPerHari.get(d) ?? 0)) / terbaru.length;
    const rataLama = sum(pembanding.map((d) => penjualanPerHari.get(d) ?? 0)) / pembanding.length;
    if (rataLama > 0 && rataBaru <= rataLama * NUDGE_LIMITS.penjualanTurunRasio) {
      out.push({
        key: 'penjualan-turun', kind: 'kondisi', priority: 58, cooldownDays: 7,
        text: `Penjualan 3 hari buka terakhir rata-rata ${rp(rataBaru)} per hari, lebih rendah dari ${rp(rataLama)} per hari sebelumnya. Ada perubahan kondisi usaha?`,
        bukti: { hariTerbaru: terbaru, rataBaru, rataLama, hariPembanding: pembanding.length },
      });
    }
  }

  // Produk terlaris 7 hari terakhir (sekali per pekan).
  const ini = [...totalPerProduk(i.tx.filter((t) => dalamRentang(t, geserTanggal(akhir, -6), akhir)), i.namaProduk).values()]
    .sort((a, b) => b.qty - a.qty || b.omzet - a.omzet);
  if (ini.length >= 2 && ini[0].qty >= 5) {
    out.push({
      key: `terlaris:${awalPekan(akhir)}`, kind: 'kondisi', priority: 40, cooldownDays: 7,
      text: `Produk yang paling banyak terjual dalam 7 hari terakhir adalah ${ini[0].label} (${ini[0].qty} terjual).`,
      bukti: { produk: ini[0].label, qty: ini[0].qty },
    });
  }

  // Produk aktif yang sebelumnya laku tetapi 7 hari terakhir tidak terjual sama sekali.
  const terjualBaru = new Set(i.tx.filter((t) => t.jenis === 'penjualan' && t.product_id && dalamRentang(t, geserTanggal(akhir, -6), akhir)).map((t) => t.product_id as string));
  const qtyLama = new Map<string, number>();
  for (const t of i.tx) {
    if (t.jenis === 'penjualan' && t.product_id && dalamRentang(t, geserTanggal(akhir, -37), geserTanggal(akhir, -7))) {
      qtyLama.set(t.product_id, (qtyLama.get(t.product_id) ?? 0) + t.qty);
    }
  }
  const sepi = Object.entries(i.produkDijual)
    .filter(([id]) => !terjualBaru.has(id) && (qtyLama.get(id) ?? 0) >= 3)
    .sort((a, b) => (qtyLama.get(b[0]) ?? 0) - (qtyLama.get(a[0]) ?? 0))[0];
  if (sepi) {
    out.push({
      key: `kurang-laku:${sepi[0]}`, kind: 'kondisi', priority: 45, cooldownDays: 14,
      text: `${sepi[1]} belum terjual dalam 7 hari terakhir (sebelumnya terjual ${qtyLama.get(sepi[0])} dalam 30 hari). Mau kita evaluasi?`,
      bukti: { produk: sepi[1], qtySebelumnya: qtyLama.get(sepi[0]) },
    });
  }
  return out;
}

/** Perkiraan jam tutup: nilai tengah jam transaksi terakhir pada hari-hari buka terakhir. */
export function perkirakanJamTutup(tx: NudgeTx[], hariIni: string): { jam: number; dariData: boolean; jumlahHari: number } {
  const terakhirPerHari = new Map<string, number>();
  for (const t of tx) {
    if (t.tanggal >= hariIni) continue;
    const jam = jamWIBDari(t.created_at);
    terakhirPerHari.set(t.tanggal, Math.max(terakhirPerHari.get(t.tanggal) ?? 0, jam));
  }
  const hari = [...terakhirPerHari.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14).map(([, jam]) => jam);
  if (hari.length < 5) return { jam: NUDGE_LIMITS.jamTutupBawaan, dariData: false, jumlahHari: hari.length };
  const jam = Math.min(NUDGE_LIMITS.jamTutupBatasAtas, Math.max(12, Math.round(median(hari))));
  return { jam, dariData: true, jumlahHari: hari.length };
}

/** E. Menjelang dan sesudah tutup: pengingat pencatatan dan rekap harian. */
function aturanTutup(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const txHariIni = i.tx.filter((t) => t.tanggal === i.hariIni);
  if (txHariIni.length === 0) return out; // tidak ada aktivitas hari ini → tidak mengganggu

  const tutup = perkirakanJamTutup(i.tx, i.hariIni);
  const sekarang = i.jamWIB + i.menitWIB / 60;
  const penjualan = sum(txHariIni.filter((t) => t.jenis === 'penjualan').map((t) => t.jumlah));
  const nPenjualan = txHariIni.filter((t) => t.jenis === 'penjualan').length;
  const biaya = sum(txHariIni.filter((t) => t.jenis === 'biaya').map((t) => t.jumlah));
  const terakhir = Math.max(...txHariIni.map((t) => jamWIBDari(t.created_at)));
  const bukti = { jamTutup: tutup.jam, dariData: tutup.dariData, jumlahHariData: tutup.jumlahHari };

  if (sekarang >= tutup.jam - 1 && sekarang < tutup.jam) {
    out.push({
      key: 'tutup:ingatkan', kind: 'tutup', priority: 85, cooldownDays: 1, bypassGap: true,
      text: nPenjualan > 0
        ? `Sebentar lagi waktunya tutup. Hari ini tercatat ${nPenjualan} penjualan senilai ${rp(penjualan)}. Apakah semua penjualan hari ini sudah masuk?`
        : 'Sebentar lagi waktunya tutup. Hari ini belum ada penjualan tercatat. Ada transaksi yang belum dicatat?',
      bukti: { ...bukti, nPenjualan, penjualan },
    });
  }

  // Rekap: sudah lewat jam tutup (atau sudah >90 menit tanpa transaksi setelah jam tutup).
  if (sekarang >= tutup.jam && (sekarang - terakhir >= 1.5 || sekarang >= tutup.jam + 1)) {
    out.push({
      key: 'tutup:rekap', kind: 'tutup', priority: 88, cooldownDays: 1, bypassGap: true,
      text: `Sepertinya aktivitas hari ini sudah selesai. Hari ini penjualan tercatat ${rp(penjualan)} dan pengeluaran ${rp(biaya)}.`,
      bukti: { ...bukti, penjualan, biaya },
    });
  }
  return out;
}

export function buildNudges(input: NudgeInput): Nudge[] {
  return [
    ...aturanAwal(input),
    ...aturanTutup(input),
    ...aturanPengeluaran(input),
    ...aturanProduksi(input),
    ...aturanKondisi(input),
  ].sort((a, b) => b.priority - a.priority);
}
