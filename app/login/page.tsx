'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { pesanAuth } from '@/lib/pesanAuth';
import { Press } from '@/components/Motion';

type Mode = 'masuk' | 'daftar' | 'lupa';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('masuk');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [lihat, setLihat] = useState(false);
  const [proses, setProses] = useState(false);

  const ganti = (m: Mode) => { setMode(m); setErr(''); setInfo(''); };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setInfo(''); setProses(true);
    try {
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email')).trim();
      const password = String(fd.get('password') ?? '');

      if (mode === 'lupa') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) return setErr(pesanAuth(error.message));
        // Pesan sengaja sama untuk email terdaftar maupun tidak, agar orang lain tidak bisa menebak email siapa yang memakai aplikasi ini
        return setInfo('Jika email itu terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Cek kotak masuk dan folder spam. Tautan berlaku terbatas, jadi segera dibuka.');
      }
      if (mode === 'daftar') {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: { nama_usaha: String(fd.get('nama_usaha')) }, emailRedirectTo: `${window.location.origin}/kasir` },
        });
        if (error) return setErr(pesanAuth(error.message));
        if (!data.session) return setInfo('Cek email Anda untuk konfirmasi, lalu masuk.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return setErr(pesanAuth(error.message));
      }
      router.replace('/kasir');
    } catch (x) {
      setErr(pesanAuth((x as Error).message));
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="wrap">
      <div className="header-app"><h1>UMKM <span>Kasir</span></h1><p>Catat penjualan, pantau untung real time</p></div>
      <form className="glass-card" onSubmit={submit}>
        <span className="label">{mode === 'daftar' ? 'Daftar akun' : mode === 'lupa' ? 'Lupa kata sandi' : 'Masuk'}</span>
        {mode === 'lupa' && <p className="muted" style={{ margin: 0 }}>Masukkan email yang dipakai saat mendaftar. Kami kirim tautan untuk membuat kata sandi baru.</p>}
        {mode === 'daftar' && <input name="nama_usaha" placeholder="Nama usaha" required />}
        <input name="email" type="email" inputMode="email" autoComplete="email" placeholder="Email" required />
        {mode !== 'lupa' && (
          <div style={{ position: 'relative' }}>
            <input name="password" type={lihat ? 'text' : 'password'} autoComplete={mode === 'daftar' ? 'new-password' : 'current-password'}
              placeholder="Kata sandi (min. 6 karakter)" minLength={6} required style={{ paddingRight: 64 }} />
            <button type="button" className="sound-btn" onClick={() => setLihat(!lihat)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }} aria-label="Tampilkan atau sembunyikan kata sandi">
              {lihat ? 'Tutup' : 'Lihat'}
            </button>
          </div>
        )}
        <Press className="btn-main" disabled={proses}>
          {proses ? 'MOHON TUNGGU…' : mode === 'daftar' ? 'DAFTAR' : mode === 'lupa' ? 'KIRIM TAUTAN PEMULIHAN' : 'MASUK'}
        </Press>
        {mode === 'masuk' && (
          <button type="button" className="btn-soft" onClick={() => ganti('lupa')}>Lupa kata sandi?</button>
        )}
        <button type="button" className="btn-soft" onClick={() => ganti(mode === 'masuk' ? 'daftar' : 'masuk')}>
          {mode === 'masuk' ? 'Belum punya akun? Daftar' : mode === 'daftar' ? 'Sudah punya akun? Masuk' : '← Kembali ke Masuk'}
        </button>
        {err && <p className="err">{err}</p>}
        {info && <p className="muted" style={{ fontWeight: 700 }}>{info}</p>}
      </form>
    </div>
  );
}
