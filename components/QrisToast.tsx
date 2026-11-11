'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { BellRing } from 'lucide-react';
import { rupiah } from '@/lib/accounting';

export type QrisToastData = {
  key: string;
  jumlah: number;
  invoiceNo?: string;
  nominalCocok?: boolean;
  title?: string;
  detail?: string;
};

/**
 * Notifikasi uang masuk. Wadah luar memusatkan kartu dengan flexbox dan memberi
 * jarak dari poni/status bar; kartu hanya dianimasikan pada sumbu Y supaya tidak
 * bertabrakan dengan translate bawaan Tailwind (penyebab toast bergeser keluar layar).
 */
export default function QrisToast({ data }: { data: QrisToastData | null }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[110] flex justify-center px-3"
      style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
      aria-live="polite"
    >
      <AnimatePresence>
        {data && (
          <motion.div
            key={data.key}
            role="status"
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl border border-[#A9D3C5]/40 bg-[#103A57] p-3.5 text-white shadow-[0_18px_40px_-12px_rgba(16,58,87,0.55)]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#A9D3C5]">
              <BellRing size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[11px] font-bold leading-snug text-[#A9D3C5]">
                {data.title || (data.nominalCocok ? 'Notifikasi QRIS sesuai nominal' : 'Uang masuk QRIS')}
              </p>
              <p className="m-0 mt-0.5 text-xl font-black leading-tight tabular-nums">{rupiah(data.jumlah)}</p>
              {data.detail && (
                <p className="m-0 mt-1 break-words text-[11px] font-semibold leading-snug text-white/80">{data.detail}</p>
              )}
              {data.invoiceNo && (
                <p className="m-0 mt-1 break-words text-[11px] font-semibold leading-snug text-white/80">
                  Nominal sama dengan {data.invoiceNo}. Periksa mutasi GoPay Merchant; invoice tidak otomatis lunas.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
