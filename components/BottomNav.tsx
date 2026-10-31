'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { membal } from './Motion';

const items = [
  { href: '/kasir', ico: '🧾', label: 'Kasir' },
  { href: '/statistik', ico: '📊', label: 'Laporan' }, // Riwayat + Statistik dalam satu halaman
  { href: '/kredit', ico: '🏦', label: 'Kredit' },
  { href: '/harga', ico: '🛒', label: 'Cek Harga' },
  { href: '/lainnya', ico: '☰', label: 'Lainnya' },
];
// Halaman turunan tetap menyalakan tab induknya
const turunan: Record<string, string[]> = {
  '/statistik': ['/riwayat'],
  '/kredit': ['/rekomendasi'],
  '/lainnya': ['/integrasi', '/reset-password'],
};

export default function BottomNav() {
  const p = usePathname();
  return (
    <nav className="bottom-nav" data-html2canvas-ignore>
      {items.map((i) => {
        const aktif = p === i.href || (turunan[i.href]?.includes(p) ?? false);
        return (
          <motion.div key={i.href} whileTap={{ scale: 0.88 }} transition={membal} style={{ display: 'contents' }}>
            <Link href={i.href} className={aktif ? 'active' : ''}>
              {aktif && <motion.i layoutId="navpill" className="pill" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
              <span>{i.ico}</span><em>{i.label}</em>
            </Link>
          </motion.div>
        );
      })}
    </nav>
  );
}
