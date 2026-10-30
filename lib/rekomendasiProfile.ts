import { summarize } from './accounting';
import type { Hari } from './data';
import { todayISO } from './accounting';

/** Profil yang dipakai mesin rekomendasi modal. */
export type ProfilRekomendasi = {
  nama: string;
  omzetHarian: number;
  marginUntung: number;
  hariBukaPerBulan: number;
  usiaUsahaBulan: number;
  hariDicatat30: number;
  fluktuasiOmzet: number;
  kebutuhanModal: number;
};

export type ProfilUsahaDB = {
  nama_usaha: string;
  tanggal_mulai_usaha: string;
  hari_buka_per_bulan: number;
  kebutuhan_modal: number | string;
};

/** Mengubah catatan kasir 30 hari terakhir menjadi input rekomendasi. */
export function buatProfilRekomendasi(
  dataProfil: ProfilUsahaDB,
  hari: Hari[],
  namaFallback = 'Usaha Saya',
): ProfilRekomendasi {
  const ringkasan = hari.map((h) => summarize(h.modal, h.txs));
  const totalOmzet = ringkasan.reduce((total, r) => total + r.pendapatan, 0);
  const totalUntung = ringkasan.reduce((total, r) => total + r.labaBersih, 0);
  const omzetHarian = hari.length ? totalOmzet / hari.length : 0;
  const marginUntung = totalOmzet > 0 ? Math.max(0, totalUntung / totalOmzet) : 0;

  // Koefisien variasi (simpangan baku / rata-rata) untuk mengukur kestabilan omzet.
  const omzetPerHari = ringkasan.map((r) => r.pendapatan);
  const rataOmzet = omzetPerHari.length
    ? omzetPerHari.reduce((total, nilai) => total + nilai, 0) / omzetPerHari.length
    : 0;
  const varians = omzetPerHari.length
    ? omzetPerHari.reduce((total, nilai) => total + (nilai - rataOmzet) ** 2, 0) / omzetPerHari.length
    : 0;
  const fluktuasiOmzet = omzetPerHari.length < 2 || rataOmzet <= 0
    ? 1
    : Math.sqrt(varians) / rataOmzet;

  const hariIni = new Date(`${todayISO()}T00:00:00Z`);
  const mulai = new Date(`${dataProfil.tanggal_mulai_usaha}T00:00:00Z`);
  let usiaUsahaBulan = (hariIni.getUTCFullYear() - mulai.getUTCFullYear()) * 12
    + hariIni.getUTCMonth() - mulai.getUTCMonth();
  if (hariIni.getUTCDate() < mulai.getUTCDate()) usiaUsahaBulan -= 1;
  usiaUsahaBulan = Math.max(0, usiaUsahaBulan);

  return {
    nama: dataProfil.nama_usaha?.trim() || namaFallback,
    omzetHarian,
    marginUntung,
    hariBukaPerBulan: Number(dataProfil.hari_buka_per_bulan),
    usiaUsahaBulan,
    hariDicatat30: hari.length,
    fluktuasiOmzet,
    kebutuhanModal: Number(dataProfil.kebutuhan_modal),
  };
}
