import assert from 'node:assert/strict';
import { parseOperatingHours } from '../lib/jamOperasional';
import { klasifikasiBiaya, klasifikasiPeriodeBiaya, isBiayaBulanan, jawabanKategori, kategoriDariPilihan, ringkasBiayaPerProduk, kolomProdukBelumAda, tanpaKolomProduk, cocokkanProdukTepat, isConfirmedMaterialExpense } from '../lib/biayaBahan';
import { summarize } from '../lib/accounting';
import { extractPlan, planReply } from '../lib/cashieMemory';
import { matchLocalExport } from '../lib/cashieIntents';

let pass = 0, fail = 0;
const t = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log('GAGAL:', name, '\n  ', (e as Error).message.split('\n')[0]); } };

// Klasifikasi biaya
t('tepung = bahan', () => assert.equal(klasifikasiBiaya('beli tepung dan gula'), 'bahan_produksi'));
t('listrik = operasional', () => assert.equal(klasifikasiBiaya('bayar listrik'), 'operasional'));
t('token listrik = operasional (bukan bahan)', () => assert.equal(klasifikasiBiaya('beli token listrik'), 'operasional'));
t('tidak jelas = null', () => assert.equal(klasifikasiBiaya('pengeluaran lain'), null));
t('gas elpiji = operasional', () => assert.equal(klasifikasiBiaya('isi gas elpiji'), 'operasional'));
t('listrik dan gas dikenali sebagai biaya bulanan', () => {
  assert.equal(klasifikasiPeriodeBiaya('bayar listrik bulan ini'), 'bulanan');
  assert.equal(klasifikasiPeriodeBiaya('beli gas elpiji 3 kg'), 'bulanan');
});
t('pengeluaran harian tidak salah diklasifikasikan sebagai bulanan', () => {
  assert.equal(klasifikasiPeriodeBiaya('parkir pasar'), 'harian');
  assert.equal(isBiayaBulanan({ keterangan: 'isi gas' }), true);
  assert.equal(isBiayaBulanan({ periode_biaya: 'harian', keterangan: 'bayar listrik' }), false);
});
t('pilihan form bahan baku', () => assert.equal(kategoriDariPilihan('Belanja bahan baku', ''), 'bahan_produksi'));
t('pilihan form bahan baku tapi teks listrik', () => assert.equal(kategoriDariPilihan('Belanja bahan baku', 'listrik'), 'operasional'));

// Regresi untung harian: tagihan bulanan tetap menjadi kas keluar, tetapi tidak
// dipotong seluruhnya dari laba harian. Biaya harian tetap dikurangkan.
t('untung harian mengecualikan tagihan bulanan tetapi tetap mencatat total uang keluar', () => {
  const summary = summarize(0, [
    { id: 'sale', jenis: 'penjualan', keterangan: 'Kopi', jumlah: 100000, qty: 1, metode: 'tunai', created_at: '2026-11-22T09:00:00Z' },
    { id: 'electricity', jenis: 'biaya', keterangan: 'Bayar listrik bulan ini', jumlah: 30000, qty: 1, metode: null, created_at: '2026-11-22T10:00:00Z' },
    { id: 'gas', jenis: 'biaya', keterangan: 'Beli gas 3 kg', jumlah: 25000, qty: 1, metode: null, created_at: '2026-11-22T10:10:00Z' },
    { id: 'parking', jenis: 'biaya', keterangan: 'Parkir belanja', jumlah: 5000, qty: 1, metode: null, created_at: '2026-11-22T10:20:00Z' },
  ]);
  assert.equal(summary.beban, 5000);
  assert.equal(summary.totalPengeluaran, 60000);
  assert.equal(summary.labaBersih, 95000);
});

// Jawaban kategori
t('jawab "bahan produksi"', () => assert.equal(jawabanKategori('bahan produksi')?.kategori, 'bahan_produksi'));
t('jawab "untuk bikin kue"', () => { const r = jawabanKategori('untuk bikin kue'); assert.equal(r?.kategori, 'bahan_produksi'); assert.equal(r?.produk, 'kue'); });
t('jawab "operasional"', () => assert.equal(jawabanKategori('operasional')?.kategori, 'operasional'));
t('jawab ambigu = null', () => assert.equal(jawabanKategori('hmm entah'), null));
t('jawab kalimat panjang = null', () => assert.equal(jawabanKategori('tadi saya pergi ke pasar lalu bertemu teman lama dan ngobrol cukup lama sekali'), null));
t('jawab kosong = null', () => assert.equal(jawabanKategori(''), null));
t('jawab "bukan bahan" = operasional', () => assert.equal(jawabanKategori('bukan bahan')?.kategori, 'operasional'));

// Relasi produk penjualan dan pengeluaran bahan
const katalogUji = [{ id: 'kue-1', nama: 'Kue Cokelat' }, { id: 'roti-1', nama: 'Roti Keju' }];
t('produk hanya terhubung dengan nama katalog yang sama persis', () => assert.equal(cocokkanProdukTepat(' kue   cokelat ', katalogUji), 'kue-1'));
t('produk yang tidak ditemukan tidak ditebak dari sebagian nama', () => assert.equal(cocokkanProdukTepat('kue', katalogUji), null));
t('nama produk duplikat dianggap ambigu', () => assert.equal(cocokkanProdukTepat('Kue Cokelat', [...katalogUji, { id: 'kue-2', nama: 'kue cokelat' }]), null));
t('hanya biaya terkonfirmasi bahan produksi menyelesaikan rencana beli bahan', () => {
  assert.equal(isConfirmedMaterialExpense({ jenis: 'biaya', kategori_biaya: 'bahan_produksi' }), true);
  assert.equal(isConfirmedMaterialExpense({ jenis: 'biaya', kategori_biaya: 'operasional' }), false);
  assert.equal(isConfirmedMaterialExpense({ jenis: 'biaya' }), false);
  assert.equal(isConfirmedMaterialExpense({ jenis: 'penjualan', kategori_biaya: 'bahan_produksi' }), false);
});

// Jam operasional
t('jam buka 7 tutup 8 malam', () => { const r = parseOperatingHours('buka jam 7 pagi tutup jam 8 malam'); assert.deepEqual(r, { buka: '07:00', tutup: '20:00' }); });
t('jam tutup saja', () => { const r = parseOperatingHours('tutupnya jam 9 malam'); assert.equal(r?.tutup, '21:00'); });
t('teks tak relevan = null', () => assert.equal(parseOperatingHours('halo apa kabar'), null));

// Rencana
const today = '2026-11-22';
t('rencana beli bahan besok', () => { const r = extractPlan('besok saya mau beli bahan', today); assert.equal(r?.kind, 'beli_bahan'); });
t('rencana varian baru', () => { const r = extractPlan('saya ingin mencoba varian baru', today); assert.equal(r?.kind, 'varian'); });
t('bukan rencana = null', () => assert.equal(extractPlan('terima kasih', today), null));
t('balasan sudah', () => assert.equal(planReply('sudah kok'), 'done'));
t('balasan batal', () => assert.equal(planReply('tidak jadi'), 'drop'));
t('balasan belum', () => assert.equal(planReply('belum, nanti ya'), 'keep'));
t('balasan acak = null', () => assert.equal(planReply('berapa penjualan saya'), null));


// Regresi laporan masuk dari uji langsung pengguna
t('"buka laporan dan ekspor excel" = buka + unduh bulan ini', () => assert.deepEqual(matchLocalExport('buka Laporan dan ekspor Excel', today), { month: '2026-11', openReport: true }));
t('"ekspor excel" saja = unduh tanpa buka halaman', () => assert.deepEqual(matchLocalExport('ekspor excel', today), { month: '2026-11', openReport: false }));
t('"unduh laporan bulan lalu"', () => assert.equal(matchLocalExport('unduh laporan bulan lalu', today)?.month, '2026-10'));
t('bulan lalu saat Januari = Desember tahun lalu', () => assert.equal(matchLocalExport('unduh laporan bulan lalu', '2027-01-05')?.month, '2026-12'));
t('bulan spesifik diserahkan ke AI', () => assert.equal(matchLocalExport('ekspor laporan bulan agustus', today), null));
t('"buka laporan" saja bukan ekspor', () => assert.equal(matchLocalExport('buka laporan', today), null));
t('"catat beli bahan" bukan ekspor', () => assert.equal(matchLocalExport('catat beli bahan', today), null));
t('"besok saya mau beli bahan" = rencana kuat', () => { const r = extractPlan('besok saya mau beli bahan', today); assert.equal(r?.kind, 'beli_bahan'); assert.equal(r?.strong, true); });
t('"saya mau beli bahan" = rencana lemah (tetap ke AI)', () => assert.equal(extractPlan('saya mau beli bahan', today)?.strong, false));
t('"mau catat pembelian bahan" bukan rencana', () => assert.equal(extractPlan('saya mau catat pembelian bahan', today), null));
t('"tolong bukakan form beli bahan" bukan rencana', () => assert.equal(extractPlan('besok tolong bukakan form beli bahan', today), null));

// Biaya bahan per produk (migration v22)
const contohTransaksi = [
  { jenis: 'penjualan', jumlah: 50000, qty: 2, product_id: 'kue' },
  { jenis: 'penjualan', jumlah: '30000', product_id: 'kue' },
  { jenis: 'biaya', jumlah: 250000, kategori_biaya: 'bahan_produksi', produk_terkait_id: 'kue' },
  { jenis: 'biaya', jumlah: 40000, kategori_biaya: 'bahan_produksi' },
  { jenis: 'biaya', jumlah: 99000, kategori_biaya: 'operasional' },
];
t('ringkasan per produk: penjualan, qty, biaya, selisih', () => {
  const kue = ringkasBiayaPerProduk(contohTransaksi, new Map([['kue', 'Kue']])).find((h) => h.produkId === 'kue');
  assert.deepEqual(kue && [kue.penjualan, kue.qtyTerjual, kue.biayaBahanTercatat, kue.selisih], [80000, 3, 250000, -170000]);
});
t('biaya bahan tanpa produk masuk baris terpisah di akhir, operasional tidak ikut', () => {
  const hasil = ringkasBiayaPerProduk(contohTransaksi, new Map([['kue', 'Kue']]));
  assert.equal(hasil.length, 2);
  assert.equal(hasil[1].produkId, null);
  assert.equal(hasil[1].biayaBahanTercatat, 40000);
});


t('galat kolom produk dikenali (migration v22 belum dijalankan)', () => {
  assert.equal(kolomProdukBelumAda('column "produk_terkait_id" of relation "transactions" does not exist'), true);
  assert.equal(kolomProdukBelumAda("Could not find the 'kategori_biaya' column"), false);
});
t('tanpaKolomProduk membuang relasi produk dan menyisakan lainnya', () => {
  const hasil = tanpaKolomProduk({ jenis: 'biaya', jumlah: 1, kategori_biaya: 'bahan_produksi', produk_terkait: 'Kue', produk_terkait_id: 'x' });
  assert.deepEqual(hasil, { jenis: 'biaya', jumlah: 1, kategori_biaya: 'bahan_produksi' });
});

console.log(`\nLolos ${pass}, gagal ${fail}`);
process.exit(fail ? 1 : 0);
