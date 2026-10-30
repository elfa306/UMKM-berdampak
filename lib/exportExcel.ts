import type ExcelJSType from 'exceljs';
import { summarize, type Tx } from './accounting';
import type { Hari } from './data';

const FMT = '_("Rp"* #,##0_);_("Rp"* (#,##0);_("Rp"* "-"??_);_(@_)';
const NAVY = 'FF0F172A', BLUE = 'FF2563EB', ZEBRA = 'FFF1F5F9', GREEN = 'FF059669', RED = 'FFDC2626';
const GREEN_BG = 'FFD1FAE5', RED_BG = 'FFFEE2E2', GREY = 'FFE2E8F0';
const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FONT = 'Calibri';

type Wb = InstanceType<typeof ExcelJSType.Workbook>;
type Ws = ReturnType<Wb['addWorksheet']>;

const waktu = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const metodeTeks = (m: Tx['metode']) => (m === 'qris' ? 'QRIS' : m === 'tunai' ? 'Tunai' : '-');

function judul(ws: Ws, cols: number, teks: string, sub: string[]) {
  const huruf = String.fromCharCode(64 + cols);
  ws.mergeCells(`A1:${huruf}1`);
  const t = ws.getCell('A1');
  t.value = teks;
  t.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 32;
  sub.forEach((s, i) => {
    ws.mergeCells(`A${i + 2}:${huruf}${i + 2}`);
    const c = ws.getCell(`A${i + 2}`);
    c.value = s;
    c.font = { name: FONT, size: 10, color: { argb: 'FF475569' }, italic: i > 0 };
    c.alignment = { indent: 1 };
  });
}

function kepala(row: ReturnType<Ws['getRow']>, cols: number) {
  row.height = 22;
  for (let i = 1; i <= cols; i++) {
    const c = row.getCell(i);
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', horizontal: i >= cols - 1 ? 'right' : 'left', indent: 1 };
    c.border = BORDER;
  }
}

function cetak(ws: Ws, landscape = false) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .2, footer: .2 } };
  ws.headerFooter.oddFooter = '&L&8Dibuat dengan UMKM Kasir&R&8Halaman &P dari &N';
  ws.views = [{ ...(ws.views?.[0] ?? {}), showGridLines: false }];
}

function tulisJurnal(ws: Ws, rows: { tanggal?: string; waktu: string; jenis: string; ket: string; qty: number; metode: string; jumlah: number }[], denganTanggal: boolean, subJudul: string[], namaUsaha: string) {
  const cols = denganTanggal ? 8 : 7;
  judul(ws, cols, `${namaUsaha.toUpperCase()} · JURNAL TRANSAKSI`, subJudul);
  const hdr = ws.getRow(5);
  const heads = denganTanggal ? ['Tanggal', 'No', 'Waktu', 'Jenis', 'Keterangan', 'Qty', 'Metode', 'Jumlah'] : ['No', 'Waktu', 'Jenis', 'Keterangan', 'Qty', 'Metode', 'Jumlah'];
  heads.forEach((h, i) => (hdr.getCell(i + 1).value = h));
  kepala(hdr, cols);
  const w = denganTanggal ? [12, 6, 9, 12, 38, 6, 10, 20] : [6, 9, 12, 38, 6, 10, 20];
  w.forEach((x, i) => (ws.getColumn(i + 1).width = x));

  rows.forEach((r, i) => {
    const vals = denganTanggal ? [r.tanggal, i + 1, r.waktu, r.jenis, r.ket, r.qty, r.metode, r.jumlah] : [i + 1, r.waktu, r.jenis, r.ket, r.qty, r.metode, r.jumlah];
    const row = ws.addRow(vals);
    const masuk = r.jenis === 'Penjualan';
    row.eachCell((c, n) => {
      c.font = { name: FONT, size: 10 };
      c.border = BORDER;
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      if (n === cols) { c.numFmt = FMT; c.font = { name: FONT, size: 10, bold: true, color: { argb: masuk ? GREEN : RED } }; }
      if (n === cols - 1 || (denganTanggal ? n === 2 : n === 1)) c.alignment = { horizontal: 'center' };
    });
  });
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + Math.max(rows.length, 1), column: cols } };
  cetak(ws, denganTanggal);
}

/* ---------------------------------- HARIAN ---------------------------------- */
export type OptsHarian = { namaUsaha: string; tanggal: string; modal: number; txs: Tx[] };

export async function buatWorkbookHarian({ namaUsaha, tanggal, modal, txs }: OptsHarian) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UMKM Kasir';
  wb.created = new Date();
  const s = summarize(modal, txs);
  const lr = wb.addWorksheet('Laba Rugi');
  const jr = wb.addWorksheet('Jurnal');

  const rowsJ = [
    { waktu: '', jenis: 'HPP', ket: 'Modal harian (belanja bahan)', qty: 1, metode: '-', jumlah: modal },
    ...txs.map((t) => ({ waktu: waktu(t.created_at), jenis: t.jenis === 'penjualan' ? 'Penjualan' : 'Beban', ket: t.keterangan, qty: t.qty, metode: metodeTeks(t.metode), jumlah: t.jumlah })),
  ];
  // Jurnal tanpa kolom tanggal: kolom C = Jenis, F = Metode, G = Jumlah (dipakai rumus di bawah)
  tulisJurnal(jr, rowsJ, false, [`Tanggal: ${tanggal}`, 'Bukti pencatatan harian'], namaUsaha);

  const f = (jenis: string, metode?: string) =>
    `SUMIFS(Jurnal!$G:$G,Jurnal!$C:$C,"${jenis}"${metode ? `,Jurnal!$F:$F,"${metode}"` : ''})`;
  lr.columns = [{ width: 46 }, { width: 26 }];
  judul(lr, 2, `${namaUsaha.toUpperCase()}`, [`LAPORAN LABA RUGI HARIAN · Tanggal: ${tanggal}`]);
  lr.addRow([]);

  const bagian = (teks: string) => {
    const r = lr.addRow([teks]);
    lr.mergeCells(`A${r.number}:B${r.number}`);
    r.getCell(1).font = { name: FONT, bold: true, color: { argb: NAVY } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    r.getCell(1).border = BORDER;
  };
  const baris = (label: string, formula: string, result: number, o: { tebal?: boolean; warna?: string; bg?: string } = {}) => {
    const r = lr.addRow([label, { formula, result }]);
    r.height = o.tebal ? 22 : 18;
    r.eachCell((c) => {
      c.border = BORDER;
      c.font = { name: FONT, size: o.tebal ? 11 : 10, bold: !!o.tebal, color: { argb: o.warna ?? 'FF1E293B' } };
      if (o.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.bg } };
    });
    r.getCell(2).numFmt = FMT;
    r.getCell(1).alignment = { indent: o.tebal ? 0 : 1 };
    return r.number;
  };

  bagian('PENDAPATAN (Uang Masuk)');
  const rT = baris('Penjualan tunai', f('Penjualan', 'Tunai'), s.tunai);
  const rQ = baris('Penjualan QRIS', f('Penjualan', 'QRIS'), s.qris);
  const rP = baris('Total Pendapatan', `B${rT}+B${rQ}`, s.pendapatan, { tebal: true });
  bagian('BIAYA');
  const rH = baris('Harga Pokok Penjualan (Modal Belanja Bahan)', f('HPP'), s.hpp);
  const rK = baris('LABA KOTOR', `B${rP}-B${rH}`, s.labaKotor, { tebal: true });
  const rB = baris('Beban operasional (Biaya Lain: gas, plastik, parkir)', f('Beban'), s.beban);
  lr.addRow([]);
  const untung = s.labaBersih >= 0;
  const rN = baris('LABA (RUGI) BERSIH  /  UNTUNG BERSIH', `B${rK}-B${rB}`, s.labaBersih, { tebal: true, warna: untung ? GREEN : RED, bg: untung ? GREEN_BG : RED_BG });
  lr.getRow(rN).getCell(2).border = { top: thin, left: thin, right: thin, bottom: { style: 'double', color: { argb: NAVY } } };
  lr.addRow([]);
  const cat = lr.addRow(['Catatan: disusun berdasarkan dasar kas harian. Modal harian dicatat seluruhnya sebagai HPP; persediaan bahan baku yang belum terpakai tidak dipisahkan.']);
  lr.mergeCells(`A${cat.number}:B${cat.number}`);
  cat.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  cat.getCell(1).font = { name: FONT, size: 9, italic: true, color: { argb: 'FF64748B' } };
  cat.height = 42;
  cetak(lr);
  return wb;
}

/* ---------------------------------- PERIODE ---------------------------------- */
export type OptsPeriode = { namaUsaha: string; start: string; end: string; hari: Hari[] };

export async function buatWorkbookPeriode({ namaUsaha, start, end, hari }: OptsPeriode) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UMKM Kasir';
  wb.created = new Date();
  const urut = [...hari].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const rk = wb.addWorksheet('Ringkasan');
  const jr = wb.addWorksheet('Jurnal');

  // Jurnal dengan kolom Tanggal: A=Tanggal, D=Jenis, G=Metode, H=Jumlah
  const rowsJ = urut.flatMap((h) => [
    { tanggal: h.tanggal, waktu: '', jenis: 'HPP', ket: 'Modal harian (belanja bahan)', qty: 1, metode: '-', jumlah: h.modal },
    ...h.txs.map((t) => ({ tanggal: h.tanggal, waktu: waktu(t.created_at), jenis: t.jenis === 'penjualan' ? 'Penjualan' : 'Beban', ket: t.keterangan, qty: t.qty, metode: metodeTeks(t.metode), jumlah: t.jumlah })),
  ]);
  tulisJurnal(jr, rowsJ, true, [`Periode: ${start} s.d. ${end}`, 'Bukti pencatatan seluruh transaksi'], namaUsaha);

  judul(rk, 8, `${namaUsaha.toUpperCase()} · LAPORAN USAHA`, [`Periode: ${start} s.d. ${end}`, 'Setiap angka dihitung dari sheet Jurnal sehingga bisa diperiksa ulang.']);
  const heads = ['Tanggal', 'Modal Belanja (HPP)', 'Jual Tunai', 'Jual QRIS', 'Uang Masuk', 'Biaya Lain', 'Untung Bersih', 'Status'];
  const hdr = rk.getRow(5);
  heads.forEach((h, i) => (hdr.getCell(i + 1).value = h));
  kepala(hdr, 8);
  [13, 20, 16, 16, 17, 16, 18, 13].forEach((w, i) => (rk.getColumn(i + 1).width = w));

  const sif = (tgl: string, jenis: string, metode?: string) =>
    `SUMIFS(Jurnal!$H:$H,Jurnal!$A:$A,"${tgl}",Jurnal!$D:$D,"${jenis}"${metode ? `,Jurnal!$G:$G,"${metode}"` : ''})`;

  urut.forEach((h, i) => {
    const s = summarize(h.modal, h.txs);
    const n = 6 + i;
    const row = rk.addRow([
      h.tanggal,
      { formula: sif(h.tanggal, 'HPP'), result: s.hpp },
      { formula: sif(h.tanggal, 'Penjualan', 'Tunai'), result: s.tunai },
      { formula: sif(h.tanggal, 'Penjualan', 'QRIS'), result: s.qris },
      { formula: `C${n}+D${n}`, result: s.pendapatan },
      { formula: sif(h.tanggal, 'Beban'), result: s.beban },
      { formula: `E${n}-B${n}-F${n}`, result: s.labaBersih },
      { formula: `IF(G${n}>0,"Untung",IF(G${n}<0,"Rugi","Balik Modal"))`, result: s.labaBersih > 0 ? 'Untung' : s.labaBersih < 0 ? 'Rugi' : 'Balik Modal' },
    ]);
    row.eachCell((c, k) => {
      c.border = BORDER; c.font = { name: FONT, size: 10 };
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      if (k >= 2 && k <= 7) c.numFmt = FMT;
    });
    const untung = s.labaBersih >= 0;
    row.getCell(7).font = { name: FONT, size: 10, bold: true, color: { argb: untung ? GREEN : RED } };
    row.getCell(8).font = { name: FONT, size: 10, bold: true, color: { argb: untung ? GREEN : RED } };
    row.getCell(8).alignment = { horizontal: 'center' };
  });

  const awal = 6, akhir = 5 + urut.length;
  const tot = summarize(0, []);
  const total = urut.reduce((a, h) => { const s = summarize(h.modal, h.txs); return { hpp: a.hpp + s.hpp, tunai: a.tunai + s.tunai, qris: a.qris + s.qris, beban: a.beban + s.beban, laba: a.laba + s.labaBersih }; }, { hpp: 0, tunai: 0, qris: 0, beban: 0, laba: 0 });
  void tot;
  const kolom = ['B', 'C', 'D', 'E', 'F', 'G'];
  const hasil = [total.hpp, total.tunai, total.qris, total.tunai + total.qris, total.beban, total.laba];
  const tr = rk.addRow(['TOTAL', ...kolom.map((k, i) => ({ formula: urut.length ? `SUM(${k}${awal}:${k}${akhir})` : '0', result: hasil[i] })), `${urut.length} hari`]);
  tr.height = 24;
  tr.eachCell((c, k) => {
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.border = BORDER;
    if (k >= 2 && k <= 7) c.numFmt = FMT;
    if (k === 8) c.alignment = { horizontal: 'center' };
  });
  rk.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  cetak(rk, true);
  return wb;
}

/* -------------------------------- UNDUH FILE -------------------------------- */
async function unduh(wb: Wb, nama: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nama;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function exportExcel(o: OptsHarian) { await unduh(await buatWorkbookHarian(o), `Laporan-${o.tanggal}.xlsx`); }
export async function exportExcelPeriode(o: OptsPeriode) { await unduh(await buatWorkbookPeriode(o), `Laporan-${o.start}_sd_${o.end}.xlsx`); }
