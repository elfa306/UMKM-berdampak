'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function DemoQRCode({ value, imageUrl, label = 'QRIS Sandbox' }: { value?: string | null; imageUrl?: string | null; label?: string }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSrc('');
    setError('');
    if (value) {
      QRCode.toDataURL(value, { width: 280, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
        .then((dataUrl) => { if (active) setSrc(dataUrl); })
        .catch(() => { if (active) setError('QR tidak dapat dirender.'); });
    } else if (imageUrl) {
      try {
        const url = new URL(imageUrl);
        if (url.protocol === 'https:' && url.hostname === 'link.belibayar.id') setSrc(imageUrl);
        else setError('Alamat gambar QR dari provider tidak dikenali.');
      } catch {
        setError('Alamat gambar QR tidak valid.');
      }
    } else {
      setError('Data QRIS belum tersedia.');
    }
    return () => { active = false; };
  }, [value, imageUrl]);

  return (
    <div className="mx-auto grid w-fit justify-items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      {src ? <img src={src} alt={label} width={220} height={220} className="h-[220px] w-[220px] object-contain" /> : (
        <div className="grid h-[220px] w-[220px] place-items-center rounded-xl bg-slate-50 px-4 text-center text-xs text-slate-500">{error || 'Menyiapkan QRIS...'}</div>
      )}
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  );
}
