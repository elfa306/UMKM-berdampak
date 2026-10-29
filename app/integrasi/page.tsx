'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';

const sha256hex = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export default function Integrasi() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [aktif, setAktif] = useState(false);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [salin, setSalin] = useState('');
  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/gopay` : '/api/gopay';

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace('/login');
      const { data } = await supabase.from('webhook_tokens').select('user_id').maybeSingle();
      setAktif(!!data);
      setReady(true);
    })();
  }, [router]);

  async function buat() {
    if (aktif && !confirm('Token lama akan berhenti berlaku. Lanjutkan?')) return;
    setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.replace('/login');
    const baru = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('webhook_tokens').upsert({ user_id: user.id, token_hash: await sha256hex(baru) });
    if (error) return setErr(error.message);
    setToken(baru); setAktif(true);
  }

  async function copy(teks: string, nama: string) {
    await navigator.clipboard.writeText(teks);
    setSalin(nama); setTimeout(() => setSalin(''), 1500);
  }

  if (!ready) return <div className="wrap"><div className="header-app"><p>Memuat…</p></div></div>;

  return (
    <div className="wrap">
      <div className="header-app"><h1>Hubungkan <span>QRIS</span></h1><p>GoPay Merchant via MacroDroid</p></div>
      {err && <p className="err">{err}</p>}

      <div className="glass-card">
        <span className="label">1. Alamat webhook</span>
        <input readOnly value={endpoint} />
        <button className="btn-soft" onClick={() => copy(endpoint, 'url')}>{salin === 'url' ? 'Tersalin ✓' : 'Salin alamat'}</button>
      </div>

      <div className="glass-card">
        <span className="label">2. Token akun ini</span>
        {token ? (
          <>
            <input readOnly value={token} />
            <button className="btn-soft" onClick={() => copy(token, 'tok')}>{salin === 'tok' ? 'Tersalin ✓' : 'Salin token'}</button>
            <p className="muted">Simpan sekarang. Token hanya tampil sekali dan tidak bisa dilihat lagi.</p>
          </>
        ) : (
          <p className="muted">{aktif ? 'Token sudah dibuat. Buat ulang jika lupa atau ingin mengganti.' : 'Belum ada token.'}</p>
        )}
        <button className="btn-main" onClick={buat}>{aktif ? 'BUAT ULANG TOKEN' : 'BUAT TOKEN'}</button>
      </div>

      <div className="glass-card">
        <span className="label">3. Setelan di MacroDroid (HP yang memakai GoPay Merchant)</span>
        <p className="muted">
          Trigger: Notifikasi Diterima, aplikasi GoPay Merchant.<br />
          Aksi: HTTP Request, metode POST, URL = alamat di atas.<br />
          Header: <b>x-webhook-token</b> = token di atas.<br />
          Content-Type: application/json.<br />
          Body: {'{"title":"{not_title}","text":"{notification}","ts":"{not_timestamp}"}'}
        </p>
      </div>
      <BottomNav />
    </div>
  );
}
