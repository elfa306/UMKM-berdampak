'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [daftar, setDaftar] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setInfo('');
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email'));
    const password = String(fd.get('password'));
    if (daftar) {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { nama_usaha: String(fd.get('nama_usaha')) } },
      });
      if (error) return setErr(error.message);
      if (!data.session) return setInfo('Cek email Anda untuk konfirmasi, lalu masuk.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setErr(error.message);
    }
    router.replace('/kasir');
  }

  return (
    <div className="wrap">
      <div className="header-app"><h1>UMKM <span>Kasir</span></h1><p>Catat penjualan, pantau laba real time</p></div>
      <form className="glass-card" onSubmit={submit}>
        <span className="label">{daftar ? 'Daftar akun' : 'Masuk'}</span>
        {daftar && <input name="nama_usaha" placeholder="Nama usaha" required />}
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Kata sandi (min. 6 karakter)" minLength={6} required />
        <button className="btn-main">{daftar ? 'DAFTAR' : 'MASUK'}</button>
        <button type="button" className="btn-soft" onClick={() => setDaftar(!daftar)}>
          {daftar ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
        </button>
        {err && <p className="err">{err}</p>}
        {info && <p className="muted">{info}</p>}
      </form>
    </div>
  );
}
