import { summarize } from './accounting';
import { plafonDariCicilan } from './pembiayaan';
import { KUR_BUNGA } from './config';
import type { Hari } from './data';

/** Ambang penilaian. Ubah di sini bila ingin lebih longgar/ketat. */
export const SYARAT = {
  windowHari: 30,       // dihitung 30 hari kalender TERAKHIR, sampai kemarin (hari ini belum selesai)
  minHariCatat: 24,     // minimal hari berjualan yang dicatat (80%); pedagang pasar boleh libur
  minRasioUntung: 0.8,  // minimal 80% hari yang dicatat berakhir untung
  maxCV: 0.5,           // fluktuasi uang masuk harian (simpangan baku / rata-rata) maksimal 50%
  porsiCicilan: 0.3,    // cicilan wajar maksimal 30% dari untung bulanan (patokan umum, bukan aturan bank)
  tenorHitung: 24,
} as const;

export type Kelayakan = {
  hariCatat: number; hariUntung: number; totalUntung: number; rataUangMasuk: number; cv: number;
  skor: { konsistensi: number; untung: number; stabil: number; tren: number; total: number };
  layak: boolean; level: 'siap' | 'hampir' | 'mulai';
  kurang: string[];      // yang masih kurang, dalam bahasa pasar
  mampuCicil: number; plafonIndikatif: number;
  usiaCatatanHari: number;
};

const rata = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function hitungKelayakan(hari: Hari[], pertamaCatat: string | null, hariIni: string): Kelayakan {
  const rows = [...hari].sort((a, b) => a.tanggal.localeCompare(b.tanggal)).map((h) => summarize(h.modal, h.txs));
  const n = rows.length;
  const hariUntung = rows.filter((r) => r.labaBersih > 0).length;
  const totalUntung = rows.reduce((a, r) => a + r.labaBersih, 0);
  const uang = rows.map((r) => r.pendapatan);
  const mean = rata(uang);
  const sd = Math.sqrt(rata(uang.map((x) => (x - mean) ** 2)));
  const cv = mean > 0 ? sd / mean : Infinity;

  const rasio = n ? hariUntung / n : 0;
  const babak2 = rata(uang.slice(Math.floor(n / 2)));
  const babak1 = rata(uang.slice(0, Math.floor(n / 2)));
  const rasioTren = babak1 > 0 ? babak2 / babak1 : 0;

  const konsistensi = Math.min(1, n / SYARAT.minHariCatat) * 30;
  const untung = Math.min(1, rasio / SYARAT.minRasioUntung) * 30;
  const stabil = !isFinite(cv) ? 0 : cv <= SYARAT.maxCV ? 25 : Math.max(0, 25 * (1 - (cv - SYARAT.maxCV) / 0.5));
  const tren = n < 6 ? 0 : rasioTren >= 0.9 ? 15 : rasioTren >= 0.7 ? 8 : 0;
  const total = Math.round(konsistensi + untung + stabil + tren);

  const layak = n >= SYARAT.minHariCatat && rasio >= SYARAT.minRasioUntung && totalUntung > 0 && cv <= SYARAT.maxCV;
  const kurang: string[] = [];
  if (n < SYARAT.minHariCatat) kurang.push(`Catat ${SYARAT.minHariCatat - n} hari lagi (baru ${n} dari ${SYARAT.minHariCatat} hari dalam 30 hari terakhir)`);
  if (n > 0 && rasio < SYARAT.minRasioUntung) kurang.push(`Hari untung baru ${Math.round(rasio * 100)}%, targetnya ${SYARAT.minRasioUntung * 100}%`);
  if (n > 0 && totalUntung <= 0) kurang.push('Total untung 30 hari terakhir masih belum plus');
  if (n > 1 && isFinite(cv) && cv > SYARAT.maxCV) kurang.push('Uang masuk harian masih naik-turun jauh; usahakan lebih rata');

  const mampuCicil = Math.max(0, totalUntung) * SYARAT.porsiCicilan;
  const plafonIndikatif = Math.floor(plafonDariCicilan(mampuCicil, KUR_BUNGA, SYARAT.tenorHitung) / 500_000) * 500_000;
  const usiaCatatanHari = pertamaCatat
    ? Math.max(0, Math.round((new Date(hariIni + 'T12:00:00').getTime() - new Date(pertamaCatat + 'T12:00:00').getTime()) / 86_400_000))
    : 0;

  return {
    hariCatat: n, hariUntung, totalUntung, rataUangMasuk: mean, cv: isFinite(cv) ? cv : 0,
    skor: { konsistensi: Math.round(konsistensi), untung: Math.round(untung), stabil: Math.round(stabil), tren, total },
    layak, level: layak && total >= 80 ? 'siap' : total >= 55 ? 'hampir' : 'mulai',
    kurang, mampuCicil, plafonIndikatif: Math.max(0, plafonIndikatif), usiaCatatanHari,
  };
}
