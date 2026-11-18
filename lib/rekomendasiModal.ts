/**
 * Logika rekomendasi modal/pembiayaan yang dipakai asisten suara (server).
 *
 * CATATAN: daftar lembaga dan rumusnya sama dengan yang ada di app/pembiayaan/page.tsx
 * (data simulasi). Bila daftar lembaga atau aturan di halaman itu diubah, ubah juga di sini
 * agar jawaban Cashie tetap sama dengan yang tampil di halaman.
 */
import { anuitas } from './pembiayaan';
import type { ProfilRekomendasi } from './rekomendasiProfile';

// Cicilan dianggap aman bila tidak lebih dari 30% untung bulanan.
export const BATAS_RASIO_CICILAN = 0.3;

export type Risiko = 'rendah' | 'sedang' | 'tinggi';

export type BankSimulasi = {
  id: string;
  nama: string;
  jenis: string;
  plafonMin: number;
  plafonMax: number;
  tenorBulan: number;
  hitungBunga: (biRate: number) => number; // % per tahun
  basisBunga: string;
  minUsiaBulan: number;
  minOmzetHarian: number;
  prosesHari: number;
  agunan: boolean;
  risiko: Risiko;
};

export const BANK_SIMULASI: BankSimulasi[] = [
  {
    id: 'kur-bri', nama: 'KUR BRI', jenis: 'Bank · Subsidi pemerintah',
    plafonMin: 1_000_000, plafonMax: 100_000_000, tenorBulan: 36,
    hitungBunga: () => 6, basisBunga: 'Tetap 6%',
    minUsiaBulan: 6, minOmzetHarian: 100_000, prosesHari: 7, agunan: false, risiko: 'rendah',
  },
  {
    id: 'bprs-amanah', nama: 'BPRS Amanah', jenis: 'BPR Syariah',
    plafonMin: 2_000_000, plafonMax: 50_000_000, tenorBulan: 24,
    hitungBunga: (bi) => bi + 2, basisBunga: 'BI Rate + 2%',
    minUsiaBulan: 3, minOmzetHarian: 150_000, prosesHari: 5, agunan: false, risiko: 'rendah',
  },
  {
    id: 'bpr-sejahtera', nama: 'BPR Sejahtera', jenis: 'Bank perkreditan rakyat',
    plafonMin: 5_000_000, plafonMax: 75_000_000, tenorBulan: 24,
    hitungBunga: (bi) => bi + 3.5, basisBunga: 'BI Rate + 3,5%',
    minUsiaBulan: 12, minOmzetHarian: 500_000, prosesHari: 10, agunan: true, risiko: 'sedang',
  },
  {
    id: 'kop-makmur', nama: 'Koperasi Makmur', jenis: 'Koperasi simpan pinjam',
    plafonMin: 1_000_000, plafonMax: 25_000_000, tenorBulan: 18,
    hitungBunga: (bi) => bi + 4, basisBunga: 'BI Rate + 4%',
    minUsiaBulan: 3, minOmzetHarian: 100_000, prosesHari: 3, agunan: false, risiko: 'sedang',
  },
  {
    id: 'pinjol-kilat', nama: 'Pinjol Kilat', jenis: 'Fintech pinjaman online',
    plafonMin: 500_000, plafonMax: 20_000_000, tenorBulan: 6,
    hitungBunga: (bi) => bi + 10, basisBunga: 'BI Rate + 10%',
    minUsiaBulan: 0, minOmzetHarian: 0, prosesHari: 1, agunan: false, risiko: 'tinggi',
  },
];

const rupiahTeks = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export type SkorKesehatan = {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D';
  komponen: { label: string; nilai: number; maks: number }[];
};

export function hitungSkorKesehatan(p: ProfilRekomendasi): SkorKesehatan {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const komponen = [
    { label: 'Margin untung', maks: 30, nilai: clamp(p.marginUntung / 0.3) * 30 },
    { label: 'Rajin mencatat', maks: 25, nilai: clamp(p.hariDicatat30 / 30) * 25 },
    { label: 'Omzet stabil', maks: 25, nilai: clamp(1 - p.fluktuasiOmzet / 0.5) * 25 },
    { label: 'Usia usaha', maks: 20, nilai: clamp(p.usiaUsahaBulan / 12) * 20 },
  ].map((k) => ({ ...k, nilai: Math.round(k.nilai) }));
  const total = komponen.reduce((a, k) => a + k.nilai, 0);
  const grade = total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D';
  return { total, grade, komponen };
}

export type HasilRekomendasi = {
  bank: BankSimulasi;
  bunga: number;
  pinjaman: number;
  cicilanBulan: number;
  cicilanHari: number;
  rasio: number; // cicilan / untung bulanan
  layak: boolean;
  alasan: string[]; // alasan bila tidak layak
  skor: number;
};

const RISIKO_PENALTI: Record<Risiko, number> = { rendah: 0, sedang: 5, tinggi: 20 };

export function hitungRekomendasi(p: ProfilRekomendasi, banks: BankSimulasi[], biRate: number): HasilRekomendasi[] {
  const untungBulan = p.omzetHarian * p.marginUntung * p.hariBukaPerBulan;

  return banks
    .map((bank) => {
      const bunga = bank.hitungBunga(biRate);
      const pinjaman = Math.min(p.kebutuhanModal, bank.plafonMax);
      const cicilanBulan = anuitas(pinjaman, bunga, bank.tenorBulan);
      const rasio = untungBulan > 0 ? cicilanBulan / untungBulan : 1;

      const alasan: string[] = [];
      if (p.usiaUsahaBulan < bank.minUsiaBulan) alasan.push(`Usaha minimal ${bank.minUsiaBulan} bulan`);
      if (p.omzetHarian < bank.minOmzetHarian) alasan.push(`Omzet harian minimal ${rupiahTeks(bank.minOmzetHarian)}`);
      if (p.kebutuhanModal < bank.plafonMin) alasan.push(`Plafon minimal ${rupiahTeks(bank.plafonMin)}`);
      if (rasio > BATAS_RASIO_CICILAN) alasan.push(`Cicilan ${Math.round(rasio * 100)}% dari untung (batas aman ${BATAS_RASIO_CICILAN * 100}%)`);

      const skor = Math.max(0, Math.round(
        100
        - (bunga - 6) * 4
        - RISIKO_PENALTI[bank.risiko]
        - (bank.agunan ? 5 : 0)
        + (bank.prosesHari <= 2 ? 5 : 0),
      ));

      return { bank, bunga, pinjaman, cicilanBulan, cicilanHari: cicilanBulan / 30, rasio, layak: alasan.length === 0, alasan, skor };
    })
    .sort((a, b) => Number(b.layak) - Number(a.layak) || b.skor - a.skor || a.bunga - b.bunga);
}
