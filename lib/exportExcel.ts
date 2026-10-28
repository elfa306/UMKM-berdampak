import { summarize, type Tx } from './accounting';

const FMT = '_("Rp"* #,##0_);_("Rp"* (#,##0);_("Rp"* "-"??_);_(@_)';

type Opts = { namaUsaha: string; tanggal: string; modal: number; txs: Tx[] };

export async function exportExcel({ namaUsaha, tanggal, modal, txs }: Opts) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UMKM Kasir';
  const s = summarize(modal, txs);

  const lr = wb.addWorksheet('Laba Rugi');
  const jr = wb.addWorksheet('Jurnal');

  // ---------- Sheet Jurnal (bukti pencatatan) ----------
  jr.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Waktu', key: 'waktu', width: 10 },
    { header: 'Jenis', key: 'jenis', width: 12 },
    { header: 'Keterangan', key: 'ket', width: 36 },
    { header: 'Qty', key: 'qty', width: 6 },
    { header: 'Metode', key: 'metode', width: 10 },
    { header: 'Jumlah', key: 'jumlah', width: 20 },
  ];
  jr.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  jr.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

  const waktu = (iso: string) =>
    new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  jr.addRow({ no: 1, waktu: '', jenis: 'HPP', ket: 'Modal harian (bahan baku)', qty: 1, metode: '-', jumlah: modal });
  txs.forEach((t, i) =>
    jr.addRow({
      no: i + 2,
      waktu: waktu(t.created_at),
      jenis: t.jenis === 'penjualan' ? 'Penjualan' : 'Beban',
      ket: t.keterangan,
      qty: t.qty,
      metode: t.metode === 'qris' ? 'QRIS' : t.metode === 'tunai' ? 'Tunai' : '-',
      jumlah: t.jumlah,
    })
  );
  jr.getColumn('jumlah').numFmt = FMT;

  // ---------- Sheet Laba Rugi (rumus merujuk ke Jurnal agar bisa diaudit) ----------
  const f = (jenis: string, metode?: string) =>
    `SUMIFS(Jurnal!$G:$G,Jurnal!$C:$C,"${jenis}"${metode ? `,Jurnal!$F:$F,"${metode}"` : ''})`;

  lr.columns = [{ width: 44 }, { width: 24 }];
  lr.addRow([namaUsaha.toUpperCase()]).font = { bold: true, size: 14 };
  lr.addRow(['LAPORAN LABA RUGI HARIAN']).font = { bold: true };
  lr.addRow([`Tanggal: ${tanggal}`]);
  lr.addRow([]);

  const line = (label: string, formula: string, result: number, bold = false) => {
    const r = lr.addRow([label, { formula, result }]);
    r.getCell(2).numFmt = FMT;
    if (bold) r.font = { bold: true };
    return r.number;
  };
  lr.addRow(['PENDAPATAN']).font = { bold: true };
  const rTunai = line('   Penjualan tunai', f('Penjualan', 'Tunai'), s.tunai);
  const rQris = line('   Penjualan QRIS', f('Penjualan', 'QRIS'), s.qris);
  const rPend = line('Total Pendapatan', `B${rTunai}+B${rQris}`, s.pendapatan, true);
  const rHpp = line('Harga Pokok Penjualan (bahan baku)', f('HPP'), s.hpp);
  const rKotor = line('LABA KOTOR', `B${rPend}-B${rHpp}`, s.labaKotor, true);
  const rBeban = line('Beban operasional', f('Beban'), s.beban);
  const rBersih = line('LABA (RUGI) BERSIH', `B${rKotor}-B${rBeban}`, s.labaBersih, true);
  lr.getRow(rBersih).border = { top: { style: 'thin' }, bottom: { style: 'double' } };

  lr.addRow([]);
  lr.addRow(['Catatan: disusun berdasarkan dasar kas harian. Modal harian dicatat seluruhnya sebagai HPP; persediaan bahan baku yang belum terpakai tidak dipisahkan.']).alignment = { wrapText: true };
  lr.mergeCells(`A${lr.rowCount}:B${lr.rowCount}`);
  lr.getRow(lr.rowCount).height = 48;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Laporan-${tanggal}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
