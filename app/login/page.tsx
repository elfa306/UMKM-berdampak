'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Play,
  Store,
  UserRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { pesanAuth } from '@/lib/pesanAuth';

type Mode = 'masuk' | 'daftar' | 'lupa';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('masuk');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [lihat, setLihat] = useState(false);
  const [proses, setProses] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let aktif = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!aktif) return;
      if (!error && data.session) {
        router.replace('/kasir');
        return;
      }
      setCheckingSession(false);
    }).catch(() => {
      if (aktif) setCheckingSession(false);
    });

    return () => {
      aktif = false;
    };
  }, [router]);

  function gantiMode(nextMode: Mode) {
    setMode(nextMode);
    setErr('');
    setInfo('');
    setLihat(false);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (proses) return;

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');
    const currentMode = mode;

    setErr('');
    setInfo('');
    setProses(true);

    try {
      if (currentMode === 'lupa') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          setErr(pesanAuth(error.message));
          return;
        }
        setInfo('Jika email terdaftar, tautan pemulihan sudah dikirim. Periksa kotak masuk dan folder spam.');
        return;
      }

      if (currentMode === 'daftar') {
        const namaUsaha = String(formData.get('nama_usaha') ?? '').trim();
        if (!namaUsaha) {
          setErr('Isi nama usaha terlebih dahulu.');
          return;
        }
        if (password.length < 6) {
          setErr('Kata sandi minimal 6 karakter.');
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { nama_usaha: namaUsaha },
            emailRedirectTo: `${window.location.origin}/onboarding`,
          },
        });

        if (error) {
          setErr(pesanAuth(error.message));
          return;
        }
        if (!data.session) {
          setInfo('Akun berhasil didaftarkan. Buka email untuk konfirmasi, lalu masuk ke CAVA.');
          setMode('masuk');
          setLihat(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setErr(pesanAuth(error.message));
          return;
        }
      }

      router.replace('/kasir');
      router.refresh();
    } catch (error) {
      setErr(pesanAuth(error instanceof Error ? error.message : 'Terjadi kesalahan. Coba lagi.'));
    } finally {
      setProses(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-[#103A57] px-5">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src="/cava-v-exact.webp" alt="CAVA" width={56} height={56} className="h-14 w-14 object-contain" draggable={false} />
          <p className="text-xs font-semibold text-[#A9D3C5]">Memeriksa sesi akun…</p>
        </div>
      </main>
    );
  }

  const judul = mode === 'daftar' ? 'Buat akun' : mode === 'lupa' ? 'Lupa kata sandi' : 'Masuk';
  const tombol = mode === 'daftar' ? 'Buat akun' : mode === 'lupa' ? 'Kirim tautan pemulihan' : 'Masuk';

  return (
    <main className="relative flex min-h-[100svh] flex-col items-center overflow-hidden bg-[#103A57] text-[#103A57]">
      {/* Kepala biru: logo saja, dengan lengkung dari splash */}
      <header
        className="relative flex w-full items-center justify-center px-5 pb-12 pt-[calc(28px+env(safe-area-inset-top))]"
      >
        <Link
          href="/"
          aria-label="Kembali ke halaman awal"
          className="absolute left-4 top-[calc(24px+env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-white/10 text-[#CEE5D6] transition hover:bg-white/20"
        >
          <ArrowLeft size={18} />
        </Link>
        <img src="/cava-logo-exact.webp" alt="CAVA" width={669} height={151} decoding="async" draggable={false} className="h-9 w-auto object-contain" />
      </header>

      {/* Lembar putih */}
      <section className="relative z-10 flex w-full max-w-[460px] flex-1 flex-col rounded-t-[32px] bg-white px-6 pb-[calc(28px+env(safe-area-inset-bottom))] pt-7 sm:mb-10 sm:flex-none sm:rounded-[28px] sm:px-8 sm:pb-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-[1.45rem] font-extrabold tracking-tight">{judul}</h1>
          {mode === 'lupa' && (
            <button
              type="button"
              onClick={() => gantiMode('masuk')}
              className="text-xs font-bold text-[#307B8E] hover:text-[#103A57]"
            >
              Kembali
            </button>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'daftar' && (
            <div>
              <label htmlFor="nama_usaha" className="mb-1.5 block text-xs font-bold">Nama usaha</label>
              <div className="relative">
                <Store className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#307B8E]" />
                <input
                  id="nama_usaha"
                  name="nama_usaha"
                  type="text"
                  autoComplete="organization"
                  placeholder="Contoh: Warung Sari"
                  required
                  className="auth-input"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-bold">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#307B8E]" />
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="nama@email.com"
                required
                className="auth-input"
              />
            </div>
          </div>

          {mode !== 'lupa' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-xs font-bold">Kata sandi</label>
                {mode === 'masuk' && (
                  <button type="button" onClick={() => gantiMode('lupa')} className="text-xs font-bold text-[#307B8E] hover:text-[#103A57]">
                    Lupa kata sandi?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#307B8E]" />
                <input
                  id="password"
                  name="password"
                  type={lihat ? 'text' : 'password'}
                  autoComplete={mode === 'daftar' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'daftar' ? 'Minimal 6 karakter' : 'Kata sandi'}
                  minLength={mode === 'daftar' ? 6 : undefined}
                  required
                  className="auth-input"
                />
                <button
                  type="button"
                  onClick={() => setLihat((current) => !current)}
                  aria-label={lihat ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition hover:text-[#103A57]"
                >
                  {lihat ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
          )}

          {err && (
            <div role="alert" className="rounded-xl bg-rose-50 px-3.5 py-3 text-xs font-semibold leading-5 text-rose-700">
              {err}
            </div>
          )}
          {info && (
            <div role="status" className="rounded-xl bg-[#366B2B]/[0.08] px-3.5 py-3 text-xs font-semibold leading-5 text-[#366B2B]">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={proses}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#103A57] px-5 text-sm font-extrabold text-white transition hover:bg-[#174968] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#307B8E]/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {proses ? 'Memproses…' : tombol}
          </button>
        </form>

        {mode !== 'lupa' && (
          <p className="mt-5 text-center text-xs font-semibold text-slate-500">
            {mode === 'masuk' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
            <button
              type="button"
              onClick={() => gantiMode(mode === 'masuk' ? 'daftar' : 'masuk')}
              className="font-extrabold text-[#307B8E] hover:text-[#103A57]"
            >
              {mode === 'masuk' ? 'Daftar' : 'Masuk'}
            </button>
          </p>
        )}

        <div className="mt-auto grid grid-cols-2 gap-3 pt-7">
          <Link href="/demo" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#E3F0EA] px-3 text-xs font-extrabold text-[#103A57] transition hover:bg-[#CEE5D6]">
            <Play size={14} /> Coba demo
          </Link>
          <Link href="/kasir" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#E3F0EA] px-3 text-xs font-extrabold text-[#103A57] transition hover:bg-[#CEE5D6]">
            <UserRound size={14} /> Mode tamu
          </Link>
        </div>
      </section>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[120px] left-1/2 z-0 h-[260px] w-[150%] -translate-x-1/2 rounded-[50%] bg-[#205874]/55"
      />
    </main>
  );
}
