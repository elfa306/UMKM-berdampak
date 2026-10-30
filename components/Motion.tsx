'use client';
import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode, CSSProperties } from 'react';

export const membal = { type: 'spring', stiffness: 520, damping: 17, mass: 0.6 } as const;

/** Tombol dengan efek menekan lalu membal, seperti iOS. */
export function Press(props: HTMLMotionProps<'button'>) {
  return <motion.button whileTap={{ scale: 0.93 }} transition={membal} {...props} />;
}

/** Kartu yang naik pelan saat muncul. `delay` untuk efek berurutan. */
export function Rise({ children, delay = 0, className, style }: { children: ReactNode; delay?: number; className?: string; style?: CSSProperties }) {
  return (
    <motion.div className={className} style={style}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 26 }}>
      {children}
    </motion.div>
  );
}
