'use client';

import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ArrowDownLeft, ArrowUpRight, Check, ShoppingBag, Delete, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rupiah, todayISO } from '@/lib/accounting';
import { kaChing } from '@/lib/sound';
import { ensureTodaySession, type QuickSavedDetail } from '@/lib/quickSession';
import CavaLogo from './CavaLogo';
import QrisCashier from './QrisCashier';

type QuickRecordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (detail?: QuickSavedDetail) => void;
  /** Tab yang terbuka saat modal dibuka (mis. dari tombol Jual / Keluar / QRIS di beranda). */
  initialType?: 'masuk' | 'keluar';
  initialMetode?: 'tunai' | 'qris';
};

export default function QuickRecordModal({
  isOpen,
  onClose,
  onSuccess,
  initialType = 'masuk',
  initialMetode = 'tunai',
}: QuickRecordModalProps) {
  const [type, setType] = useState<'masuk' | 'keluar'>('masuk');
  const [nominalStr, setNominalStr] = useState<string>('');
  const [keterangan, setKeterangan] = useState<string>('');
  const [metode, setMetode] = useState<'tunai' | 'qris'>('tunai');
  const [loading, setLoading] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [kategoriBiaya, setKategoriBiaya] = useState('Belanja bahan baku');
  const [errMsg, setErrMsg] = useState('');

  // Quick preset amounts
  const presets = [10000, 20000, 50000, 100000, 150000, 250000];

  const nominalNumber = parseInt(nominalStr, 10) || 0;

  // Handle calculator numpad
  const handleNumpad = (char: string) => {
    if (char === 'clear') {
      setNominalStr('');
      return;
    }
    if (char === 'back') {
      setNominalStr((prev) => prev.slice(0, -1));
      return;
    }
    if (nominalStr.length >= 10) return; // limit input
    setNominalStr((prev) => {
      const next = prev + char;
      // remove leading zero
      return next.replace(/^0+/, '');
    });
  };

  const handlePreset = (amount: number) => {
    setNominalStr(String(amount));
  };

  const selesai = (detail: QuickSavedDetail) => {
    kaChing();
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setNominalStr('');
      setKeterangan('');
      setLoading(false);
      if (onSuccess) onSuccess(detail);
      onClose();
    }, 900);
  };

  const handleSave = async () => {
    if (nominalNumber <= 0) return;
    setLoading(true);
    setErrMsg('');

    const jenis = type === 'masuk' ? 'penjualan' : 'biaya';
    const metodeTx = type === 'masuk' ? metode : null;
    const note = keterangan.trim() || (type === 'masuk' ? 'Penjualan tunai kasir' : kategoriBiaya);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // Mode tamu: tidak ada database, beranda menambahkan barisnya langsung dari event.
        selesai({
          guest: true,
          rows: [{ id: crypto.randomUUID(), jenis, keterangan: note, jumlah: nominalNumber, metode: metodeTx, qty: 1, created_at: new Date().toISOString() }],
        });
        return;
      }

      const sessionId = await ensureTodaySession(todayISO());
      if (!sessionId) {
        setLoading(false);
        setErrMsg('Sesi penjualan hari ini gagal dibuat. Transaksi belum tersimpan.');
        return;
      }

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          session_id: sessionId,
          user_id: user.id,
          jenis,
          keterangan: note,
          jumlah: nominalNumber,
          qty: 1,
          metode: metodeTx,
        })
        .select('*')
        .single();

      if (error || !data) {
        setLoading(false);
        setErrMsg(`Transaksi gagal disimpan${error ? `: ${error.message}` : '.'}`);
        return;
      }

      selesai({ guest: false, rows: [{ ...data, jumlah: Number(data.jumlah) }] });
    } catch {
      setLoading(false);
      setErrMsg('Tidak bisa menyimpan transaksi. Periksa koneksi internet lalu coba lagi.');
    }
  };

  // Saat modal dibuka, pakai tab yang diminta pemanggil.
  useEffect(() => {
    if (!isOpen) return;
    setType(initialType);
    setMetode(initialMetode);
    setErrMsg('');
  }, [isOpen, initialType, initialMetode]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#103A57]/60 backdrop-blur-sm"
          />

          {/* Bottom Sheet Modal */}
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative w-full max-w-lg rounded-t-[28px] sm:rounded-[24px] bg-white p-5 sm:p-6 shadow-2xl max-h-[92vh] flex flex-col overflow-y-auto"
          >
            {/* Grab Bar Header */}
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <CavaLogo variant="mark" size="sm" />
                <div>
                  <h2 className="text-base font-extrabold tracking-tight text-[#103A57]">Catat transaksi</h2>
                  <p className="text-[11px] font-semibold text-[#4F6B7C]">Pencatatan kas instan</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full bg-[#E3F0EA] text-[#103A57] hover:bg-[#CEE5D6] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Type Switcher: Masuk vs Keluar */}
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-[#E1EEE8] p-1">
              <button
                type="button"
                onClick={() => setType('masuk')}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition-colors ${
                  type === 'masuk'
                    ? 'bg-[#103A57] text-white'
                    : 'text-[#4F6B7C] hover:text-[#103A57]'
                }`}
              >
                <ArrowDownLeft size={16} className={type === 'masuk' ? 'text-[#A9D3C5]' : ''} />
                <span>Uang masuk</span>
              </button>
              <button
                type="button"
                onClick={() => setType('keluar')}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition-colors ${
                  type === 'keluar'
                    ? 'bg-[#991B1B] text-white'
                    : 'text-[#4F6B7C] hover:text-[#103A57]'
                }`}
              >
                <ArrowUpRight size={16} className={type === 'keluar' ? 'text-[#CEE5D6]' : ''} />
                <span>Uang keluar</span>
              </button>
            </div>

            {/* Big Amount Display (tidak dipakai di mode QRIS: harga terisi dari produk) */}
            {!(type === 'masuk' && metode === 'qris') && (
            <div className="mt-3 rounded-2xl bg-[#EEF5F1] p-4 text-center">
              <span className="text-xs font-bold text-[#4F6B7C]">
                {type === 'masuk' ? 'Nominal penjualan' : 'Nominal pengeluaran'}
              </span>
              <div className="mt-1 flex items-baseline justify-center gap-1">
                <span className={`text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight ${
                  type === 'masuk' ? 'text-[#103A57]' : 'text-[#991B1B]'
                }`}>
                  {rupiah(nominalNumber)}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-[#4F6B7C]">
                {nominalNumber > 0 ? (type === 'masuk' ? 'Akan ditambahkan ke pemasukan hari ini' : 'Akan dicatat sebagai beban operasional') : 'Ketik angka pada tombol di bawah'}
              </p>
            </div>
            )}

            {/* Quick Presets */}
            {!(type === 'masuk' && metode === 'qris') && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePreset(p)}
                  className="rounded-full bg-[#E3F0EA] px-3.5 py-2 text-[11px] font-extrabold text-[#103A57] hover:bg-[#CEE5D6] active:scale-95 transition shrink-0"
                >
                  +{p >= 1000 ? `${p / 1000}rb` : p}
                </button>
              ))}
            </div>
            )}

            {/* Method (Tunai vs QRIS for Masuk) or Category for Keluar */}
            {type === 'masuk' ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[#103A57]">Metode pembayaran</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#E1EEE8] p-1">
                  <button
                    type="button"
                    onClick={() => setMetode('tunai')}
                    className={`rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                      metode === 'tunai'
                        ? 'bg-[#103A57] text-white'
                        : 'text-[#4F6B7C]'
                    }`}
                  >
                    💵 Tunai
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetode('qris')}
                    className={`rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                      metode === 'qris'
                        ? 'bg-[#103A57] text-white'
                        : 'text-[#4F6B7C]'
                    }`}
                  >
                    📱 QRIS
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <select
                  value={kategoriBiaya}
                  onChange={(e) => setKategoriBiaya(e.target.value)}
                  className="w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#103A57]"
                >
                  <option value="Belanja bahan baku">🛒 Belanja bahan baku / stok</option>
                  <option value="Operasional & utilitas">💡 Listrik / Air / Gas</option>
                  <option value="Gaji & upah">👥 Upah / Tenaga kerja</option>
                  <option value="Sewa & pemeliharaan">🏠 Sewa tempat / Alat</option>
                  <option value="Pengeluaran lainnya">📦 Lain-lain</option>
                </select>
              </div>
            )}

            {/* Mode QRIS: pilih produk, tanpa mengetik harga */}
            {type === 'masuk' && metode === 'qris' && <QrisCashier active={isOpen} onRecorded={(detail) => { if (onSuccess) onSuccess(detail); }} />}

            {!(type === 'masuk' && metode === 'qris') && (<>
            {/* Note Input */}
            <input
              type="text"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder={type === 'masuk' ? 'Catatan (opsional, mis. 2 Kopi Susu)' : 'Keterangan pengeluaran'}
              className="mt-3 w-full rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-[#103A57] placeholder:text-slate-400"
            />

            {/* Tactile Numpad */}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleNumpad(key)}
                  className="h-12 rounded-xl bg-[#EEF5F1] font-extrabold text-base text-[#103A57] hover:bg-[#E3F0EA] active:scale-95 transition flex items-center justify-center"
                >
                  {key === 'back' ? <Delete size={18} className="text-[#991B1B]" /> : key}
                </button>
              ))}
            </div>

            {errMsg && (
              <p role="alert" className="err mt-3">{errMsg}</p>
            )}

            {/* Submit Action Button */}
            <div className="mt-4">
              <button
                type="button"
                disabled={nominalNumber <= 0 || loading}
                onClick={handleSave}
                className={`relative w-full rounded-2xl py-3.5 px-4 font-extrabold text-sm text-white transition-all active:scale-[0.98] disabled:opacity-40 ${
                  type === 'masuk'
                    ? 'bg-[#103A57] hover:bg-[#103A57]/90'
                    : 'bg-[#991B1B] hover:bg-[#991B1B]/90'
                }`}
              >
                {savedSuccess ? (
                  <span className="flex items-center justify-center gap-2">
                    <Check size={18} className="text-[#A9D3C5]" /> Tercatat
                  </span>
                ) : loading ? (
                  'Menyimpan transaksi…'
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles size={16} className="text-[#A9D3C5]" />
                    {type === 'masuk' ? 'Simpan uang masuk' : 'Simpan pengeluaran'}
                  </span>
                )}
              </button>
            </div>
            </>)}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
