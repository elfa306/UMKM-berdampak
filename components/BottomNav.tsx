'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  Home, 
  History, 
  Landmark,
  User, 
  Boxes, 
  TrendingUp, 
  Sparkles, 
  PlusCircle, 
  Settings,
  LogOut
} from 'lucide-react';
import QuickRecordModal from './QuickRecordModal';
import { announceTransactionSaved, OPEN_CATAT_EVENT } from '@/lib/quickSession';
import { CavaLogo, CavaVMark } from './CavaLogo';
import { supabase } from '@/lib/supabase';

export default function BottomNav() {
  const p = usePathname();
  const [showCatatModal, setShowCatatModal] = useState(false);
  const [catatAwal, setCatatAwal] = useState<{ type: 'masuk' | 'keluar' | 'modal'; metode: 'tunai' | 'qris' }>({ type: 'masuk', metode: 'tunai' });

  // Halaman lain (mis. Aksi Cepat di beranda) membuka modal ini lewat event, supaya hanya ada satu modal.
  useEffect(() => {
    const buka = (e: Event) => {
      const d = (e as CustomEvent<{ type?: 'masuk' | 'keluar' | 'modal'; metode?: 'tunai' | 'qris' }>).detail ?? {};
      setCatatAwal({ type: d.type ?? 'masuk', metode: d.metode ?? 'tunai' });
      setShowCatatModal(true);
    };
    window.addEventListener(OPEN_CATAT_EVENT, buka);
    return () => window.removeEventListener(OPEN_CATAT_EVENT, buka);
  }, []);
  const [namaUsaha, setNamaUsaha] = useState('[Nama Usaha]');

  useEffect(() => {
    let aktif = true;

    async function muatNamaUsaha() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!aktif) return;

      if (!user) {
        setNamaUsaha('Mode Tamu');
        return;
      }

      const { data: profil } = await supabase
        .from('business_profiles')
        .select('nama_usaha')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!aktif) return;
      const namaProfil = typeof profil?.nama_usaha === 'string' ? profil.nama_usaha.trim() : '';
      const namaMetadata = typeof user.user_metadata?.nama_usaha === 'string' ? user.user_metadata.nama_usaha.trim() : '';
      const namaAkun = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
      setNamaUsaha(namaProfil || namaMetadata || namaAkun || 'Usaha saya');
    }

    void muatNamaUsaha();
    return () => { aktif = false; };
  }, []);

  const isBeranda = p === '/kasir' || p === '/';
  const isRiwayat = p === '/laporan';
  const isPembiayaan = p === '/pembiayaan';
  const isInventaris = p === '/inventaris';
  const isHarga = p === '/harga';
  const isAkun = p === '/lainnya' || p === '/pengaturan-usaha' || p === '/integrasi';
  const isDemo = p?.startsWith('/demo');

  const navLinks = [
    { href: '/kasir', label: 'Beranda', icon: Home, active: isBeranda },
    { href: '/laporan', label: 'Riwayat & Laporan', icon: History, active: isRiwayat },
    { href: '/pembiayaan', label: 'Rekomendasi Pembiayaan', icon: Landmark, active: isPembiayaan },
    { href: '/inventaris', label: 'Inventaris & Stok', icon: Boxes, active: isInventaris },
    { href: '/harga', label: 'Cek Harga Bahan', icon: TrendingUp, active: isHarga },
    { href: '/lainnya', label: 'Pengaturan & Akun', icon: Settings, active: isAkun },
    { href: '/demo', label: 'Ruang Demo', icon: Sparkles, active: isDemo },
  ];

  return (
    <>
      {/* Navigasi bawah (ponsel) */}
      <nav
        className="lg:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-[#103A57]/10 px-2 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-[0_-6px_20px_-10px_rgba(16,58,87,0.25)] z-50 grid grid-cols-5 items-end"
        data-html2canvas-ignore
        aria-label="Menu utama"
      >
        {[
          { href: '/kasir', label: 'Beranda', Icon: Home, on: isBeranda },
          { href: '/laporan', label: 'Riwayat', Icon: History, on: isRiwayat },
        ].map(({ href, label, Icon, on }) => (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className="flex flex-col items-center gap-0.5 py-1">
            <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? 'bg-[#CEE5D6] text-[#103A57]' : 'text-slate-400'}`}>
              <Icon size={21} strokeWidth={on ? 2.4 : 1.8} />
            </span>
            <span className={`text-[10.5px] ${on ? 'font-extrabold text-[#103A57]' : 'font-semibold text-slate-500'}`}>{label}</span>
          </Link>
        ))}

        <div className="flex flex-col items-center">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => { setCatatAwal({ type: 'masuk', metode: 'tunai' }); setShowCatatModal(true); }}
            aria-label="Catat transaksi"
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-[#103A57] text-white shadow-[0_8px_18px_rgba(16,58,87,0.35)] ring-4 ring-white"
          >
            <CavaVMark size={28} />
          </motion.button>
          <span className="mt-0.5 py-1 text-[10.5px] font-extrabold text-[#103A57]">Catat</span>
        </div>

        {[
          { href: '/pembiayaan', label: 'Pembiayaan', Icon: Landmark, on: isPembiayaan },
          { href: '/lainnya', label: 'Akun', Icon: User, on: isAkun },
        ].map(({ href, label, Icon, on }) => (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className="flex flex-col items-center gap-0.5 py-1">
            <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? 'bg-[#CEE5D6] text-[#103A57]' : 'text-slate-400'}`}>
              <Icon size={21} strokeWidth={on ? 2.4 : 1.8} />
            </span>
            <span className={`text-[10.5px] ${on ? 'font-extrabold text-[#103A57]' : 'font-semibold text-slate-500'}`}>{label}</span>
          </Link>
        ))}
      </nav>

      {/* ===================================================================
        * 2. DESKTOP SIDEBAR (Visible on lg: screens and above)
        * =================================================================== */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 bg-[#103A57] text-white z-40 p-5 flex-col justify-between "
        data-html2canvas-ignore
      >
        <div className="space-y-6">
          {/* Logo brand lockup */}
          <div className="pt-2 px-2">
            <Link href="/kasir" className="inline-block transition-transform hover:scale-105">
              <CavaLogo variant="horizontal" height={34} light={true} />
            </Link>
          </div>

          {/* Quick Catat CTA Button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            onClick={() => { setCatatAwal({ type: 'masuk', metode: 'tunai' }); setShowCatatModal(true); }}
            className="w-full py-3 px-4 rounded-xl bg-[#CEE5D6] hover:bg-white text-[#103A57] font-extrabold text-xs flex items-center justify-center gap-2.5 transition-all"
          >
            <CavaVMark size={18} />
            <span>Catat transaksi</span>
          </motion.button>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    item.active
                      ? 'bg-white text-[#103A57]'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} strokeWidth={item.active ? 2.5 : 2} className={item.active ? 'text-[#307B8E]' : 'text-white/60'} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Card at bottom of sidebar */}
        <div className="pt-4 border-t border-white/10">
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10">
            <div className="min-w-0 flex-1 pr-2">
              <div className="text-xs font-black truncate text-white">{namaUsaha}</div>
              <div className="text-[10px] text-[#A9D3C5] truncate">CAVA UMKM Aktif</div>
            </div>
            <Link
              href="/lainnya"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              title="Pengaturan"
            >
              <Settings size={15} />
            </Link>
          </div>
        </div>
      </aside>

      {/* Global Quick Record Modal */}
      <QuickRecordModal
        isOpen={showCatatModal}
        onClose={() => setShowCatatModal(false)}
        initialType={catatAwal.type}
        initialMetode={catatAwal.metode}
        onSuccess={(detail) => announceTransactionSaved(detail)}
      />
    </>
  );
}
