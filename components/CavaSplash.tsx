'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Splash mengikuti Splash.pdf: latar Prussian Blue, emblem V, wordmark CAVA,
 * subjudul CASH VALUE, dan lengkung Teal di bagian bawah.
 * Tampil sekali per sesi (logika tidak berubah).
 */
export default function CavaSplash() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hasSeen = sessionStorage.getItem('cava_splash_seen');
    if (!hasSeen) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        sessionStorage.setItem('cava_splash_seen', 'true');
      }, 1600);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="cava-splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] flex select-none flex-col items-center justify-center overflow-hidden bg-[#103A57]"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 -mt-10 flex flex-col items-center"
          >
            <img
              src="/cava-v-exact.png"
              alt="CAVA"
              draggable={false}
              className="h-auto w-[132px] object-contain sm:w-[150px]"
            />
            <h1 className="mt-9 pl-[0.4em] text-[2.6rem] font-extrabold leading-none tracking-[0.4em] text-[#CEE5D6] sm:text-5xl">
              CAVA
            </h1>
            <p className="mt-9 pl-[0.3em] text-[0.8rem] font-bold tracking-[0.3em] text-[#A9D3C5]">
              CASH VALUE
            </p>
          </motion.div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-[16%] left-1/2 h-[30%] w-[160%] -translate-x-1/2 rounded-[50%] bg-[#205874]"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
