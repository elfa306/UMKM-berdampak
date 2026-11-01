'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  Factory,
  FileBarChart,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Wallet,
  Wrench,
} from 'lucide-react';
import type {
  DemoActivity,
  DemoDashboardSnapshot,
  DemoMission,
  DemoMissionProgress,
} from '@/lib/demoDashboard.server';
import DemoSalesChart from '@/components/demo/DemoSalesChart';

type SessionInfo = {
  id: string;
  businessType: 'retail' | 'manufaktur' | 'jasa' | 'campuran';
  mode: 'eksplorasi' | 'guided';
  businessName: string;
  createdAt: string;
  expiresAt: string;
  productCount: number;
};

type Props = {
  session: SessionInfo;
  snapshot: DemoDashboardSnapshot;
  missionProgress: DemoMissionProgress;
  missions: DemoMission[];
};

const BUSINESS: Record<SessionInfo['businessType'], { label: string; focus: string; icon: typeof Store }> = {
  retail: { label: 'Retail / Perdagangan', focus: 'Penjualan barang dagangan dan pengelolaan stok', icon: Store },
  manufaktur: { label: 'Manufaktur / Produksi', focus: 'Bahan baku, barang jadi, dan hasil produksi', icon: Factory },
  jasa: { label: 'Jasa', focus: 'Pendapatan layanan dan biaya operasional', icon: Wrench },
  campuran: { label: 'Usaha Campuran', focus: 'Produk, layanan, dan aktivitas usaha gabungan', icon: ShoppingBag },
};

const CURRENCY = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function money(value: number): string {
  return CURRENCY.format(value || 0);
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function ActivityIcon({ activity }: { activity: DemoActivity }) {
  if (activity.kind === 'sale') return <ShoppingBag size={17} />;
  if (activity.kind === 'stock') return <Package size={17} />;
  return <Activity size={17} />;
}

export default function DemoDashboard({ session, snapshot, missionProgress, missions }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<'reset' | 'end' | null>(null);
  const [error, setError] = useState('');
  const business = BUSINESS[session.businessType];
  const BusinessIcon = business.icon;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    // Refresh the server-rendered snapshot periodically so new demo activity appears without a manual reload.
    const refreshTimer = window.setInterval(() => router.refresh(), 15_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(refreshTimer);
    };
  }, [router]);

  const remaining = useMemo(() => {
    const seconds = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return {
      seconds,
      label: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    };
  }, [session.expiresAt, now]);

  const completedEvents = new Set(missionProgress.completedEvents);
  const progressPercent = missionProgress.totalCount > 0
    ? Math.round((missionProgress.completedCount / missionProgress.totalCount) * 100)
    : 0;

  async function performAction(action: 'reset' | 'end') {
    const confirmMessage = action === 'reset'
      ? 'Reset akan menghapus aktivitas sesi ini dan membuat ruang demo baru dengan data contoh awal. Lanjutkan?'
      : 'Akhiri sesi dan hapus seluruh data demonstrasi sesi ini?';
    if (!window.confirm(confirmMessage)) return;

    setBusy(action);
    setError('');
    try {
      const response = await fetch(action === 'reset' ? '/api/demo/session/reset' : '/api/demo/session', {
        method: action === 'reset' ? 'POST' : 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Permintaan tidak dapat diproses.');
      if (action === 'end') {
        router.replace('/demo');
      } else {
        router.replace('/demo/ruang');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusy(null);
    }
  }

  const metricCards = [
    { title: 'Omzet 7 hari', value: money(snapshot.revenue7d), caption: 'Total penjualan yang berhasil', icon: Wallet, color: 'text-emerald-700 bg-emerald-50' },
    { title: 'Estimasi laba kotor', value: money(snapshot.grossProfit7d), caption: 'Omzet dikurangi HPP barang terjual', icon: ChartNoAxesCombined, color: 'text-blue-700 bg-blue-50' },
    { title: 'Transaksi berhasil', value: snapshot.transactions7d.toLocaleString('id-ID'), caption: 'Dalam 7 hari terakhir', icon: ShoppingBag, color: 'text-violet-700 bg-violet-50' },
    { title: 'Produk terdaftar', value: snapshot.productCount.toLocaleString('id-ID'), caption: 'Produk dan layanan aktif', icon: Package, color: 'text-amber-700 bg-amber-50' },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/demo" className="font-black tracking-tight text-slate-900">UMKM <span className="text-emerald-600">Berdampak</span></Link>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> DEMO MODE</span>
            <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 sm:inline-flex">Pembaruan otomatis · 15 detik</span>
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-200"><Sparkles size={15} /> DASHBOARD DEMONSTRASI</div>
              <h1 className="mt-3 break-words text-2xl font-black tracking-tight sm:text-3xl">{session.businessName}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-300"><BusinessIcon size={16} /> {business.label}</p>
              <p className="mt-1 text-xs text-slate-400">{business.focus}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3">
              <p className="flex items-center gap-2 text-xs text-slate-300"><Clock3 size={14} /> Sisa waktu sesi</p>
              <p className="mt-1 font-mono text-2xl font-black tabular-nums">{remaining.label}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">{session.mode === 'guided' ? 'Guided Demo' : 'Eksplorasi Bebas'}</span>
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">7 hari terakhir</span>
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">ID: {session.id.slice(0, 8)}</span>
          </div>
        </section>

        {remaining.seconds === 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Sesi demonstrasi sudah kedaluwarsa. Mulai sesi baru dari halaman demo.</div>
        ) : null}

        <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((card) => {
            const Icon = card.icon;
            return (
              <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold text-slate-500">{card.title}</p>
                  <span className={`grid h-9 w-9 place-items-center rounded-xl ${card.color}`}><Icon size={18} /></span>
                </div>
                <p className="mt-3 break-words text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{card.value}</p>
                <p className="mt-1 text-[11px] text-slate-500">{card.caption}</p>
              </article>
            );
          })}
        </section>

        {snapshot.unallocatedStaticRevenue7d > 0 && (
          <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-extrabold text-amber-900">Ada pembayaran QRIS statis tanpa rincian barang</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">Pembayaran statis sebesar {money(snapshot.unallocatedStaticRevenue7d)} tetap masuk omzet, tetapi tidak dimasukkan ke estimasi laba kotor karena tidak memiliki rincian SKU dan HPP. Stok juga tidak dikurangi otomatis.</p>
          </section>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
          <DemoSalesChart data={snapshot.dailySales} />

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Ringkasan persediaan</p>
                <p className="mt-1 text-xs text-slate-500">Estimasi berdasarkan stok dan harga pokok</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Package size={19} /></span>
            </div>
            <p className="mt-4 text-2xl font-black tracking-tight">{money(snapshot.inventoryValue)}</p>
            <p className="mt-1 text-xs text-slate-500">Perkiraan nilai persediaan saat ini</p>
            <div className="mt-5 rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-extrabold text-slate-800"><AlertTriangle size={15} className="text-amber-600" /> Perlu diperhatikan</p>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${snapshot.lowStockCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{snapshot.lowStockCount} stok rendah</span>
              </div>
              {snapshot.lowStockProducts.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {snapshot.lowStockProducts.map((product) => (
                    <div key={product.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate font-bold text-slate-700">{product.name}</span>
                      <span className="shrink-0 font-extrabold text-amber-700">{product.stock} / min. {product.minimum} {product.unit}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">Belum ada produk yang berada di bawah batas stok minimum.</p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Aktivitas terbaru</p>
                <p className="mt-1 text-xs text-slate-500">Transaksi dan mutasi persediaan pada sesi ini</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Activity size={19} /></span>
            </div>
            {snapshot.recentActivities.length > 0 ? (
              <div className="mt-3 divide-y divide-slate-100">
                {snapshot.recentActivities.map((activity) => (
                  <div key={activity.id} className="flex items-center gap-3 py-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${activity.kind === 'sale' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><ActivityIcon activity={activity} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-extrabold text-slate-800">{activity.title}</p>
                      <p className="mt-1 truncate text-[10px] text-slate-500">{activity.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {activity.amount !== null && <p className="text-xs font-black text-emerald-700">{money(activity.amount)}</p>}
                      <p className="mt-1 text-[10px] text-slate-400">{dateTime(activity.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-center">
                <p className="text-xs font-bold text-slate-700">Belum ada aktivitas</p>
                <p className="mt-1 text-[11px] text-slate-500">Aktivitas akan muncul saat kamu mulai mencoba fitur usaha.</p>
              </div>
            )}
            {snapshot.seededOrderCount > 0 && (
              <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">Sebagian transaksi diberi label data contoh awal. Transaksi ini disediakan agar kamu bisa melihat bentuk dashboard sebelum mencoba kasir.</p>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Produk terlaris</p>
                <p className="mt-1 text-xs text-slate-500">Berdasarkan rincian transaksi 7 hari terakhir</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><ArrowUpRight size={19} /></span>
            </div>
            {snapshot.bestSellingProducts.length > 0 ? (
              <div className="mt-4 space-y-4">
                {snapshot.bestSellingProducts.map((product, index) => {
                  const maxQty = Math.max(...snapshot.bestSellingProducts.map((item) => item.quantity), 1);
                  return (
                    <div key={product.name}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-extrabold text-slate-700">{index + 1}. {product.name}</span>
                        <span className="shrink-0 font-black text-slate-900">{product.quantity} {product.unit}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(6, (product.quantity / maxQty) * 100)}%` }} /></div>
                      <p className="mt-1 text-right text-[10px] text-slate-500">Penjualan {money(product.revenue)}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-center">
                <p className="text-xs font-bold text-slate-700">Belum ada data produk terjual</p>
                <p className="mt-1 text-[11px] text-slate-500">Peringkat produk akan tersedia setelah ada transaksi.</p>
              </div>
            )}
          </section>
        </div>

        {session.mode === 'guided' ? (
          <section className="mt-5 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-black text-slate-900"><BookOpen size={18} className="text-emerald-700" /> Misi Guided Demo</p>
                <p className="mt-1 text-xs text-slate-500">Misi hanya selesai setelah aktivitas yang sesuai benar-benar tercatat.</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-emerald-700 tabular-nums">{missionProgress.completedCount}/{missionProgress.totalCount}</p>
                <p className="text-[10px] font-bold text-slate-500">misi selesai</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} /></div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {missions.map((mission, index) => {
                const complete = completedEvents.has(mission.eventType);
                return (
                  <div key={mission.eventType} className={`flex items-start gap-3 rounded-2xl border p-3 ${complete ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50/70'}`}>
                    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${complete ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>{complete ? <CheckCircle2 size={15} /> : index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-slate-800">{mission.title}</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-500">{mission.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">{mission.module}</span>
                        {!complete && <span className="text-[10px] font-bold text-amber-700">Dibuka pada {mission.availableFrom}</span>}
                        {complete && <span className="text-[10px] font-extrabold text-emerald-700">Selesai</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <BookOpen size={19} className="mt-0.5 shrink-0 text-blue-700" />
            <div>
              <p className="text-xs font-extrabold text-blue-950">Mode Eksplorasi Bebas</p>
              <p className="mt-1 text-xs leading-5 text-blue-900/80">Jelajahi ringkasan usaha tanpa urutan misi. Kamu dapat memulai sesi Guided Demo kapan saja dari halaman awal demo.</p>
            </div>
          </section>
        )}

        <section className="mt-5">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-900">Modul usaha</p>
              <p className="mt-1 text-xs text-slate-500">Kasir, inventaris, produksi, dan laporan keuangan dapat dicoba pada sesi ini.</p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">ROADMAP</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/demo/kasir" className="group rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShoppingBag size={18} /></span>
              <p className="mt-3 text-xs font-black text-slate-800">Kasir & penjualan</p>
              <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">Katalog, keranjang, invoice, dan konfirmasi transaksi demo.</p>
              <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Buka kasir <ArrowUpRight size={12} className="ml-1" /></span>
            </Link>
            <Link href="/demo/inventaris" className="group rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Package size={18} /></span>
              <p className="mt-3 text-xs font-black text-slate-800">Manajemen persediaan</p>
              <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">Produk, pemasok, barang masuk, retur, dan stok minimum.</p>
              <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Buka inventaris <ArrowUpRight size={12} className="ml-1" /></span>
            </Link>
            <Link href="/demo/produksi" className="group rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Factory size={18} /></span>
              <p className="mt-3 text-xs font-black text-slate-800">Produksi & HPP</p>
              <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">Buat resep, jalankan batch, dan hitung HPP barang jadi.</p>
              <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Buka produksi <ArrowUpRight size={12} className="ml-1" /></span>
            </Link>
            <Link href="/demo/akuntansi" className="group rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileBarChart size={18} /></span>
              <p className="mt-3 text-xs font-black text-slate-800">Akuntansi & laporan</p>
              <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">Lihat laba rugi, neraca, arus kas, dan jurnal demo.</p>
              <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Buka akuntansi <ArrowUpRight size={12} className="ml-1" /></span>
            </Link>
            <Link href="/demo/analisis" className="group rounded-2xl border border-blue-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><ChartNoAxesCombined size={18} /></span>
              <p className="mt-3 text-xs font-black text-slate-800">Analisis kesehatan usaha</p>
              <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">Lihat margin, kas, persediaan, dan saran berdasarkan jurnal demo.</p>
              <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold text-blue-700">Buka analisis <ArrowUpRight size={12} className="ml-1" /></span>
            </Link>
          </div>
        </section>

        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-700" />
            <div>
              <p className="text-xs font-extrabold text-slate-800">Data demonstrasi terpisah</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">Angka di dashboard berasal dari database sesi demo, bukan transaksi usaha sungguhan.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => performAction('reset')} disabled={!!busy || remaining.seconds === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={15} className={busy === 'reset' ? 'animate-spin' : ''} /> {busy === 'reset' ? 'Mereset...' : 'Reset demo'}
            </button>
            <button type="button" onClick={() => performAction('end')} disabled={!!busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-extrabold text-white transition hover:bg-slate-800 disabled:opacity-50">
              <LogOut size={15} /> {busy === 'end' ? 'Mengakhiri...' : 'Akhiri sesi'}
            </button>
          </div>
        </section>
        {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>UMKM Berdampak · Interactive Demo</span>
          <span>Data contoh awal: {snapshot.seededOrderCount} transaksi · Aktivitas baru: {snapshot.realDemoOrderCount} transaksi</span>
        </footer>
      </div>
    </main>
  );
}
