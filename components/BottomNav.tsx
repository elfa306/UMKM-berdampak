'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', ico: '🧾', label: 'Kasir' },
  { href: '/riwayat', ico: '🕘', label: 'Riwayat' },
  { href: '/statistik', ico: '📊', label: 'Statistik' },
  { href: '/harga', ico: '🛒', label: 'Harga' },
];

export default function BottomNav() {
  const p = usePathname();
  return (
    <nav className="bottom-nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={p === i.href ? 'active' : ''}>
          <span>{i.ico}</span>{i.label}
        </Link>
      ))}
    </nav>
  );
}
