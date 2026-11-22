// Uji aturan pesan proaktif Cashie: npx tsx scripts/test-cashie-nudges.ts
import assert from 'node:assert/strict';
import { buildNudges, geserTanggal, perkirakanJamTutup, type NudgeInput, type NudgeTx } from '../lib/cashieNudges';

const HARI_INI = '2026-11-23'; // Senin
let n = 0;
const tx = (o: Partial<NudgeTx> & { tanggal: string }): NudgeTx => ({
  id: `t${++n}`, jenis: 'penjualan', keterangan: 'Kue', jumlah: 10_000, qty: 1,
  created_at: `${o.tanggal}T08:00:00Z`, product_id: null, ...o,
});
const base = (over: Partial<NudgeInput> = {}): NudgeInput => ({
  hariIni: HARI_INI, jamWIB: 8, menitWIB: 0, profil: { jenis_usaha: 'manufaktur', tanggal_mulai_usaha: '2025-01-01' },
  tx: [], namaProduk: {}, produkDijual: {}, hariProduksi: [], ...over,
});
const keys = (i: NudgeInput) => buildNudges(i).map((x) => x.key);
let lulus = 0;
const uji = (nama: string, fn: () => void) => { fn(); lulus += 1; console.log('✓', nama); };

uji('pagi tanpa aktivitas & manufaktur → tanya rencana produksi', () => {
  const r = buildNudges(base({ tx: [tx({ tanggal: geserTanggal(HARI_INI, -5) })] }));
  assert.equal(r.find((x) => x.key === 'start:rencana')?.text, 'Hari ini ada rencana produksi apa?');
});
uji('pagi non-manufaktur → tanya persediaan', () => {
  const r = buildNudges(base({ profil: { jenis_usaha: 'retail', tanggal_mulai_usaha: '2025-01-01' }, tx: [tx({ tanggal: geserTanggal(HARI_INI, -5) })] }));
  assert.match(r.find((x) => x.key === 'start:rencana')!.text, /persediaan/);
});
uji('usaha baru (belum ada transaksi) → persiapan usaha', () => {
  assert.ok(keys(base()).includes('start:usaha-baru'));
});
uji('penjualan kemarin → menyebut produk teratas dan total dari data', () => {
  const kemarin = geserTanggal(HARI_INI, -1);
  const r = buildNudges(base({ tx: [
    tx({ tanggal: kemarin, keterangan: 'Kue', qty: 5, jumlah: 50_000 }),
    tx({ tanggal: kemarin, keterangan: 'Roti', qty: 2, jumlah: 30_000 }),
  ] })).find((x) => x.key === 'start:kemarin')!;
  assert.match(r.text, /Kue paling banyak terjual \(5 terjual\), total penjualan Rp80\.000/);
});
uji('sudah ada transaksi hari ini → tidak ada pesan pembuka', () => {
  const r = keys(base({ tx: [tx({ tanggal: HARI_INI })] }));
  assert.ok(!r.some((k) => k.startsWith('start:')));
});
uji('siang hari → tidak ada pesan pembuka', () => {
  assert.ok(!keys(base({ jamWIB: 13 })).some((k) => k.startsWith('start:')));
});
uji('biaya listrik bulanan belum tercatat bulan ini', () => {
  const r = buildNudges(base({ jamWIB: 12, hariIni: '2026-11-23', tx: [
    tx({ tanggal: '2026-10-20', jenis: 'biaya', keterangan: 'Listrik', jumlah: 200_000 }),
    tx({ tanggal: '2026-09-21', jenis: 'biaya', keterangan: 'Listrik', jumlah: 200_000 }),
    tx({ tanggal: '2026-11-22' }),
  ] })).find((x) => x.key.startsWith('biaya-berulang'));
  assert.ok(r); assert.match(r!.text, /Listrik.*tanggal 21/);
});
uji('biaya listrik sudah tercatat bulan ini → diam', () => {
  const r = keys(base({ jamWIB: 12, tx: [
    tx({ tanggal: '2026-10-20', jenis: 'biaya', keterangan: 'Listrik' }),
    tx({ tanggal: '2026-09-21', jenis: 'biaya', keterangan: 'Listrik' }),
    tx({ tanggal: '2026-11-05', jenis: 'biaya', keterangan: 'Listrik' }),
  ] }));
  assert.ok(!r.some((k) => k.startsWith('biaya-berulang')));
});
uji('belanja harian (sering) tidak dianggap tagihan bulanan', () => {
  const harian = ['01', '02', '03', '04'].map((d) => tx({ tanggal: `2026-10-${d}`, jenis: 'biaya', keterangan: 'Belanja pasar' }));
  const harian2 = ['01', '02', '03', '04'].map((d) => tx({ tanggal: `2026-09-${d}`, jenis: 'biaya', keterangan: 'Belanja pasar' }));
  assert.ok(!keys(base({ jamWIB: 12, tx: [...harian, ...harian2] })).some((k) => k.startsWith('biaya-berulang')));
});
uji('pengeluaran tak biasa hari ini', () => {
  const lama = Array.from({ length: 10 }, (_, i) => tx({ tanggal: geserTanggal(HARI_INI, -(i + 1)), jenis: 'biaya', keterangan: 'Bahan', jumlah: 50_000 }));
  const besar = tx({ tanggal: HARI_INI, jenis: 'biaya', keterangan: 'Beli oven', jumlah: 600_000 });
  const r = buildNudges(base({ jamWIB: 12, tx: [...lama, besar] })).find((x) => x.key.startsWith('biaya-tak-biasa'));
  assert.ok(r); assert.match(r!.text, /Beli oven.*Rp600\.000.*Rp50\.000/);
});
uji('data biaya terlalu sedikit → tidak menuduh tak biasa', () => {
  const r = keys(base({ jamWIB: 12, tx: [tx({ tanggal: HARI_INI, jenis: 'biaya', jumlah: 600_000 })] }));
  assert.ok(!r.some((k) => k.startsWith('biaya-tak-biasa')));
});
uji('produk naik ≥30% → tawarkan tambah produksi', () => {
  const lalu = Array.from({ length: 6 }, () => tx({ tanggal: geserTanggal(HARI_INI, -10), keterangan: 'Kue' }));
  const ini = Array.from({ length: 9 }, () => tx({ tanggal: geserTanggal(HARI_INI, -2), keterangan: 'Kue' }));
  const r = buildNudges(base({ jamWIB: 12, tx: [...lalu, ...ini] })).find((x) => x.key.startsWith('produk-naik'));
  assert.ok(r); assert.match(r!.text, /naik dari 6 menjadi 9.*menambah produksi/);
});
uji('biaya 7 hari naik >20% dan ≥Rp50.000', () => {
  const r = buildNudges(base({ jamWIB: 12, tx: [
    tx({ tanggal: geserTanggal(HARI_INI, -9), jenis: 'biaya', jumlah: 100_000 }),
    tx({ tanggal: geserTanggal(HARI_INI, -2), jenis: 'biaya', jumlah: 200_000 }),
  ] })).find((x) => x.key === 'biaya-naik');
  assert.ok(r); assert.match(r!.text, /Rp200\.000.*naik 100%.*Rp100\.000/);
});
uji('penjualan 3 hari buka terakhir turun dibanding 14 hari sebelumnya', () => {
  const lama = Array.from({ length: 10 }, (_, i) => tx({ tanggal: geserTanggal(HARI_INI, -(i + 5)), jumlah: 100_000 }));
  const baru = [1, 2, 3].map((d) => tx({ tanggal: geserTanggal(HARI_INI, -d), jumlah: 40_000 }));
  const r = buildNudges(base({ jamWIB: 12, tx: [...lama, ...baru] })).find((x) => x.key === 'penjualan-turun');
  assert.ok(r); assert.match(r!.text, /Rp40\.000.*Rp100\.000/);
});
uji('hari tutup (tanpa transaksi) tidak dianggap penjualan turun', () => {
  // Buka Senin–Sabtu, tutup Minggu: tidak boleh ada kesan penurunan.
  const hari = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13].map((d) => tx({ tanggal: geserTanggal(HARI_INI, -d), jumlah: 100_000 }));
  assert.ok(!keys(base({ jamWIB: 12, tx: hari })).includes('penjualan-turun'));
});
uji('produk kurang laku (aktif, laku sebelumnya, 0 minggu ini)', () => {
  const lama = Array.from({ length: 4 }, () => tx({ tanggal: geserTanggal(HARI_INI, -20), product_id: 'p1', keterangan: 'Brownies' }));
  const r = buildNudges(base({ jamWIB: 12, tx: lama, produkDijual: { p1: 'Brownies' } })).find((x) => x.key.startsWith('kurang-laku'));
  assert.ok(r); assert.match(r!.text, /Brownies belum terjual dalam 7 hari/);
});
uji('produksi rutin: biasanya Senin produksi tapi hari ini belum', () => {
  const senin = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26'];
  const r = buildNudges(base({ jamWIB: 9, hariProduksi: senin, tx: [tx({ tanggal: geserTanggal(HARI_INI, -3) })] })).find((x) => x.key === 'produksi-rutin');
  assert.ok(r); assert.match(r!.text, /hari Senin/);
});
uji('jam tutup diperkirakan dari data (nilai tengah transaksi terakhir)', () => {
  const hari = Array.from({ length: 7 }, (_, i) => tx({ tanggal: geserTanggal(HARI_INI, -(i + 1)), created_at: `${geserTanggal(HARI_INI, -(i + 1))}T12:30:00Z` })); // 19.30 WIB
  const r = perkirakanJamTutup(hari, HARI_INI);
  assert.equal(r.dariData, true); assert.equal(r.jam, 20);
});
uji('jam tutup bawaan 20.00 bila data kurang', () => {
  assert.deepEqual(perkirakanJamTutup([], HARI_INI), { jam: 20, dariData: false, jumlahHari: 0 });
});
uji('menjelang tutup: ingatkan dengan angka hari ini', () => {
  const r = buildNudges(base({ jamWIB: 19, menitWIB: 30, tx: [tx({ tanggal: HARI_INI, jumlah: 75_000, created_at: `${HARI_INI}T10:00:00Z` })] })).find((x) => x.key === 'tutup:ingatkan');
  assert.ok(r); assert.match(r!.text, /1 penjualan senilai Rp75\.000/); assert.equal(r!.bypassGap, true);
});
uji('setelah tutup: rekap harian penjualan & pengeluaran', () => {
  const r = buildNudges(base({ jamWIB: 21, menitWIB: 0, tx: [
    tx({ tanggal: HARI_INI, jumlah: 150_000, created_at: `${HARI_INI}T09:00:00Z` }),
    tx({ tanggal: HARI_INI, jenis: 'biaya', jumlah: 40_000, created_at: `${HARI_INI}T09:30:00Z` }),
  ] })).find((x) => x.key === 'tutup:rekap');
  assert.ok(r); assert.match(r!.text, /penjualan tercatat Rp150\.000 dan pengeluaran Rp40\.000/);
});
uji('tidak ada aktivitas hari ini → tidak ada pesan tutup', () => {
  assert.ok(!keys(base({ jamWIB: 19, menitWIB: 30, tx: [tx({ tanggal: geserTanggal(HARI_INI, -1) })] })).some((k) => k.startsWith('tutup:')));
});
uji('hasil terurut menurut prioritas', () => {
  const r = buildNudges(base());
  for (let i = 1; i < r.length; i += 1) assert.ok(r[i - 1].priority >= r[i].priority);
});
console.log(`\n${lulus} skenario lulus`);
