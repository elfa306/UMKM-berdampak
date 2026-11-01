import { NextResponse } from 'next/server';
import { getOwnerContext } from '@/lib/ownerApi.server';
import { getOwnerLedgerSnapshot } from '@/lib/ledgerSnapshot.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BusinessType = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
type JournalEntry = { id: string; entry_no: string; source_type: string; entry_date: string; description: string; created_at: string };
type JournalLine = { entry_id: string; account_code: string; account_name: string; account_type: string; description: string | null; debit: number | string; credit: number | string };
type TrialRow = { code: string; name: string; type: string; debit: number; credit: number; balance: number };

const money = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const BUSINESS_LABEL: Record<BusinessType, string> = {
  retail: 'Retail / Perdagangan', manufaktur: 'Manufaktur / Produksi', jasa: 'Jasa', campuran: 'Campuran',
};
const LEGAL_LABEL: Record<string, string> = {
  perorangan: 'Usaha perorangan', pt_perorangan: 'Perseroan perorangan', cv: 'CV', pt: 'PT', koperasi: 'Koperasi', lainnya: 'Lainnya / belum ditentukan',
};
const SOURCE_LABEL: Record<string, string> = {
  transaction: 'Kasir / transaksi', stock_purchase_item: 'Pembelian persediaan', inventory_movement: 'Mutasi persediaan',
  production_batch: 'Produksi', sale_order: 'Penjualan POS demo', manual: 'Jurnal manual',
};

function rangeFor(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Format bulan tidak valid.');
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endExclusive = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return { start, endExclusive };
}

async function fetchAllEntries(admin: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>['admin'], userId: string, start: string, endExclusive: string) {
  const rows: JournalEntry[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from('journal_entries')
      .select('id,entry_no,source_type,entry_date,description,created_at')
      .eq('user_id', userId).gte('entry_date', start).lt('entry_date', endExclusive)
      .order('entry_date', { ascending: true }).order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Gagal membaca jurnal bulanan: ${error.message}`);
    rows.push(...((data ?? []) as JournalEntry[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchAllLines(admin: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>['admin'], userId: string, entryIds: string[]) {
  const result: JournalLine[] = [];
  for (let start = 0; start < entryIds.length; start += 100) {
    const ids = entryIds.slice(start, start + 100);
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin.from('journal_lines')
        .select('entry_id,account_code,account_name,account_type,description,debit,credit')
        .eq('user_id', userId).in('entry_id', ids)
        .order('account_code', { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw new Error(`Gagal membaca rincian jurnal: ${error.message}`);
      result.push(...((data ?? []) as JournalLine[]));
      if (!data || data.length < pageSize) break;
    }
  }
  return result;
}

function addHeading(ws: any, title: string, subtitle: string, columns = 4) {
  ws.mergeCells(1, 1, 1, columns);
  const heading = ws.getCell(1, 1);
  heading.value = title;
  heading.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12352B' } };
  heading.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, columns);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF475569' } };
  ws.getRow(2).height = 22;
}

function addSection(ws: any, row: number, label: string, columns = 2) {
  ws.mergeCells(row, 1, row, columns);
  const cell = ws.getCell(row, 1);
  cell.value = label;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5B49' } };
  return row + 1;
}

function styleTableHeader(row: any) {
  row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });
}

function styleDataRows(ws: any, startRow: number, endRow: number, moneyColumns: number[] = []) {
  for (let r = startRow; r <= endRow; r += 1) {
    const row = ws.getRow(r);
    row.eachCell((cell: any, col: number) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1E293B' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      if (r % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      if (moneyColumns.includes(col)) cell.numFmt = '"Rp" #,##0;[Red]("Rp" #,##0);-';
    });
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Sesi login tidak ditemukan. Silakan masuk kembali.' }, { status: 401 });
    const url = new URL(request.url);
    const month = url.searchParams.get('month') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
    const { start, endExclusive } = rangeFor(month);

    const [{ data: profile, error: profileError }, snapshot, entries] = await Promise.all([
      ctx.admin.from('business_profiles')
        .select('nama_usaha,jenis_usaha,bentuk_usaha,bidang_usaha,memiliki_persediaan,metode_pembayaran')
        .eq('user_id', ctx.user.id).maybeSingle(),
      getOwnerLedgerSnapshot(ctx.admin, ctx.user.id, month),
      fetchAllEntries(ctx.admin, ctx.user.id, start, endExclusive),
    ]);
    if (profileError) throw new Error(`Profil usaha gagal dibaca: ${profileError.message}`);
    const lines = await fetchAllLines(ctx.admin, ctx.user.id, entries.map((entry) => entry.id));

    const kind = (['retail', 'manufaktur', 'jasa', 'campuran'].includes(String(profile?.jenis_usaha)) ? profile?.jenis_usaha : 'campuran') as BusinessType;
    const name = String(profile?.nama_usaha || ctx.user.user_metadata?.nama_usaha || 'Usaha Saya');
    const legalForm = LEGAL_LABEL[String(profile?.bentuk_usaha || '')] || 'Belum diisi';
    const typeLabel = BUSINESS_LABEL[kind];
    const paymentMethod = String(profile?.metode_pembayaran || 'manual');
    const paymentMethodLabel = paymentMethod === 'gopay_macrodroid'
      ? 'GoPay Merchant melalui MacroDroid (pembayaran nyata yang tercatat)'
      : 'Pencatatan manual; QRIS statis/dinamis di kasir hanya pratinjau contoh';
    const entryIdsWithRevenue = new Set(lines.filter((line) => line.account_type === 'revenue' && money(line.credit) > 0).map((line) => line.entry_id));
    const revenueEntries = new Set(entries.filter((entry) => entry.source_type === 'transaction' && entryIdsWithRevenue.has(entry.id)).map((entry) => entry.id));
    const cashReceipts = lines.filter((line) => revenueEntries.has(line.entry_id) && line.account_code === '1000').reduce((sum, line) => sum + money(line.debit), 0);
    const qrisReceipts = lines.filter((line) => revenueEntries.has(line.entry_id) && line.account_code === '1010').reduce((sum, line) => sum + money(line.debit), 0);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const paymentDetails = lines.filter((line) => revenueEntries.has(line.entry_id) && ['1000', '1010'].includes(line.account_code) && money(line.debit) > 0);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'UMKM Berdampak';
    workbook.subject = `Laporan akuntansi bulanan ${month}`;
    workbook.title = `${name} - Laporan Akuntansi ${month}`;
    workbook.created = new Date();
    workbook.modified = new Date();

    // 1. Lembar ringkasan untuk semua tipe usaha.
    const summary = workbook.addWorksheet('Ringkasan Bulanan');
    summary.columns = [{ width: 38 }, { width: 25 }, { width: 25 }, { width: 25 }];
    addHeading(summary, `${name.toUpperCase()} · LAPORAN AKUNTANSI`, `Periode ${month} | ${typeLabel} | ${legalForm}`, 4);
    let r = 4;
    r = addSection(summary, r, 'PROFIL USAHA', 4);
    summary.addRow(['Nama usaha', name, 'Tipe usaha', typeLabel]);
    summary.addRow(['Bidang usaha', String(profile?.bidang_usaha || 'Belum diisi'), 'Bentuk usaha', legalForm]);
    summary.addRow(['Memiliki persediaan', profile?.memiliki_persediaan === true ? 'Ya' : profile?.memiliki_persediaan === false ? 'Tidak' : 'Belum diisi', 'Jumlah jurnal bulan ini', entries.length]);
    summary.addRow(['Metode pembayaran terdaftar', paymentMethodLabel, 'Pembayaran QRIS contoh', 'Tidak dihitung sebagai transaksi']);
    r = summary.lastRow.number + 2;
    r = addSection(summary, r, 'LAPORAN LABA RUGI', 2);
    const revenueLabel = kind === 'jasa' ? 'Pendapatan jasa' : kind === 'campuran' ? 'Pendapatan produk dan jasa' : 'Pendapatan penjualan';
    const cogsLabel = kind === 'jasa' ? 'Biaya langsung jasa' : kind === 'manufaktur' ? 'Harga pokok produk terjual' : kind === 'campuran' ? 'HPP dan biaya langsung' : 'Harga pokok penjualan';
    const profitRows = [
      [revenueLabel, money(snapshot.profitLoss.revenue)], [cogsLabel, money(snapshot.profitLoss.cogs)],
      ['Laba kotor', money(snapshot.profitLoss.grossProfit)], ['Beban operasional', money(snapshot.profitLoss.operatingExpenses)],
      ['Beban lainnya', money(snapshot.profitLoss.otherExpenses)], ['LABA / (RUGI) BERSIH', money(snapshot.profitLoss.netProfit)],
    ];
    for (const row of profitRows) summary.addRow(row);
    r = summary.lastRow.number + 2;
    r = addSection(summary, r, 'POSISI KEUANGAN PADA AKHIR BULAN', 2);
    const bs = snapshot.balanceSheet;
    for (const row of [['Total aset', money(bs.assets)], ['Total liabilitas', money(bs.liabilities)], ['Modal dan saldo laba', money(bs.equity)], ['Kas dan bank', money(bs.cash)], ['Selisih aset - liabilitas - ekuitas', money(bs.difference)]]) summary.addRow(row);
    r = summary.lastRow.number + 2;
    r = addSection(summary, r, 'RINCIAN PENERIMAAN PENJUALAN', 2);
    summary.addRow(['Penerimaan penjualan tunai', cashReceipts]);
    summary.addRow(['Penerimaan penjualan Bank / QRIS', qrisReceipts]);
    summary.addRow(['Total penerimaan penjualan teridentifikasi', cashReceipts + qrisReceipts]);
    summary.addRow(['Catatan QRIS', 'QRIS contoh statis/dinamis hanya pratinjau; tidak masuk jurnal atau penerimaan.']);
    r = summary.lastRow.number + 2;
    r = addSection(summary, r, 'ARUS KAS BULANAN', 2);
    const cf = snapshot.cashFlow;
    for (const row of [['Saldo kas awal bulan', money(cf.openingCash)], ['Kas masuk', money(cf.cashIn)], ['Kas keluar', money(cf.cashOut)], ['Kenaikan / (penurunan) kas', money(cf.netChange)], ['Saldo kas akhir bulan', money(cf.closingCash)]]) summary.addRow(row);
    r = summary.lastRow.number + 2;
    r = addSection(summary, r, 'KONTROL JURNAL', 2);
    summary.addRow(['Total debit bulan ini', money(snapshot.monthDebit)]);
    summary.addRow(['Total kredit bulan ini', money(snapshot.monthCredit)]);
    summary.addRow(['Status keseimbangan', snapshot.balanced ? 'Seimbang' : 'Perlu pemeriksaan']);
    summary.addRow(['Catatan', String(snapshot.note || '')]);
    styleDataRows(summary, 5, summary.lastRow.number, [2]);
    summary.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];

    // 2. Neraca saldo pergerakan bulan berjalan.
    const trial = workbook.addWorksheet('Neraca Saldo');
    trial.columns = [{ width: 14 }, { width: 36 }, { width: 18 }, { width: 21 }, { width: 21 }, { width: 21 }];
    addHeading(trial, 'NERACA SALDO BULANAN', `${name} · Periode ${month}`, 6);
    trial.addRow(['Kode akun', 'Nama akun', 'Jenis akun', 'Debit', 'Kredit', 'Saldo bersih periode']);
    styleTableHeader(trial.getRow(3));
    const trialRows = (snapshot.monthlyTrialBalance as TrialRow[]).map((a) => [a.code, a.name, a.type, money(a.debit), money(a.credit), money(a.balance)]);
    trialRows.forEach((row) => trial.addRow(row));
    const trialEnd = Math.max(3, trial.lastRow.number);
    styleDataRows(trial, 4, trialEnd, [4, 5, 6]);
    trial.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
    trial.autoFilter = { from: { row: 3, column: 1 }, to: { row: trialEnd, column: 6 } };

    // 3. Jurnal umum berisi seluruh baris jurnal pada bulan terpilih.
    const journal = workbook.addWorksheet('Jurnal Umum');
    journal.columns = [{ width: 14 }, { width: 22 }, { width: 20 }, { width: 42 }, { width: 13 }, { width: 32 }, { width: 16 }, { width: 20 }, { width: 20 }];
    addHeading(journal, 'JURNAL UMUM', `${name} · ${month} · Detail debit dan kredit`, 9);
    journal.addRow(['Tanggal', 'Nomor jurnal', 'Sumber', 'Keterangan jurnal', 'Kode akun', 'Nama akun', 'Jenis akun', 'Debit', 'Kredit']);
    styleTableHeader(journal.getRow(3));
    const journalRows = lines.map((line) => {
      const entry = entryById.get(line.entry_id);
      return entry ? [entry.entry_date, entry.entry_no, SOURCE_LABEL[entry.source_type] || entry.source_type, entry.description, line.account_code, line.account_name, line.account_type, money(line.debit), money(line.credit)] : null;
    }).filter((row): row is (string | number)[] => row !== null);
    journalRows.forEach((row) => journal.addRow(row));
    const journalEnd = Math.max(3, journal.lastRow.number);
    styleDataRows(journal, 4, journalEnd, [8, 9]);
    journal.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
    journal.autoFilter = { from: { row: 3, column: 1 }, to: { row: journalEnd, column: 9 } };

    // 4. Rincian penerimaan berdasarkan akun pembayaran yang benar-benar dijurnal.
    const payments = workbook.addWorksheet('Pembayaran dan QRIS');
    payments.columns = [{ width: 16 }, { width: 22 }, { width: 42 }, { width: 22 }, { width: 22 }];
    addHeading(payments, 'RINCIAN PEMBAYARAN', `${name} · ${month} · Hanya penerimaan dari jurnal transaksi nyata`, 5);
    let paymentRow = 4;
    paymentRow = addSection(payments, paymentRow, 'RINGKASAN METODE PEMBAYARAN', 2);
    payments.addRow(['Metode pada profil usaha', paymentMethodLabel]);
    payments.addRow(['Penerimaan tunai', cashReceipts]);
    payments.addRow(['Penerimaan Bank / QRIS', qrisReceipts]);
    payments.addRow(['Total penerimaan teridentifikasi', cashReceipts + qrisReceipts]);
    payments.addRow(['QRIS statis/dinamis contoh', 'Pratinjau saja — tidak menerima pembayaran dan tidak masuk jurnal']);
    paymentRow = payments.lastRow.number + 2;
    payments.mergeCells(paymentRow, 1, paymentRow, 5);
    payments.getCell(paymentRow, 1).value = 'DETAIL PENERIMAAN PENJUALAN';
    payments.getCell(paymentRow, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    payments.getCell(paymentRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5B49' } };
    payments.addRow(['Tanggal', 'Nomor jurnal', 'Keterangan', 'Metode penerimaan', 'Nominal']);
    styleTableHeader(payments.getRow(paymentRow + 1));
    for (const line of paymentDetails) {
      const entry = entryById.get(line.entry_id);
      if (!entry) continue;
      payments.addRow([entry.entry_date, entry.entry_no, entry.description, line.account_code === '1010' ? 'Bank / QRIS' : 'Tunai', money(line.debit)]);
    }
    const paymentEnd = Math.max(paymentRow + 1, payments.lastRow.number);
    styleDataRows(payments, 4, paymentEnd, [2, 5]);
    payments.views = [{ state: 'frozen', ySplit: paymentRow + 1, showGridLines: false }];
    payments.autoFilter = { from: { row: paymentRow + 1, column: 1 }, to: { row: paymentEnd, column: 5 } };

    // 5. Lembar tambahan yang disesuaikan dengan karakteristik usaha.
    const specific = workbook.addWorksheet(kind === 'manufaktur' ? 'Produksi dan HPP' : kind === 'jasa' ? 'Operasional Jasa' : kind === 'retail' ? 'Operasional Retail' : 'Operasional Campuran');
    specific.columns = [{ width: 40 }, { width: 18 }, { width: 21 }, { width: 21 }, { width: 21 }, { width: 48 }];
    addHeading(specific, `RINCIAN USAHA · ${typeLabel.toUpperCase()}`, `Akun yang relevan pada periode ${month} · ${name}`, 6);
    specific.addRow(['Indikator / akun', 'Kode akun', 'Debit periode', 'Kredit periode', 'Saldo bersih periode', 'Keterangan']);
    styleTableHeader(specific.getRow(3));
    const monthly = snapshot.monthlyTrialBalance as TrialRow[];
    let selectedAccounts: TrialRow[] = [];
    let metrics: Array<[string, number, string]> = [];
    if (kind === 'retail') {
      selectedAccounts = monthly.filter((a) => ['1200', '1210', '1220', '1230', '5000', '4000', '6000', '7000'].includes(a.code) || a.code.startsWith('12'));
      metrics = [
        ['Penjualan barang', money(snapshot.profitLoss.revenue), 'Pendapatan yang masuk ke akun pendapatan.'],
        ['HPP barang dagangan', money(snapshot.profitLoss.cogs), 'Biaya pokok atas barang yang terjual.'],
        ['Laba kotor perdagangan', money(snapshot.profitLoss.grossProfit), 'Pendapatan dikurangi HPP.'],
      ];
    } else if (kind === 'manufaktur') {
      selectedAccounts = monthly.filter((a) => ['1210', '1220', '1230', '2110', '2120', '5000', '5100', '4000', '6000', '7000'].includes(a.code) || a.code.startsWith('12'));
      metrics = [
        ['Penjualan produk', money(snapshot.profitLoss.revenue), 'Pendapatan dari penjualan hasil produksi.'],
        ['HPP produk terjual', money(snapshot.profitLoss.cogs), 'Biaya pokok produk yang sudah terjual.'],
        ['Persediaan bahan baku (mutasi periode)', money(monthly.find((a) => a.code === '1210')?.balance), 'Mutasi jurnal akun bahan baku; bukan stok fisik akhir.'],
        ['Barang dalam proses (mutasi periode)', money(monthly.find((a) => a.code === '1220')?.balance), 'Mutasi jurnal barang dalam proses.'],
        ['Persediaan barang jadi (mutasi periode)', money(monthly.find((a) => a.code === '1230')?.balance), 'Mutasi jurnal barang jadi.'],
        ['Utang tenaga kerja langsung (mutasi periode)', money(monthly.find((a) => a.code === '2110')?.balance), 'Mutasi pencatatan biaya tenaga kerja langsung.'],
        ['Utang biaya overhead (mutasi periode)', money(monthly.find((a) => a.code === '2120')?.balance), 'Mutasi pencatatan overhead produksi.'],
      ];
    } else if (kind === 'jasa') {
      selectedAccounts = monthly.filter((a) => ['4000', '5100', '6000', '6100', '7000', '1000', '1010'].includes(a.code));
      metrics = [
        ['Pendapatan jasa', money(snapshot.profitLoss.revenue), 'Pendapatan dari layanan yang dicatat.'],
        ['Biaya langsung jasa', money(snapshot.profitLoss.cogs), 'Biaya langsung untuk memberikan layanan.'],
        ['Laba kotor jasa', money(snapshot.profitLoss.grossProfit), 'Pendapatan jasa dikurangi biaya langsung.'],
        ['Beban operasional', money(snapshot.profitLoss.operatingExpenses), 'Beban operasional yang dijurnal.'],
      ];
    } else {
      selectedAccounts = monthly.filter((a) => ['1200', '1210', '1220', '1230', '2110', '2120', '4000', '5000', '5100', '6000', '6100', '7000'].includes(a.code) || a.code.startsWith('12'));
      metrics = [
        ['Pendapatan produk dan jasa', money(snapshot.profitLoss.revenue), 'Gabungan pendapatan yang tercatat pada akun pendapatan.'],
        ['HPP dan biaya langsung', money(snapshot.profitLoss.cogs), 'Gabungan biaya langsung dan HPP sesuai jurnal.'],
        ['Laba kotor', money(snapshot.profitLoss.grossProfit), 'Pendapatan dikurangi HPP dan biaya langsung.'],
        ['Beban operasional', money(snapshot.profitLoss.operatingExpenses), 'Beban operasional yang dijurnal.'],
      ];
    }
    for (const [label, amount, note] of metrics) {
      specific.addRow([label, '', amount, '', amount, note]);
    }
    const sectionRow = specific.lastRow.number + 2;
    specific.mergeCells(sectionRow, 1, sectionRow, 6);
    const sectionCell = specific.getCell(sectionRow, 1);
    sectionCell.value = 'RINCIAN AKUN TERKAIT';
    sectionCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sectionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5B49' } };
    for (const account of selectedAccounts) specific.addRow([account.name, account.code, money(account.debit), money(account.credit), money(account.balance), `Jenis akun: ${account.type}`]);
    const specificEnd = Math.max(3, specific.lastRow.number);
    styleDataRows(specific, 4, specificEnd, [3, 4, 5]);
    specific.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];

    const buffer = await workbook.xlsx.writeBuffer();
    const safeName = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'UMKM';
    const filename = `Laporan-Akuntansi-${safeName}-${month}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Export monthly accounting report error:', error);
    const message = error instanceof Error ? error.message : 'Laporan Excel gagal dibuat.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
