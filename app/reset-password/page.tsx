'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { pesanAuth } from '@/lib/pesanAuth';
import { Press } from '@/components/Motion';

type Status = 'cek' | 'siap' | 'tautanRusak' | 'selesai';

// Dipakai dua hal: (1) tujuan tautan "lupa kata sandi" dari email, (2) menu "Ganti Kata Sandi" bagi yang sudah login.
export default function ResetPassword() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('cek');
  const [err, setErr] = useState('');
  const [lihat, setLihat] = useState(false);
  const [proses, setProses] = useState(false);

  useEffect(() => {
    // Tautan kedaluwarsa/sudah dipakai: Supabase menaruh error di bagian # pada alamat
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error') || hash.get('error_code')) { setStatus('tautanRusak'); return; }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('siap');
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setStatus('siap'); });
    const t = setTimeout(() => setStatus((s) => (s === 'cek' ? 'tautanRusak' : s)), 5000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function simpan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr('');
    const fd = new FormData(e.currentTarget);
    const baru = String(fd.get('baru'));
    if (baru !== String(fd.get('ulang'))) return setErr('Kedua kata sandi belum sama. Periksa lagi.');
    setProses(true);
    const { error } = await supabase.auth.updateUser({ password: baru });
    setProses(false);
    if (error) return setErr(pesanAuth(error.message));
    // Demi keamanan, perangkat lain yang masih login dikeluarkan; perangkat ini tetap masuk
    await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
    setStatus('selesai');
    setTimeout(() => router.replace('/kasir'), 1800);
  }

  return (
    <div className="wrap">
      <div className="header-app"><h1>Kata sandi <span>baru</span></h1><p>Buat kata sandi yang mudah Anda ingat</p></div>

      {status === 'cek' && <p className="muted" style={{ textAlign: 'center' }}>Memeriksa tautan…</p>}

      {status === 'tautanRusak' && (
        <div className="glass-card">
          <span className="label">Tautan tidak berlaku</span>
          <p className="muted" style={{ margin: 0 }}>Tautan pemulihan sudah kedaluwarsa atau sudah pernah dipakai. Minta tautan baru, lalu buka tautan dari email paling baru.</p>
          <Link href="/login" className="btn-main" style={{ textAlign: 'center' }}>MINTA TAUTAN BARU</Link>
        </div>
      )}

      {status === 'siap' && (
        <form className="glass-card" onSubmit={simpan}>
          <span className="label">Buat kata sandi baru</span>
          <div style={{ position: 'relative' }}>
            <input name="baru" type={lihat ? 'text' : 'password'} autoComplete="new-password" placeholder="Kata sandi baru (min. 6 karakter)" minLength={6} required style={{ paddingRight: 64 }} />
            <button type="button" className="sound-btn" onClick={() => setLihat(!lihat)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>{lihat ? 'Tutup' : 'Lihat'}</button>
          </div>
          <input name="ulang" type={lihat ? 'text' : 'password'} autoComplete="new-password" placeholder="Ulangi kata sandi baru" minLength={6} required />
          <Press className="btn-main" disabled={proses}>{proses ? 'MENYIMPAN…' : 'SIMPAN KATA SANDI'}</Press>
          <Link href="/kasir" className="btn-soft" style={{ textAlign: 'center' }}>Batal</Link>
          {err && <p className="err">{err}</p>}
          <p className="muted" style={{ margin: 0 }}>Setelah disimpan, perangkat lain yang sedang masuk akan dikeluarkan demi keamanan.</p>
        </form>
      )}

      {status === 'selesai' && (
        <div className="glass-card"><span className="label">Berhasil ✅</span><p className="muted" style={{ margin: 0 }}>Kata sandi sudah diganti. Mengalihkan ke kasir…</p></div>
      )}
    </div>
  );
}
