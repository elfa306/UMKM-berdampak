'use client';

import { QrCode } from 'lucide-react';
import DemoQRCode from '@/components/demo/DemoQRCode';

export default function DemoStaticQrisPanel() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-800"><QrCode size={18} /><h2 className="text-sm font-black">QRIS Statis · Contoh</h2></div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Gambar contoh yang sama dengan pratinjau QRIS dinamis pada kasir demo.</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-black text-amber-800">DISPLAY ONLY</span>
      </div>
      <div className="mt-4"><DemoQRCode imageUrl="/qris-contoh.png" label="QRIS Statis Contoh" /></div>
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">QRIS ini hanya gambar contoh dan tidak menerima pembayaran. Melihat atau memindai gambar ini tidak membuat transaksi, tidak mengubah stok, dan tidak membuat jurnal. Gunakan simulasi internal pada invoice untuk mencoba alur demo.</p>
    </section>
  );
}
