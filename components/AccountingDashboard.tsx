'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Calculator, CheckCircle2, ClipboardList, FileText, Plus, RefreshCw, Scale, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Mode = 'demo' | 'production';
type Account = { code: string; name: string; type: string; debit: number; credit: number; balance: number };
type Entry = { id: string; entry_no: string; source_type: string; entry_date: string; description: string; totalDebit: number; totalCredit: number };
type Snapshot = {
  period: string;
  profitLoss: { revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; otherExpenses: number; netProfit: number; grossMargin: number; netMargin: number };
  balanceSheet: { assets: number; liabilities: number; capital: number; retainedEarnings: number; equity: number; difference: number; cash: number };
  cashFlow: { openingCash: number; cashIn: number; cashOut: number; netChange: number; closingCash: number };
  accounts: Account[];
  monthlyTrialBalance: Account[];
  recentEntries: Entry[];
  journalCount: number;
  monthDebit: number;
  monthCredit: number;
  balanced: boolean;
  note: string;
};
const EMPTY: Snapshot = { period: '', cashFlow: { openingCash: 0, cashIn: 0, cashOut: 0, netChange: 0, closingCash: 0 }, profitLoss: { revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, otherExpenses: 0, netProfit: 0, grossMargin: 0, netMargin: 0 }, balanceSheet: { assets: 0, liabilities: 0, capital: 0, retainedEarnings: 0, equity: 0, difference: 0, cash: 0 }, accounts: [], monthlyTrialBalance: [], recentEntries: [], journalCount: 0, monthDebit: 0, monthCredit: 0, balanced: true, note: '' };
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
const SOURCE_LABEL: Record<string, string> = { transaction: 'Kasir / transaksi', stock_purchase_item: 'Pembelian persediaan', inventory_movement: 'Mutasi persediaan', production_batch: 'Produksi', sale_order: 'Penjualan POS demo', manual: 'Jurnal manual' };

export default function AccountingDashboard({ mode, businessName }: { mode: Mode; businessName?: string }) {
  const isDemo = mode === 'demo';
  const endpoint = isDemo ? '/api/demo/akuntansi' : '/api/akuntansi';
  const backHref = isDemo ? '/demo/ruang' : '/lainnya';
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<'profit' | 'balance' | 'cash' | 'notes' | 'journals'>('profit');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showEntry, setShowEntry] = useState(false);
  const [form, setForm] = useState({ kind: 'expense', amount: '', description: '', paymentAccount: '1000' });

  const headers = useCallback(async (): Promise<HeadersInit> => {
    if (isDemo) return {};
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
    return { Authorization: `Bearer ${session.access_token}` };
  }, [isDemo]);

  const reload = useCallback(async () => {
    const response = await fetch(`${endpoint}?month=${encodeURIComponent(month)}`, { headers: await headers(), credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Laporan akuntansi gagal dimuat.');
    setSnapshot(data as Snapshot);
  }, [endpoint, headers, month]);

  useEffect(() => { let active = true; setLoading(true); setError(''); reload().catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Laporan gagal dimuat.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [reload]);

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const amount = Number(form.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal harus berupa bilangan bulat positif.');
      if (!form.description.trim()) throw new Error('Keterangan wajib diisi.');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await headers()) }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action: 'manual_entry', kind: form.kind, amount, description: form.description.trim(), paymentAccount: form.paymentAccount }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Jurnal gagal dicatat.');
      setForm({ kind: 'expense', amount: '', description: '', paymentAccount: '1000' }); setShowEntry(false); await reload(); setNotice('Jurnal berhasil dicatat dan laporan diperbarui.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Jurnal gagal dicatat.'); }
    finally { setBusy(false); }
  }

  const pl = snapshot.profitLoss; const bs = snapshot.balanceSheet;
  const row = (label: string, value: number, strong = false, indent = false) => <div key={label} className={`flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm ${indent ? 'pl-4' : ''}`}><span className={strong ? 'font-extrabold text-slate-900' : 'text-slate-600'}>{label}</span><span className={`tabular-nums ${strong ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{IDR.format(value)}</span></div>;

  return (
    <main className={`min-h-screen px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7 ${isDemo ? 'bg-slate-50' : 'bg-[#f6f8f7]'}`}>
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3"><Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/>{isDemo ? 'Dashboard demo' : 'Menu lainnya'}</Link><span className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold ${isDemo ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{isDemo ? 'DEMO MODE' : 'AKUNTANSI USAHA'}</span></header>
        <section className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="rounded-2xl bg-white/10 p-3"><Calculator size={25}/></span><div><p className="text-xs font-bold tracking-wide text-blue-200">FINANCIAL ACCOUNTING</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Akuntansi & Laporan</h1><p className="mt-2 text-sm text-slate-300">{businessName ? `${businessName} · ` : ''}Jurnal berpasangan, laporan laba rugi, dan posisi keuangan.</p></div></div><button onClick={() => setShowEntry(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"><Plus size={15}/> Catat transaksi</button></div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ label: 'Pendapatan bulan ini', value: pl.revenue }, { label: 'Laba bersih bulan ini', value: pl.netProfit }, { label: 'Aset tercatat', value: bs.assets }, { label: 'Kas + Bank', value: bs.cash }].map((m) => <div key={m.label} className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-slate-300">{m.label}</p><p className="mt-1 break-words text-base font-black sm:text-lg">{IDR.format(m.value)}</p></div>)}</div>
        </section>

        {error && <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><label className="text-xs font-bold text-slate-600">Periode laporan<input aria-label="Periode laporan" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-semibold"/></label><button onClick={() => reload().catch((e) => setError(e.message))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-600"><RefreshCw size={14}/> Muat ulang</button></div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:grid-cols-5">{([{ id: 'profit', label: 'Laba Rugi', icon: FileText }, { id: 'balance', label: 'Posisi Keuangan', icon: Scale }, { id: 'cash', label: 'Arus Kas', icon: Wallet }, { id: 'notes', label: 'Catatan', icon: ClipboardList }, { id: 'journals', label: 'Jurnal', icon: BookOpen }] as const).map((t) => { const Icon = t.icon; return <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-extrabold sm:text-sm ${tab === t.id ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={15}/><span>{t.label}</span></button>; })}</div>

        {loading ? <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">Menghitung laporan keuangan…</div> : null}
        {!loading && tab === 'profit' && <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between"><h2 className="font-black">Laporan Laba Rugi</h2><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold text-blue-700">{snapshot.period}</span></div><p className="mt-1 text-xs text-slate-500">Pendapatan dan beban yang diposting pada periode terpilih.</p><div className="mt-4">{row('Pendapatan penjualan dan jasa', pl.revenue, true)}{row('Harga pokok penjualan / jasa', -pl.cogs, false, true)}{row('Laba kotor', pl.grossProfit, true)}{row('Beban operasional', -pl.operatingExpenses, false, true)}{row('Beban lainnya', -pl.otherExpenses, false, true)}{row('Laba (rugi) bersih', pl.netProfit, true)}</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Margin laba kotor</p><p className="mt-1 text-xl font-black">{(pl.grossMargin * 100).toFixed(1)}%</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Margin laba bersih</p><p className="mt-1 text-xl font-black">{(pl.netMargin * 100).toFixed(1)}%</p></div></div></div>
          <div className="space-y-4"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Saldo percobaan periode</h2><div className="mt-3">{row('Total debit', snapshot.monthDebit)}{row('Total kredit', snapshot.monthCredit)}<div className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-xs font-bold ${snapshot.balanced ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{snapshot.balanced ? <CheckCircle2 size={16}/> : <Scale size={16}/>} {snapshot.balanced ? 'Jurnal periode seimbang' : 'Periksa kembali jurnal: debit dan kredit berbeda'}</div></div></div><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Jenis usaha dan akuntansi</h2><p className="mt-2 text-xs leading-5 text-slate-600">Pembelian persediaan dibukukan sebagai aset/utang, biaya produksi dikapitalisasi ke persediaan barang jadi, dan HPP diakui saat produk terjual. Pembayaran QRIS statis tanpa rincian SKU tidak diberi HPP otomatis.</p></div></div>
        </section>}

        {!loading && tab === 'balance' && <section className="mt-5 grid gap-5 lg:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Aset</h2>{snapshot.accounts.filter((a) => a.type === 'asset' && Math.abs(a.balance) > 0.001).map((a) => row(`${a.code} · ${a.name}`, a.balance))}{row('Total aset', bs.assets, true)}</div><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Liabilitas & Ekuitas</h2>{snapshot.accounts.filter((a) => ['liability', 'equity', 'contra_equity'].includes(a.type) && Math.abs(a.balance) > 0.001).map((a) => row(`${a.code} · ${a.name}`, a.balance))}{row('Laba ditahan / laba berjalan', bs.retainedEarnings)}{row('Total liabilitas dan ekuitas', bs.liabilities + bs.equity, true)}<div className={`mt-4 rounded-xl p-3 text-xs font-bold ${Math.abs(bs.difference) < 0.01 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>Selisih neraca: {IDR.format(bs.difference)} {Math.abs(bs.difference) < 0.01 ? '· Seimbang' : '· Periksa saldo awal / jurnal'}</div></div></section>}

        {!loading && tab === 'cash' && <section className="mt-5 grid gap-5 lg:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Ringkasan kas dan bank</h2><p className="mt-1 text-xs text-slate-500">Pergerakan akun Kas dan Bank/QRIS dari jurnal pada periode {snapshot.period}.</p><div className="mt-4">{row('Saldo awal kas dan bank', snapshot.cashFlow.openingCash)}{row('Penerimaan kas dan bank', snapshot.cashFlow.cashIn)}{row('Pengeluaran kas dan bank', -snapshot.cashFlow.cashOut)}{row('Perubahan bersih kas', snapshot.cashFlow.netChange, true)}{row('Saldo akhir kas dan bank', snapshot.cashFlow.closingCash, true)}</div></div><div className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-xs leading-6 text-blue-950"><h2 className="font-black">Cara membaca laporan</h2><p className="mt-2">Angka dihitung dari debit dan kredit pada akun Kas (1000) serta Bank/QRIS (1010). Pembelian yang masih menjadi utang pemasok belum dianggap sebagai pengeluaran kas sampai pembayaran utangnya dicatat.</p><p className="mt-2">Ini merupakan ringkasan pergerakan kas dari jurnal yang tersedia, bukan rekonsiliasi rekening bank. Periksa saldo awal dan transaksi yang belum dicatat sebelum menjadikannya laporan formal.</p></div></section>}

        {!loading && tab === 'notes' && <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Catatan atas Laporan Keuangan</h2><p className="mt-1 text-xs text-slate-500">Ringkasan kebijakan pencatatan dan batasan data untuk periode {snapshot.period}.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><article className="rounded-2xl bg-slate-50 p-4"><b className="text-sm">Dasar penyusunan</b><p className="mt-2 text-xs leading-5 text-slate-600">Laporan disusun dari transaksi dan mutasi yang tercatat pada aplikasi, menggunakan jurnal berpasangan debit-kredit. Data yang belum dimasukkan tidak akan tercermin pada laporan.</p></article><article className="rounded-2xl bg-slate-50 p-4"><b className="text-sm">Persediaan</b><p className="mt-2 text-xs leading-5 text-slate-600">Persediaan retail dan barang jadi menggunakan harga pokok rata-rata bergerak berdasarkan pembelian dan batch produksi yang dicatat.</p></article><article className="rounded-2xl bg-slate-50 p-4"><b className="text-sm">Produksi</b><p className="mt-2 text-xs leading-5 text-slate-600">Biaya bahan baku, tenaga kerja langsung, dan overhead yang dicatat dikapitalisasi ke persediaan barang jadi. Tenaga kerja dan overhead pada batch produksi dibukukan sebagai kewajiban sampai pembayaran dicatat. Biaya yang belum dicatat dapat menyebabkan HPP tidak lengkap.</p></article><article className="rounded-2xl bg-slate-50 p-4"><b className="text-sm">Pembayaran tanpa rincian barang</b><p className="mt-2 text-xs leading-5 text-slate-600">Pembayaran QRIS statis dan notifikasi GoPay tanpa invoice SKU dicatat sebagai pendapatan, tetapi tidak mengurangi stok dan tidak diberi HPP otomatis.</p></article><article className="rounded-2xl bg-slate-50 p-4"><b className="text-sm">Saldo awal dan pemilik</b><p className="mt-2 text-xs leading-5 text-slate-600">Setoran modal, prive, kas, piutang, utang, aset tetap, dan saldo awal harus dicatat dengan benar. Saldo harian lama tidak otomatis dianggap beban.</p></article><article className="rounded-2xl bg-amber-50 p-4"><b className="text-sm text-amber-900">Batasan laporan</b><p className="mt-2 text-xs leading-5 text-amber-900">Format ini menyediakan struktur dasar laporan keuangan yang mengacu pada komponen SAK EMKM, tetapi belum menjamin kepatuhan penuh, audit, perhitungan pajak, penyusutan aset tetap, dan rekonsiliasi bank.</p></article></div></section>}

        {!loading && tab === 'journals' && <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Jurnal terbaru</h2><p className="mt-1 text-xs text-slate-500">Total jurnal tersedia: {snapshot.journalCount.toLocaleString('id-ID')}</p>{snapshot.recentEntries.length ? <div className="mt-3 space-y-2">{snapshot.recentEntries.map((e) => <article key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3"><div><b className="text-xs">{e.entry_no}</b><p className="mt-1 text-xs text-slate-700">{e.description}</p><p className="mt-1 text-[10px] text-slate-500">{e.entry_date} · {SOURCE_LABEL[e.source_type] || e.source_type}</p></div><div className="text-right"><b className="text-xs">{IDR.format(e.totalDebit)}</b><p className="mt-1 text-[10px] text-slate-500">Debit = Kredit</p></div></article>)}</div> : <p className="mt-4 text-sm text-slate-500">Belum ada jurnal. Lakukan transaksi atau catat saldo awal.</p>}</section>}

        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>Catatan penggunaan laporan.</b> {snapshot.note || 'Laporan keuangan bersifat pencatatan manajerial. Pastikan saldo awal kas/bank, piutang, utang, aset tetap, pajak, dan penyesuaian periode dicatat sebelum digunakan sebagai laporan formal. Format ini mendukung struktur dasar SAK EMKM, tetapi tidak menggantikan pemeriksaan akuntan atau kewajiban pajak.'}</div>

        {showEntry && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveEntry} className="my-6 w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><b>Catat jurnal manual</b><button type="button" onClick={() => setShowEntry(false)} className="text-slate-400">✕</button></div><p className="mt-1 text-xs leading-5 text-slate-500">Pilih jenis kejadian. Sistem akan membuat jurnal debit-kredit seimbang secara otomatis.</p><label className="mt-4 block text-xs font-bold">Jenis transaksi<select value={form.kind} onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="expense">Beban operasional</option><option value="capital">Setoran modal pemilik</option><option value="draw">Pengambilan pribadi (prive)</option><option value="supplier_payment">Pembayaran utang pemasok</option><option value="labor_payment">Pembayaran utang tenaga kerja produksi</option><option value="overhead_payment">Pembayaran utang overhead produksi</option></select></label><label className="mt-3 block text-xs font-bold">Nominal (Rp)<input required type="number" min="1" step="1" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label><label className="mt-3 block text-xs font-bold">Dibayar / diterima melalui<select value={form.paymentAccount} onChange={(e) => setForm((v) => ({ ...v, paymentAccount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="1000">Kas</option><option value="1010">Bank / QRIS</option></select></label><label className="mt-3 block text-xs font-bold">Keterangan<input required maxLength={250} value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} placeholder="Contoh: bayar listrik bulan ini" className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label><div className="mt-4 flex gap-2"><button type="button" onClick={() => setShowEntry(false)} className="flex-1 rounded-xl border border-slate-200 p-3 text-sm font-bold">Batal</button><button disabled={busy} className="flex-1 rounded-xl bg-emerald-700 p-3 text-sm font-extrabold text-white">{busy ? 'Menyimpan…' : 'Simpan jurnal'}</button></div></form></div>}
      </div>
    </main>
  );
}
