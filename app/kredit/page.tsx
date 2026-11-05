'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  Download,
  Info,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { CavaLogo } from '@/components/CavaLogo';
import { supabase } from '@/lib/supabase';
import { fetchHari } from '@/lib/data';
import { todayISO, rupiah } from '@/lib/accounting';
import { exportPdf } from '@/lib/exportPdf';
import { Rise } from '@/components/Motion';

type NilaiData = {
  loggedIn: boolean;
  hariTercatat: number;
  mingguBerpemasukan: number;
  profilLengkap: boolean;
  laporanTersedia: boolean;
};

const DATA_KOSONG: NilaiData = {
  loggedIn: false,
  hariTercatat: 0,
  mingguBerpemasukan: 0,
  profilLengkap: false,
  laporanTersedia: false,
};

const anuitas = (pokok: number, bungaTahun: number, bulan: number) => {
  const r = bungaTahun / 100 / 12;
  return r === 0 ? pokok / bulan : (pokok * r) / (1 - Math.pow(1 + r, -bulan));
};

export default function NilaiUsahaPage() {
  const areaRef = useRef<HTMLDivElement>(null);
  const [nilai, setNilai] = useState<NilaiData>(DATA_KOSONG);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pinjamanSimulasi, setPinjamanSimulasi] = useState(5000000);
  const [tenorSimulasi, setTenorSimulasi] = useState(12);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let aktif = true;

    async function muatNilai() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw new Error(authError.message);

        if (!user) {
          if (aktif) setNilai(DATA_KOSONG);
          return;
        }

        const akhir = todayISO();
        const akhirDate = new Date(`${akhir}T12:00:00`);
        const awalDate = new Date(akhirDate);
        awalDate.setDate(awalDate.getDate() - 29);
        const awal = awalDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

        const [hari, profilResult] = await Promise.all([
          fetchHari(awal, akhir),
          supabase
            .from('business_profiles')
            .select('jenis_usaha,bentuk_usaha,bidang_usaha,memiliki_persediaan,metode_pembayaran,onboarding_completed_at')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);

        if (!aktif) return;

        const tanggalTercatat = new Set(hari.map((item) => item.tanggal));
        const mingguAktif = new Set<number>();

        hari.forEach((item) => {
          const tanggal = new Date(`${item.tanggal}T12:00:00`);
          const selisihHari = Math.floor((akhirDate.getTime() - tanggal.getTime()) / 86400000);
          const indeksMinggu = Math.floor(selisihHari / 7);
          const adaPemasukan = item.txs.some(
            (tx) => tx.jenis === 'penjualan' && Number(tx.jumlah) > 0,
          );
          if (indeksMinggu >= 0 && indeksMinggu < 4 && adaPemasukan) {
            mingguAktif.add(indeksMinggu);
          }
        });

        const profil = profilResult.data;
        const profilLengkap = Boolean(
          profil?.jenis_usaha &&
          profil?.bentuk_usaha &&
          profil?.bidang_usaha?.trim() &&
          profil?.memiliki_persediaan !== null &&
          profil?.memiliki_persediaan !== undefined &&
          profil?.metode_pembayaran &&
          profil?.onboarding_completed_at,
        );

        const hariTercatat = tanggalTercatat.size;
        setNilai({
          loggedIn: true,
          hariTercatat,
          mingguBerpemasukan: mingguAktif.size,
          profilLengkap,
          laporanTersedia: hariTercatat > 0,
        });

        if (profilResult.error) {
          setLoadError('Sebagian informasi profil belum dapat dibaca. Periksa kembali profil usaha Anda.');
        }
      } catch (error) {
        if (aktif) {
          setLoadError(error instanceof Error ? error.message : 'Data nilai usaha belum dapat dimuat.');
        }
      } finally {
        if (aktif) setLoading(false);
      }
    }

    void muatNilai();
    return () => {
      aktif = false;
    };
  }, []);

  const skor = useMemo(() => {
    const pencatatan = Math.min(nilai.hariTercatat, 30) / 30;
    const pemasukan = Math.min(nilai.mingguBerpemasukan, 4) / 4;
    return Math.round(
      pencatatan * 35 +
      pemasukan * 25 +
      (nilai.profilLengkap ? 25 : 0) +
      (nilai.laporanTersedia ? 15 : 0),
    );
  }, [nilai]);

  const statusSkor = loading
    ? 'Memeriksa data'
    : !nilai.loggedIn
      ? 'Mode tamu'
      : skor >= 85
        ? 'Catatan usaha kuat'
        : skor >= 65
          ? 'Hampir siap'
          : skor >= 40
            ? 'Sedang berkembang'
            : 'Mulai membangun catatan';

  const deskripsiSkor = loading
    ? 'CAVA sedang menghitung ringkasan dari catatan usaha Anda.'
    : !nilai.loggedIn
      ? 'Masuk ke akun agar penilaian dihitung dari catatan usaha yang tersimpan.'
      : nilai.hariTercatat === 0
        ? 'Belum ada pencatatan dalam 30 hari terakhir. Mulai dari mencatat transaksi harian.'
        : 'Nilai ini dirangkum dari konsistensi pencatatan, aktivitas pemasukan, kelengkapan profil, dan ketersediaan laporan.';

  const kriteria = [
    {
      selesai: nilai.hariTercatat >= 24,
      judul: `Pencatatan ${nilai.hariTercatat} dari 30 hari`,
      detail: 'Target konsistensi pencatatan minimal 24 hari.',
    },
    {
      selesai: nilai.mingguBerpemasukan >= 4,
      judul: `Pemasukan tercatat di ${nilai.mingguBerpemasukan} dari 4 pekan`,
      detail: 'Usahakan ada transaksi pemasukan pada setiap pekan.',
    },
    {
      selesai: nilai.profilLengkap,
      judul: 'Profil usaha lengkap',
      detail: 'Jenis, bentuk, bidang, persediaan, dan metode pembayaran sudah diisi.',
    },
    {
      selesai: nilai.laporanTersedia,
      judul: 'Data 30 hari tersedia untuk dirangkum',
      detail: 'Catatan harian akan menjadi dasar laporan usaha.',
    },
  ];

  const cicilanPerBulan = useMemo(
    () => Math.round(anuitas(pinjamanSimulasi, 6, tenorSimulasi)),
    [pinjamanSimulasi, tenorSimulasi],
  );

  async function handleDownloadPdf() {
    if (!areaRef.current || downloading) return;
    setDownloading(true);
    try {
      await exportPdf(
        areaRef.current,
        `CAVA-Rapor-Nilai-Usaha-${todayISO()}.pdf`,
        'CAVA · Rapor Nilai Usaha',
      );
    } catch (error) {
      console.error('Gagal membuat rapor PDF:', error);
      setLoadError('Rapor PDF belum berhasil dibuat. Silakan coba lagi.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="wrap" ref={areaRef}>
      <div className="header-app">
        <div className="min-w-0">
          <h1>Nilai Usaha</h1>
          <p>Ringkasan perkembangan 30 hari terakhir</p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-[#CEE5D6]">
          <TrendingUp size={22} />
        </div>
      </div>

      {loadError && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">
          {loadError}
        </div>
      )}

      <Rise delay={0.02}>
        <section className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[#103A57] p-5 text-white  sm:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#307B8E]/35 blur-3xl" />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.2em] text-[#A9D3C5]">SKOR KESIAPAN USAHA</p>
              <p className="mt-1 text-[11px] text-white/60">Berdasarkan data yang tercatat di CAVA</p>
            </div>
            <span className="rounded-full border border-[#A9D3C5]/25 bg-white/10 px-3 py-1.5 text-[10px] font-extrabold text-[#CEE5D6]">
              {statusSkor}
            </span>
          </div>

          <div className="relative z-10 mt-5 flex items-center gap-5">
            <div className="relative grid h-28 w-28 shrink-0 place-items-center">
              <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" role="img" aria-label={`Skor ${loading ? 'sedang dihitung' : skor + ' dari 100'}`}>
                <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.14)" strokeWidth="8" fill="transparent" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke="#A9D3C5"
                  strokeWidth="8"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 * (1 - (loading ? 0 : skor / 100))}
                  strokeLinecap="round"
                  fill="transparent"
                  initial={{ strokeDashoffset: 251.2 }}
                  animate={{ strokeDashoffset: 251.2 * (1 - (loading ? 0 : skor / 100)) }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </svg>
              <div className="relative flex flex-col items-center">
                <span className="text-3xl font-black leading-none tabular-nums text-white">{loading ? '—' : skor}</span>
                <span className="mt-1 text-[9px] font-bold tracking-wider text-[#A9D3C5]">DARI 100</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-extrabold leading-snug text-white">
                {loading ? 'Menghitung nilai usaha…' : !nilai.loggedIn ? 'Masuk untuk melihat nilai usaha' : statusSkor}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-white/75">{deskripsiSkor}</p>
              {!nilai.loggedIn && !loading && (
                <Link href="/login" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#A9D3C5] px-3 py-2 text-[10px] font-extrabold text-[#103A57]">
                  Masuk ke akun <ArrowRight size={13} />
                </Link>
              )}
            </div>
          </div>
          <p className="relative z-10 mt-5 border-t border-white/10 pt-3 text-[10px] leading-5 text-white/55">
            Skor merupakan ringkasan internal CAVA, bukan penilaian resmi bank dan bukan jaminan persetujuan pembiayaan.
          </p>
        </section>
      </Rise>

      <Rise delay={0.05}>
        <section className="rounded-3xl border border-[#307B8E]/10 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-[#103A57]">Aspek penilaian</h2>
              <p className="mt-1 text-[10px] font-medium text-slate-500">Empat bagian yang membentuk skor usaha</p>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#CEE5D6]/60 text-[#307B8E]">
              <CalendarDays size={18} />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {kriteria.map((item, index) => (
              <div key={item.judul} className="flex items-start gap-3 py-3.5">
                <div className="mt-0.5 shrink-0">
                  {loading ? (
                    <Circle size={19} className="text-slate-300" />
                  ) : item.selesai ? (
                    <CheckCircle2 size={19} className="text-[#366B2B]" />
                  ) : (
                    <Circle size={19} className="text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-extrabold ${item.selesai ? 'text-[#103A57]' : 'text-slate-600'}`}>{item.judul}</p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">{item.detail}</p>
                </div>
                <span className="pt-0.5 text-[9px] font-extrabold text-slate-300">{index + 1}/4</span>
              </div>
            ))}
          </div>

          <Link href="/pengaturan-usaha" className="mt-3 inline-flex items-center gap-2 text-[11px] font-extrabold text-[#307B8E] hover:text-[#103A57]">
            Periksa profil usaha <ArrowRight size={14} />
          </Link>
        </section>
      </Rise>

      <Rise delay={0.08}>
        <section className="rounded-3xl border border-[#307B8E]/10 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.16em] text-[#307B8E]">PERENCANAAN</p>
              <h2 className="mt-1 text-sm font-black text-[#103A57]">Simulasi cicilan</h2>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">Ubah nominal dan tenor untuk melihat perkiraan pembayaran.</p>
            </div>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#CEE5D6]/60 text-[#103A57]">
              <Wallet size={19} />
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-[#CEE5D6]/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold text-slate-500">Nominal simulasi</span>
              <strong className="text-sm font-black tabular-nums text-[#103A57]">{rupiah(pinjamanSimulasi)}</strong>
            </div>
            <input
              type="range"
              min={1000000}
              max={25000000}
              step={500000}
              value={pinjamanSimulasi}
              onChange={(event) => setPinjamanSimulasi(Number(event.target.value))}
              className="loan-range mt-4"
              aria-label="Nominal simulasi pembiayaan"
            />
            <div className="mt-1 flex justify-between text-[9px] font-semibold text-slate-400">
              <span>Rp1 juta</span>
              <span>Rp25 juta</span>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold text-slate-500">Jangka waktu</p>
            <div className="grid grid-cols-3 gap-2">
              {[12, 24, 36].map((bulan) => (
                <button
                  key={bulan}
                  type="button"
                  onClick={() => setTenorSimulasi(bulan)}
                  aria-pressed={tenorSimulasi === bulan}
                  className={`rounded-xl border px-3 py-2.5 text-[11px] font-extrabold transition ${tenorSimulasi === bulan ? 'border-[#103A57] bg-[#103A57] text-white shadow-sm' : 'border-[#307B8E]/15 bg-white text-[#103A57] hover:bg-[#CEE5D6]/35'}`}
                >
                  {bulan} bulan
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-[#103A57] p-4 text-white">
            <div>
              <p className="text-[10px] font-bold text-[#A9D3C5]">Perkiraan cicilan per bulan</p>
              <p className="mt-1 text-xl font-black tabular-nums">{rupiah(cicilanPerBulan)}</p>
            </div>
            <span className="pb-1 text-[9px] font-bold text-white/65">{tenorSimulasi} bulan</span>
          </div>
          <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-slate-400">
            <Info size={13} className="mt-0.5 shrink-0 text-[#307B8E]" />
            Contoh perhitungan dengan asumsi bunga 6% per tahun. Angka sebenarnya bergantung pada lembaga pembiayaan dan ketentuan yang berlaku.
          </p>
        </section>
      </Rise>

      <Rise delay={0.1}>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloading || loading || !nilai.loggedIn}
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#103A57] px-5 py-4 text-xs font-extrabold text-white shadow-lg shadow-[#103A57]/15 transition hover:bg-[#174968] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={17} />
          {downloading ? 'Menyiapkan PDF…' : 'Unduh rapor usaha'}
        </button>
        {!nilai.loggedIn && !loading && (
          <p className="mt-2 text-center text-[10px] font-semibold text-slate-400">Masuk ke akun untuk membuat rapor dari data tersimpan.</p>
        )}
      </Rise>

      <BottomNav />
    </div>
  );
}
