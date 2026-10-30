// Rumus cicilan. Semua bunga/margin dalam persen per tahun.

/** Cicilan anuitas (bunga efektif, cicilan tetap per bulan). */
export function anuitas(pokok: number, bungaTahun: number, bulan: number) {
  const r = bungaTahun / 100 / 12;
  return r === 0 ? pokok / bulan : (pokok * r) / (1 - Math.pow(1 + r, -bulan));
}

/** Sisa pokok setelah k kali cicilan anuitas. */
export function sisaPokok(pokok: number, bungaTahun: number, bulan: number, k: number) {
  const r = bungaTahun / 100 / 12;
  const a = anuitas(pokok, bungaTahun, bulan);
  return r === 0 ? pokok - a * k : pokok * Math.pow(1 + r, k) - a * ((Math.pow(1 + r, k) - 1) / r);
}

/** Murabahah: harga jual = pokok + margin (flat per tahun), dicicil rata. Margin terkunci sejak akad. */
export function murabahah(pokok: number, marginTahun: number, bulan: number) {
  const total = pokok * (1 + (marginTahun / 100) * (bulan / 12));
  return { cicilan: total / bulan, total, marginRp: total - pokok };
}

/** Kebalikan anuitas: plafon yang cicilannya masih muat di kemampuan bayar. */
export function plafonDariCicilan(cicilan: number, bungaTahun: number, bulan: number) {
  const r = bungaTahun / 100 / 12;
  return r === 0 ? cicilan * bulan : (cicilan * (1 - Math.pow(1 + r, -bulan))) / r;
}

export type Skenario = {
  murabahah: { cicilan: number; total: number; margin: number };
  mengambang: { awal: number; setelah: number; total: number; bungaAwal: number; bungaBaru: number };
  kur: { cicilan: number; total: number; bunga: number };
};

/**
 * @param biRateKini    BI Rate saat ini
 * @param biRateBaru    BI Rate skenario (hasil geser slider)
 * @param spread        selisih bunga/margin bank komersial di atas BI Rate (asumsi, bukan data bank)
 * @param bulanBerubah  kredit mengambang: bulan ke berapa BI Rate berubah
 */
export function bandingkan(pokok: number, bulan: number, biRateKini: number, biRateBaru: number, spread: number, kurBunga: number, bulanBerubah = 6): Skenario {
  const mBaru = biRateBaru + spread;
  const mur = murabahah(pokok, mBaru, bulan);

  const bungaAwal = biRateKini + spread;
  const awal = anuitas(pokok, bungaAwal, bulan);
  const sisa = sisaPokok(pokok, bungaAwal, bulan, bulanBerubah);
  const setelah = anuitas(sisa, mBaru, bulan - bulanBerubah);
  const totalMeng = awal * bulanBerubah + setelah * (bulan - bulanBerubah);

  const kurC = anuitas(pokok, kurBunga, bulan);
  return {
    murabahah: { cicilan: mur.cicilan, total: mur.total, margin: mBaru },
    mengambang: { awal, setelah, total: totalMeng, bungaAwal, bungaBaru: mBaru },
    kur: { cicilan: kurC, total: kurC * bulan, bunga: kurBunga },
  };
}
