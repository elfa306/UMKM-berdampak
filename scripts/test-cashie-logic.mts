import assert from 'node:assert/strict';
import { parseOperatingHours } from '../lib/jamOperasional';
import { klasifikasiBiaya, jawabanKategori, kategoriDariPilihan } from '../lib/biayaBahan';
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
t('pilihan form bahan baku', () => assert.equal(kategoriDariPilihan('Belanja bahan baku', ''), 'bahan_produksi'));
t('pilihan form bahan baku tapi teks listrik', () => assert.equal(kategoriDariPilihan('Belanja bahan baku', 'listrik'), 'operasional'));

// Jawaban kategori
t('jawab "bahan produksi"', () => assert.equal(jawabanKategori('bahan produksi')?.kategori, 'bahan_produksi'));
t('jawab "untuk bikin kue"', () => { const r = jawabanKategori('untuk bikin kue'); assert.equal(r?.kategori, 'bahan_produksi'); assert.equal(r?.produk, 'kue'); });
t('jawab "operasional"', () => assert.equal(jawabanKategori('operasional')?.kategori, 'operasional'));
t('jawab ambigu = null', () => assert.equal(jawabanKategori('hmm entah'), null));
t('jawab kalimat panjang = null', () => assert.equal(jawabanKategori('tadi saya pergi ke pasar lalu bertemu teman lama dan ngobrol cukup lama sekali'), null));
t('jawab kosong = null', () => assert.equal(jawabanKategori(''), null));
t('jawab "bukan bahan" = operasional', () => assert.equal(jawabanKategori('bukan bahan')?.kategori, 'operasional'));

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

console.log(`\nLolos ${pass}, gagal ${fail}`);
process.exit(fail ? 1 : 0);
