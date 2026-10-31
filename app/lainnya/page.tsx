'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';
import { Press, Rise } from '@/components/Motion';

const menu = [
  { href: '/integrasi', ico: '🔗', judul: 'Hubungkan QRIS', ket: 'Pasang MacroDroid supaya QRIS tercatat otomatis' },
  { href: '/reset-password', ico: '🔑', judul: 'Ganti Kata Sandi', ket: 'Ubah kata sandi akun Anda' },
];

export default function Lainnya() {
  const router = useRouter();
  async function keluar() { await supabase.auth.signOut(); router.replace('/login'); }
  return (
    <div className="wrap">
      <div className="header-app"><h1>Menu <span>Lainnya</span></h1><p>Alat bantu usaha</p></div>
      {menu.map((m, i) => (
        <Rise key={m.href} delay={i * 0.06}>
          <Link href={m.href} className="glass-card" style={{ gridAutoFlow: 'column', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: '1.8rem' }}>{m.ico}</span>
            <span><b style={{ display: 'block' }}>{m.judul}</b><span className="muted">{m.ket}</span></span>
          </Link>
        </Rise>
      ))}
      <Press className="btn-soft" onClick={keluar}>Keluar</Press>
      <BottomNav />
    </div>
  );
}
