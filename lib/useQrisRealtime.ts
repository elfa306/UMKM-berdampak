'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export type TxBaris = {
  id: string; session_id: string; jenis: 'penjualan' | 'biaya'; keterangan: string;
  jumlah: number | string; qty: number; metode: 'tunai' | 'qris' | null; ref_id: string | null; created_at: string;
};
export type InboxBaris = { id: string; jumlah: number | string; catatan: string | null };
export type StatusLive = 'connecting' | 'live' | 'offline';

type Handler = {
  /** Transaksi QRIS baru (hasil sinyal MacroDroid) masuk ke tabel transactions */
  onQrisMasuk: (tx: TxBaris) => void;
  /** Pembayaran masuk ke kotak masuk tetapi hari belum dimulai, jadi belum jadi transaksi */
  onInboxBaru?: (m: InboxBaris) => void;
  /** Dipanggil tiap kali koneksi (kembali) tersambung: saatnya mengejar data yang terlewat */
  onTersambung?: () => void;
};

/**
 * Mendengarkan INSERT pada `transactions` dan `qris_inbox` milik pengguna ini.
 * Server /api/gopay tidak diubah: begitu ia menulis ke database, event ini yang sampai ke browser.
 * Hanya baris ber-ref_id (otomatis dari notifikasi) yang dianggap QRIS masuk;
 * ketukan manual di kasir tidak punya ref_id sehingga tidak memicu pop-up.
 */
export function useQrisRealtime(userId: string | null, handler: Handler): StatusLive {
  const [status, setStatus] = useState<StatusLive>('connecting');
  const h = useRef(handler);
  h.current = handler;

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`kasir-live-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` },
        (p) => {
          const r = p.new as TxBaris;
          if (r.ref_id && r.jenis === 'penjualan' && r.metode === 'qris') h.current.onQrisMasuk(r);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'qris_inbox', filter: `user_id=eq.${userId}` },
        (p) => h.current.onInboxBaru?.(p.new as InboxBaris))
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') { setStatus('live'); h.current.onTersambung?.(); }
        else setStatus('offline');
      });
    return () => { void supabase.removeChannel(ch); };
  }, [userId]);

  return status;
}
