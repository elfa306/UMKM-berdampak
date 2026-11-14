'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Play, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function LandingPage() {
  const router = useRouter();

  // Pengguna yang sudah memiliki sesi aktif langsung masuk ke kasir.
  useEffect(() => {
    let aktif = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!aktif || error || !data.session) return;
      router.replace('/kasir');
    });

    return () => {
      aktif = false;
    };
  }, [router]);

  return (
    <main
      className="relative isolate flex min-h-[100svh] w-full select-none flex-col items-center overflow-hidden bg-[#103A57] px-6 text-[#CEE5D6]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
      }}
    >
      {/* Lengkung bawah dari Splash.pdf; tombol berada di atasnya. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[14%] left-1/2 -z-10 h-[40%] w-[160%] -translate-x-1/2 rounded-[50%] bg-[#205874]"
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-1 flex-col items-center justify-center pt-10"
      >
        <img
          src="/cava-v-exact.webp"
          alt="CAVA"
          width={432}
          height={428}
          fetchPriority="high"
          decoding="async"
          draggable={false}
          className="h-auto w-[132px] object-contain sm:w-[150px]"
        />
        <h1 className="mt-9 pl-[0.4em] text-[2.6rem] font-extrabold leading-none tracking-[0.4em] sm:text-5xl">
          CAVA
        </h1>
        <p className="mt-9 pl-[0.3em] text-[0.8rem] font-bold tracking-[0.3em] text-[#A9D3C5]">
          CASH VALUE
        </p>
      </motion.div>

      <nav aria-label="Pilihan akses CAVA" className="flex w-full max-w-[340px] flex-col gap-3">
        <Link
          href="/login"
          className="group inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#CEE5D6] px-6 text-sm font-extrabold text-[#103A57] transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#A9D3C5]/50"
        >
          <span>Masuk</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/demo"
            className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#A9D3C5]/40"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>Demo</span>
          </Link>
          <Link
            href="/kasir"
            className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#A9D3C5]/40"
          >
            <UserRound className="h-4 w-4" />
            <span>Mode Tamu</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}
