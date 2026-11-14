import Link from 'next/link';
import { ArrowLeft, ChartNoAxesCombined, CircleAlert, FileBarChart, Lightbulb, ShieldCheck, Wallet } from 'lucide-react';

type Account = { code: string; name: string; type: string; balance: number };
type Snapshot = {
  period: string;
  profitLoss: { revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; otherExpenses: number; netProfit: number; grossMargin: number; netMargin: number };
  balanceSheet: { assets: number; liabilities: number; capital: number; retainedEarnings: number; equity: number; difference: number; cash: number };
  cashFlow: { openingCash: number; cashIn: number; cashOut: number; netChange: number; closingCash: number };
  accounts: Account[];
  journalCount: number;
  balanced: boolean;
};
type BusinessType = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export default function DemoBusinessAnalysis({ businessName, businessType, snapshot }: { businessName: string; businessType: BusinessType; snapshot: Snapshot }) {
  const pl = snapshot.profitLoss;
  const bs = snapshot.balanceSheet;
  const inventory = snapshot.accounts.filter((a) => ['1200', '1210', '1220', '1230'].includes(a.code)).reduce((sum, a) => sum + a.balance, 0);
  const currentAssets = bs.cash + inventory;
  const currentLiabilities = snapshot.accounts.filter((a) => ['2000', '2110', '2120'].includes(a.code)).reduce((sum, a) => sum + a.balance, 0);
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : null;
  const hasRevenue = pl.revenue > 0;
  const suggestions: string[] = [];
  if (!hasRevenue) suggestions.push('Catat beberapa transaksi penjualan terlebih dahulu agar margin dan tren usaha dapat dianalisis.');
  else if (pl.netProfit < 0) suggestions.push('Evaluasi harga jual, HPP, dan biaya operasional karena hasil periode ini masih menunjukkan rugi.');
  else if (pl.netMargin < 0.1) suggestions.push('Tinjau kembali HPP dan biaya rutin untuk memperbaiki margin laba bersih.');
  else suggestions.push('Pertahankan pencatatan penjualan dan biaya agar tren laba dapat dibandingkan antarperiode.');
  if (!snapshot.balanced || Math.abs(bs.difference) >= 0.01) suggestions.push('Periksa saldo awal, utang, modal, dan jurnal yang belum dicatat agar neraca seimbang.');
  if (currentRatio !== null && currentRatio < 1) suggestions.push('Aset lancar yang tercatat lebih kecil dari kewajiban lancar; tinjau arus kas dan jadwal pembayaran pemasok.');
  if (suggestions.length === 0) suggestions.push('Lanjutkan pencatatan secara konsisten dan tinjau laporan setiap bulan.');
  const typeLabel: Record<BusinessType, string> = { retail: 'Retail / Perdagangan', manufaktur: 'Manufaktur / Produksi', jasa: 'Jasa', campuran: 'Usaha Campuran' };
  const metrics = [
    { label: 'Pendapatan periode ini', value: IDR.format(pl.revenue), icon: Wallet },
    { label: 'Laba bersih periode ini', value: IDR.format(pl.netProfit), icon: ChartNoAxesCombined },
    { label: 'Nilai persediaan tercatat', value: IDR.format(inventory), icon: FileBarChart },
    { label: 'Kas dan bank', value: IDR.format(bs.cash), icon: Wallet },
  ];
  return (
    <main className="min-h-dvh bg-slate-50 px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/demo/ruang" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/>Dashboard demo</Link>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold text-amber-800">DEMO MODE</span>
        </header>
        <section className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-lg sm:p-7">
          <p className="text-xs font-bold tracking-wide text-emerald-200">BUSINESS HEALTH CHECK</p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">Analisis Kesehatan Usaha</h1>
          <p className="mt-2 text-sm text-slate-300">{businessName} · {typeLabel[businessType]} · Periode {snapshot.period}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {metrics.map((metric) => { const Icon = metric.icon; return <div key={metric.label} className="rounded-2xl bg-white/10 p-3"><Icon size={17} className="text-emerald-200"/><p className="mt-2 text-[10px] text-slate-300">{metric.label}</p><p className="mt-1 break-words text-sm font-black sm:text-base">{metric.value}</p></div>; })}
          </div>
        </section>
        <section className="mt-5 grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black">Indikator operasional</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-3"><span className="text-slate-500">Margin laba kotor</span><b>{(pl.grossMargin * 100).toFixed(1)}%</b></div>
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-3"><span className="text-slate-500">Margin laba bersih</span><b>{(pl.netMargin * 100).toFixed(1)}%</b></div>
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-3"><span className="text-slate-500">Rasio lancar indikatif</span><b>{currentRatio === null ? 'Belum tersedia' : `${currentRatio.toFixed(2)}×`}</b></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Jurnal tercatat</span><b>{snapshot.journalCount}</b></div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-500">Rasio lancar dihitung dari kas, bank, dan persediaan yang tercatat dibandingkan utang usaha serta biaya terutang yang tersedia. Angka dapat belum lengkap jika saldo belum dimasukkan.</p>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black">Saran perbaikan berdasarkan catatan demo</h2>
            <div className="mt-4 space-y-3">
              {suggestions.map((text, index) => <div key={index} className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-950"><Lightbulb size={16} className="mt-0.5 shrink-0"/>{text}</div>)}
            </div>
          </article>
        </section>
        <section className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3"><CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-700"/><div><h2 className="font-black text-amber-950">Kesiapan pembiayaan belum dapat dinilai</h2><p className="mt-2 text-xs leading-5 text-amber-900">Sesi ini menggunakan data demonstrasi. Skor dan angka simulasi bukan keputusan kredit, bukan penawaran bank, dan tidak dapat digunakan untuk menyimpulkan kelayakan pembiayaan usaha nyata. Penilaian sebenarnya memerlukan catatan usaha yang memadai, informasi kewajiban, usia usaha, dan verifikasi penyedia pembiayaan.</p></div></div>
        </section>
        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-slate-600"><ShieldCheck size={17} className="text-emerald-700"/>Analisis dihitung dari jurnal sesi demo ini, bukan data usaha nyata.</div>
          <Link href="/demo/akuntansi" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-extrabold text-white">Buka laporan keuangan <FileBarChart size={15}/></Link>
        </section>
      </div>
    </main>
  );
}
