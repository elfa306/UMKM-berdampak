'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Factory,
  Play,
  ShoppingBasket,
  Store,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

type JenisUsaha = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
type ModeDemo = 'eksplorasi' | 'guided';

type PilihanUsaha = {
  id: JenisUsaha;
  nama: string;
  ringkasan: string;
  contoh: string;
  ikon: LucideIcon;
  rekomendasi: string;
  fitur: string[];
};

const PILIHAN_USAHA: PilihanUsaha[] = [
  {
    id: 'retail',
    nama: 'Retail / Perdagangan',
    ringkasan: 'Membeli barang jadi lalu menjualnya kembali.',
    contoh: 'Warung Madura, toko sembako, toko pakaian, dan reseller.',
    ikon: Store,
    rekomendasi: 'POS dan persediaan barang dagangan',
    fitur: ['Kasir dan invoice', 'Barang masuk dan keluar', 'Stok dan harga pokok penjualan'],
  },
  {
    id: 'manufaktur',
    nama: 'Manufaktur / Produksi',
    ringkasan: 'Mengolah bahan baku menjadi produk yang siap dijual.',
    contoh: 'Usaha keripik, makanan kemasan, konveksi, dan kerajinan.',
    ikon: Factory,
    rekomendasi: 'Bahan baku, proses produksi, dan HPP',
    fitur: ['Resep atau komposisi produksi', 'Biaya bahan dan tenaga kerja', 'Persediaan barang jadi'],
  },
  {
    id: 'jasa',
    nama: 'Jasa',
    ringkasan: 'Menjual layanan atau keterampilan kepada pelanggan.',
    contoh: 'Barbershop, laundry, bengkel, dan jasa desain.',
    ikon: BriefcaseBusiness,
    rekomendasi: 'Pendapatan jasa dan biaya operasional',
    fitur: ['Catatan layanan', 'Pendapatan dan biaya', 'Riwayat pelanggan atau pesanan'],
  },
  {
    id: 'campuran',
    nama: 'Usaha Campuran',
    ringkasan: 'Memproduksi barang sendiri sekaligus menjual barang lain.',
    contoh: 'Kedai kopi, bakery, atau usaha makanan dengan produk titipan.',
    ikon: ShoppingBasket,
    rekomendasi: 'POS, persediaan, dan produksi sesuai kebutuhan',
    fitur: ['Penjualan produk sendiri dan dagangan', 'Stok dengan jenis berbeda', 'Perhitungan biaya yang terpisah'],
  },
];

const MODE_DEMO: { id: ModeDemo; nama: string; ringkasan: string; label: string; ikon: LucideIcon }[] = [
  {
    id: 'eksplorasi',
    nama: 'Eksplorasi Bebas',
    ringkasan: 'Jelajahi menu dan coba fitur sesuai keinginan tanpa urutan tertentu.',
    label: 'Cocok untuk mencoba sendiri',
    ikon: Play,
  },
  {
    id: 'guided',
    nama: 'Guided Demo',
    ringkasan: 'Ikuti misi singkat dari menambah produk, mencatat transaksi, hingga melihat laporan.',
    label: 'Cocok untuk presentasi',
    ikon: Check,
  },
];

export default function InteractiveDemoPage() {
  const router = useRouter();
  const [jenisUsaha, setJenisUsaha] = useState<JenisUsaha | ''>('');
  const [mode, setMode] = useState<ModeDemo>('guided');
  const [error, setError] = useState('');

  const usahaDipilih = useMemo(
    () => PILIHAN_USAHA.find((item) => item.id === jenisUsaha),
    [jenisUsaha],
  );

  function lanjutkan() {
    if (!jenisUsaha) {
      setError('Pilih jenis usaha terlebih dahulu agar contoh demonstrasinya sesuai.');
      return;
    }
    setError('');
    router.push(`/demo/persiapan?jenis=${jenisUsaha}&mode=${mode}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-extrabold text-slate-800 transition hover:bg-white">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Store size={19} /></span>
            <span>UMKM <span className="text-emerald-600">Berdampak</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-amber-800">DEMO MODE</span>
            <Link href="/login" className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-slate-300 sm:inline-flex">Masuk akun</Link>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-8 text-white shadow-xl sm:px-10 sm:py-11">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-blue-400/10 blur-3xl" />
          <div className="relative grid gap-7 md:grid-cols-[1.3fr_.7fr] md:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-emerald-200">
                <Play size={14} /> Interactive Demo
              </div>
              <h1 className="max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-5xl">
                Coba kelola usaha, <span className="text-emerald-300">langsung dari sini.</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Pilih jenis usaha dan cara mencoba. Kamu bisa mengenal alur kasir, persediaan, produksi, dan laporan keuangan melalui lingkungan demonstrasi.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400/15 text-emerald-200"><WalletCards size={22} /></div>
                <div>
                  <p className="text-sm font-extrabold">Tanpa daftar akun</p>
                  <p className="mt-0.5 text-xs text-slate-300">Tidak memakai uang sungguhan</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-300">Seluruh transaksi demonstrasi akan diberi penanda khusus dan dipisahkan dari catatan usaha asli.</p>
            </div>
          </div>
        </section>

        <section className="mt-9">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Langkah 1</p>
              <h2 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Usaha apa yang ingin kamu coba?</h2>
              <p className="mt-1 text-sm text-slate-500">Pilih contoh yang paling dekat dengan kegiatan usahamu.</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">4 jenis usaha</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PILIHAN_USAHA.map((item) => {
              const Icon = item.ikon;
              const selected = jenisUsaha === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setJenisUsaha(item.id); setError(''); }}
                  aria-pressed={selected}
                  className={`group relative flex h-full flex-col rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`grid h-12 w-12 place-items-center rounded-2xl ${selected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600 group-hover:bg-emerald-50 group-hover:text-emerald-700'}`}><Icon size={23} /></span>
                    {selected && <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white"><Check size={14} /></span>}
                  </div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{item.nama}</h3>
                  <p className="mt-1 min-h-[42px] text-xs leading-5 text-slate-500">{item.ringkasan}</p>
                  <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">Contoh: {item.contoh}</p>
                  <div className={`mt-4 rounded-xl px-3 py-2 text-[11px] font-bold leading-4 ${selected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>
                    Fokus demo: {item.rekomendasi}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-9">
          <div className="mb-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Langkah 2</p>
            <h2 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Bagaimana kamu ingin mencoba?</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {MODE_DEMO.map((item) => {
              const Icon = item.ikon;
              const selected = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  aria-pressed={selected}
                  className={`flex items-start gap-4 rounded-2xl border bg-white p-4 text-left shadow-sm transition ${selected ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${selected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}><Icon size={21} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-slate-900">{item.nama}{selected && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">Dipilih</span>}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{item.ringkasan}</span>
                    <span className="mt-2 block text-[11px] font-bold text-emerald-700">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">Ringkasan pilihan</p>
              <p className="mt-1 text-sm font-extrabold text-slate-900">{usahaDipilih ? usahaDipilih.nama : 'Belum memilih jenis usaha'}</p>
              <p className="mt-1 text-xs text-slate-500">Mode: {mode === 'guided' ? 'Guided Demo (mengikuti misi)' : 'Eksplorasi Bebas'}</p>
              {usahaDipilih && <p className="mt-2 text-xs leading-5 text-slate-500">Yang akan dicoba: {usahaDipilih.fitur.join(' · ')}</p>}
              {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
            </div>
            <button
              type="button"
              onClick={lanjutkan}
              disabled={!jenisUsaha}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              Siapkan demonstrasi <ArrowRight size={17} />
            </button>
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-2 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>DEMO MODE · Data demonstrasi bukan catatan transaksi nyata.</span>
          <Link href="/" className="inline-flex items-center gap-1 font-bold text-slate-600 hover:text-emerald-700"><ArrowLeft size={13} /> Kembali ke halaman utama</Link>
        </footer>
      </div>
    </main>
  );
}
