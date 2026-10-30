'use client';
import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';
import { rupiah } from '@/lib/accounting';

/** Angka rupiah yang berputar menuju nilai baru (dipakai saat QRIS masuk). */
export default function AnimatedRupiah({ value }: { value: number }) {
  const [tampil, setTampil] = useState(value);
  const kini = useRef(value);
  useEffect(() => {
    const c = animate(kini.current, value, {
      duration: 0.9, ease: 'easeOut',
      onUpdate: (x) => { kini.current = x; setTampil(Math.round(x)); },
    });
    return () => c.stop();
  }, [value]);
  return <>{rupiah(tampil)}</>;
}
