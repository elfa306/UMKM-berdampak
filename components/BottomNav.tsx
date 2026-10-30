'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { membal } from './Motion';

const items = [
  { href: '/kasir', ico: '🧾', label: 'Kasir' },
  { href: '/riwayat', ico: '🕘', label: 'Riwayat' },
  { href: '/statistik', ico: '📊', label: 'Statistik' },
  { href: '/kredit', ico: '🏦', label: 'Kredit' },
  { href: '/lainnya', ico: '☰', label: 'Lainnya' },
];
// Halaman di bawah menu "Lainnya" tetap menyalakan tab Lainnya
const turunanLainnya = ['/harga', '/integrasi'];

export default function BottomNav() {
  const p = usePathname();
  return (
    <nav className="bottom-nav" data-html2canvas-ignore>
      {items.map((i) => {
        const aktif = p === i.href || (i.href === '/lainnya' && turunanLainnya.includes(p));
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
