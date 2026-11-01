'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, QrCode, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import DemoQRCode from '@/components/demo/DemoQRCode';

type StaticQR = {
  provider_reference: string;
  merchant_reference: string;
  label: string;
  qr_content: string;
  status: 'active' | 'inactive';
};

const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function DemoStaticQrisPanel() {
  const router = useRouter();
  const [qr, setQr] = useState<StaticQR | null>(null);
  const [amount, setAmount] = useState('25000');
  const [loading, setLoading] = useState<'load' | 'create' | 'simulate' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastTransaction, setLastTransaction] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/demo/qris/static', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'QRIS statis belum dapat dimuat.');
        if (active && result.qr) setQr(result.qr as StaticQR);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'QRIS statis gagal dimuat.'); });
    return () => { active = false; };
  }, []);

  async function createQr() {
    setLoading('create'); setError(''); setMessage('');
    try {
      const response = await fetch('/api/demo/qris/static', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'QRIS statis gagal dibuat.');
      setQr(result.qr as StaticQR);
      setMessage(result.reused ? 'QRIS statis sesi ini sudah tersedia.' : 'QRIS statis Sandbox berhasil dibuat.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QRIS statis gagal dibuat.');
    } finally { setLoading(null); }
  }

  async function simulatePayment() {
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount < 1) {
      setError('Masukkan nominal berupa bilangan bulat positif.');
      return;
    }
    setLoading('simulate'); setError(''); setMessage(''); setLastTransaction('');
    try {
      const response = await fetch('/api/demo/qris/static/simulate', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numericAmount }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Simulasi pembayaran gagal.');
      const transactionId = String(result.transactionId || '');
      if (!transactionId) throw new Error('Belibayar tidak mengembalikan ID transaksi simulasi.');
      setLastTransaction(transactionId);
      setMessage('Simulasi dikirim. Menunggu webhook Belibayar...');

      let foundPaid = false;
      for (let attempt = 0; attempt < 18; attempt += 1) {
        await wait(1000);
        const statusResponse = await fetch(`/api/demo/qris/static/status?transactionId=${encodeURIComponent(transactionId)}`, { credentials: 'same-origin', cache: 'no-store' });
        const statusResult = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusResult.error || 'Status pembayaran gagal diperiksa.');
        if (statusResult.found && statusResult.paymentStatus === 'paid') {
          foundPaid = true;
          setMessage(`Pembayaran ${money.format(numericAmount)} diterima. Penjualan tercatat tanpa rincian SKU.`);
          router.refresh();
          break;
        }
      }
      if (!foundPaid) {
        setMessage('Simulasi diterima Belibayar, tetapi webhook belum terlihat. Periksa Callback URL dan Webhook Secret di dashboard Belibayar.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulasi pembayaran gagal.');
    } finally { setLoading(null); }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-800"><QrCode size={18} /><h2 className="text-sm font-black">QRIS Statis · Sandbox</h2></div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Satu QR untuk beberapa pembayaran; nominal simulasi ditentukan pembayar.</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-black text-amber-800">DEMO</span>
      </div>

      {qr ? (
        <div className="mt-4 space-y-3">
          <DemoQRCode value={qr.qr_content} label="QRIS Statis Belibayar Sandbox" />
          <p className="break-all rounded-xl bg-slate-50 p-2 text-center text-[9px] text-slate-500">Ref: {qr.merchant_reference}</p>
          <div className="grid gap-2">
            <label className="grid gap-1 text-xs font-bold text-slate-700">Nominal pembayaran simulasi
              <input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={loading !== null} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500" />
            </label>
            <button type="button" onClick={simulatePayment} disabled={loading !== null} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">
              {loading === 'simulate' ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Simulasikan pembayaran statis
            </button>
          </div>
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">QRIS statis hanya membawa nominal dan identitas QR. Sistem mencatat pembayaran sebagai penjualan tanpa rincian barang; stok SKU tidak berkurang dan HPP tidak ditebak.</p>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-center">
          <QrCode size={30} className="mx-auto text-slate-300" />
          <p className="mt-2 text-xs font-bold text-slate-700">QRIS statis belum dibuat</p>
          <p className="mt-1 text-[10px] text-slate-500">Buat satu QRIS statis untuk sesi demonstrasi ini.</p>
          <button type="button" onClick={createQr} disabled={loading !== null} className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">
            {loading === 'create' ? <LoaderCircle size={15} className="animate-spin" /> : <QrCode size={15} />} Buat QRIS statis
          </button>
        </div>
      )}

      {message && <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] leading-5 text-emerald-800">{message}</p>}
      {lastTransaction && <p className="mt-2 break-all text-[9px] text-slate-400">Transaction ID: {lastTransaction}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-5 text-red-700">{error}</p>}
      <button type="button" onClick={createQr} disabled={loading !== null || Boolean(qr)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-emerald-700 disabled:opacity-40"><RefreshCw size={12} /> Muat ulang QRIS</button>
    </section>
  );
}
