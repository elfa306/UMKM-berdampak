'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ConfirmDialog';
import { Clock3, Database, LogOut, Package, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

type SessionInfo = {
  id: string;
  businessType: string;
  mode: 'eksplorasi' | 'guided';
  businessName: string;
  createdAt: string;
  expiresAt: string;
  productCount: number;
};

const TYPE_LABEL: Record<string, string> = {
  retail: 'Retail / Perdagangan',
  manufaktur: 'Manufaktur / Produksi',
  jasa: 'Jasa',
  campuran: 'Usaha Campuran',
};

export default function DemoSessionPanel({ session }: { session: SessionInfo }) {
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<'reset' | 'end' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = useMemo(() => {
    const seconds = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return { seconds, label: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` };
  }, [session.expiresAt, now]);

  async function performAction(action: 'reset' | 'end') {
    const confirmMessage = action === 'reset'
      ? 'Reset akan menghapus transaksi dan perubahan dalam sesi ini, lalu membuat data awal baru. Lanjutkan?'
      : 'Akhiri sesi dan hapus seluruh data demonstrasi sesi ini?';
    if (!(await confirm({
      title: action === 'reset' ? 'Reset sesi demo?' : 'Akhiri sesi demo?',
      message: confirmMessage,
      confirmLabel: action === 'reset' ? 'Ya, reset' : 'Ya, akhiri',
      tone: 'danger',
    }))) return;

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
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-7 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-black tracking-tight">UMKM <span className="text-emerald-600">Berdampak</span></div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-amber-800">DEMO MODE</span>
        </header>

        <section className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl sm:p-8">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-200"><Sparkles size={15} /> RUANG DEMONSTRASI AKTIF</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{session.businessName}</h1>
          <p className="mt-2 text-sm text-slate-300">{TYPE_LABEL[session.businessType] ?? session.businessType}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
              <div className="flex items-center gap-2 text-xs text-slate-300"><Clock3 size={15} /> Sisa waktu</div>
              <p className="mt-2 font-mono text-2xl font-black tabular-nums">{remaining.label}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
              <div className="flex items-center gap-2 text-xs text-slate-300"><Package size={15} /> Produk awal</div>
              <p className="mt-2 text-2xl font-black tabular-nums">{session.productCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
              <div className="flex items-center gap-2 text-xs text-slate-300"><ShieldCheck size={15} /> Mode</div>
              <p className="mt-2 text-lg font-black">{session.mode === 'guided' ? 'Guided Demo' : 'Eksplorasi Bebas'}</p>
            </div>
          </div>
        </section>

        {remaining.seconds === 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Sesi ini sudah kedaluwarsa. Kembali ke halaman demo untuk memulai sesi baru.</div>
        ) : (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <Database size={20} className="mt-0.5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-sm font-extrabold text-emerald-950">Ruang demo berhasil dibuat</p>
                <p className="mt-1 text-xs leading-5 text-emerald-900/80">Data sesi ini disimpan terpisah di database demonstrasi. Sesi diikat ke cookie HttpOnly pada browser ini, bukan ke akun UMKM produksi.</p>
              </div>
            </div>
          </div>
        )}

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-black">Kontrol sesi demonstrasi</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Tahap berikutnya akan menambahkan dashboard, POS, dan alur transaksi. Untuk saat ini, kamu dapat memeriksa dan mengelola ruang demo yang sudah dibuat.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => performAction('reset')} disabled={!!busy || remaining.seconds === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={16} className={busy === 'reset' ? 'animate-spin' : ''} /> {busy === 'reset' ? 'Mengatur ulang...' : 'Reset sesi demo'}
            </button>
            <button type="button" onClick={() => performAction('end')} disabled={!!busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-slate-800 disabled:opacity-50">
              <LogOut size={16} /> {busy === 'end' ? 'Mengakhiri...' : 'Akhiri sesi'}
            </button>
          </div>
          {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
        </section>

        <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">ID sesi: {session.id} · Bukan data transaksi nyata.</p>
      </div>
    {confirmDialog}
    </main>
  );
}
