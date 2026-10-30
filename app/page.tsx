'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { membal } from '@/components/Motion';

const masuk = (i: number) => ({ initial: { opacity: 0, y: 24, scale: 0.97 }, whileInView: { opacity: 1, y: 0, scale: 1 }, viewport: { once: true, margin: '-30px' }, transition: { delay: i * 0.06, type: 'spring' as const, stiffness: 220, damping: 24 } });

export default function Landing() {
  const router = useRouter();
  // Sudah login? langsung ke kasir
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace('/kasir'); }); }, [router]);

  return (
    <main className="landing">
      <nav><b>UMKM <span>Kasir</span></b><Link href="/login" className="btn-pill active">Masuk</Link></nav>

      <div className="bento">
        <motion.section className="b-hero" {...masuk(0)}>
          <div>
            <span className="b-tag">Kasir &amp; catatan untung untuk pedagang</span>
            <h1>Jualan lancar, <em>untung</em> kelihatan.</h1>
          </div>
          <p>Catat jualan dengan sekali ketuk. Tahu kapan balik modal, dan siap bawa catatan rapi ke bank saat butuh tambahan modal.</p>
          <div className="b-cta">
            <motion.span whileTap={{ scale: 0.94 }} transition={membal}><Link className="p" href="/login">Mulai gratis</Link></motion.span>
            <motion.span whileTap={{ scale: 0.94 }} transition={membal}><Link className="s" href="#fitur">Lihat fiturnya</Link></motion.span>
          </div>
        </motion.section>

        <motion.section className="b-chart" id="fitur" {...masuk(1)}>
          <span className="b-tag">Grafik untung</span>
          <h3>Lihat usaha Anda naik, hari demi hari</h3>
          <p className="k">Uang masuk dan untung bersih tergambar jelas. Hijau berarti untung, merah berarti perlu dicek.</p>
          <svg viewBox="0 0 300 110" style={{ width: '100%', marginTop: 8 }} aria-hidden>
            <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity=".35" /><stop offset="1" stopColor="#10b981" stopOpacity="0" /></linearGradient></defs>
            <motion.path d="M0 95 L40 82 L80 88 L120 62 L160 68 L200 40 L240 46 L300 12 L300 110 L0 110 Z" fill="url(#lg)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} viewport={{ once: true }} />
            <motion.path d="M0 95 L40 82 L80 88 L120 62 L160 68 L200 40 L240 46 L300 12" fill="none" stroke="#059669" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} transition={{ duration: 1.4, ease: 'easeOut' }} viewport={{ once: true }} />
            <motion.circle cx="300" cy="12" r="5" fill="#059669" initial={{ scale: 0 }} whileInView={{ scale: 1 }} transition={{ delay: 1.3, ...membal }} viewport={{ once: true }} />
          </svg>
        </motion.section>

        <motion.section className="b-qris" {...masuk(2)}>
          <span className="b-tag" style={{ color: '#047857' }}>QRIS otomatis</span>
          <h3>Pembeli bayar, kasir langsung bunyi “Ka-Ching!”</h3>
          <p className="k">Tidak perlu diketik dan tidak perlu refresh. Pembayaran QRIS tercatat sendiri begitu masuk.</p>
          <motion.div className="fake-toast" initial={{ x: -30, opacity: 0 }} whileInView={{ x: 0, opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 18 }}>
            <span style={{ fontSize: '1.5rem' }}>🔔</span><span>Pembayaran QRIS Masuk: Rp 25.000!</span>
          </motion.div>
        </motion.section>

        <motion.section className="b-s" {...masuk(3)}>
          <span className="b-tag">Target</span>
          <h3>Balik Modal</h3>
          <p className="k">Tiap pagi tahu “kurang berapa lagi” sampai modal kembali.</p>
          <div className="progress" style={{ height: 12, marginTop: 12 }}>
            <motion.i style={{ background: '#f59e0b' }} initial={{ width: 0 }} whileInView={{ width: '72%' }} viewport={{ once: true }} transition={{ delay: 0.4, duration: 1 }} />
          </div>
        </motion.section>

        <motion.section className="b-s" {...masuk(4)}>
          <span className="b-tag">Riwayat</span>
          <h3>Rapi seperti m-banking</h3>
          <p className="k"><b style={{ color: '#059669' }}>+Rp 15.000</b> uang masuk, <b style={{ color: '#dc2626' }}>-Rp 4.000</b> uang keluar. Angka sejajar, mudah dibaca.</p>
        </motion.section>

        <motion.section className="b-wide" {...masuk(5)}>
          <span className="b-tag">Rapor usaha</span>
          <h3>Siap diajukan ke bank</h3>
          <p className="k">Catatan 30 hari yang rapi jadi nilai usaha Anda. Unduh laporan Excel atau PDF untuk diserahkan saat mengajukan KUR.</p>
        </motion.section>

        <motion.section className="b-wide" {...masuk(6)}>
          <span className="b-tag">Belajar</span>
          <h3>Kalau suku bunga naik, cicilan jadi berapa?</h3>
          <p className="k">Simulasikan cicilan modal usaha dan lihat dampaknya ke untung Anda saat BI Rate berubah.</p>
        </motion.section>
      </div>
    </main>
  );
}
