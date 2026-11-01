'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LoaderCircle } from 'lucide-react';

type Props = {
  businessType: 'retail' | 'manufaktur' | 'jasa' | 'campuran';
  mode: 'eksplorasi' | 'guided';
};

export default function DemoStartButton({ businessType, mode }: Props) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function startSession() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/demo/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ businessType, mode, businessName: businessName.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sesi demonstrasi gagal dibuat.');
      router.push(result.redirectTo || '/demo/ruang');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyiapkan demonstrasi.');
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-xs font-bold text-slate-700">
        Nama usaha demo (opsional)
        <input
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value.slice(0, 80))}
          maxLength={80}
          placeholder="Contoh: Warung Berkah"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          disabled={loading}
        />
      </label>
      <button
        type="button"
        onClick={startSession}
        disabled={loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-700/15 transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? <><LoaderCircle size={17} className="animate-spin" /> Menyiapkan ruang demo...</> : <>Mulai sesi demonstrasi <ArrowRight size={17} /></>}
      </button>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">{error}</p>}
      <p className="text-[11px] leading-5 text-slate-500">Sesi berlaku selama 4 jam. Browser ini akan mendapatkan ruang demonstrasi pribadi yang terpisah dari data usaha asli.</p>
    </div>
  );
}
