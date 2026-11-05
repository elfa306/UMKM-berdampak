'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Eye,
  EyeOff,
  Plus,
  Minus,
  QrCode,
  Package,
  TrendingUp,
  AlertTriangle,
  Clock,
  ChevronRight,
  ShoppingBag,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { exportExcel } from '@/lib/exportExcel';
import { fetchHari } from '@/lib/data';
import { angka, rupiah, rupiahTanda, summarize, todayISO, tglPanjang, type Product, type Tx } from '@/lib/accounting';
import { ISTILAH, teksBalikModal } from '@/lib/istilah';
import { useQrisRealtime, type TxBaris } from '@/lib/useQrisRealtime';
import { isSoundOn, kaChing, setSoundOn, unlockSound } from '@/lib/sound';
import BottomNav from '@/components/BottomNav';
import RpInput from '@/components/RpInput';
import AnimatedRupiah from '@/components/AnimatedRupiah';
import TrenChart, { type TitikTren } from '@/components/TrenChart';
import { Press, Rise } from '@/components/Motion';
import { bukaCatatTransaksi, TRANSACTION_SAVED_EVENT, ensureTodaySession, type QuickSavedDetail } from '@/lib/quickSession';
import { announceInvoiceMatch, getActiveInvoice, publishActiveInvoice } from '@/lib/qrisBridge';
import { CavaVMark, CavaLogo } from '@/components/CavaLogo';

type Sesi = { id: string; modal_harian: number };
const keTx = (r: TxBaris | Tx): Tx => ({ ...(r as Tx), jumlah: Number(r.jumlah) });

// Determine greeting based on Jakarta local hour
function salamWaktu() {
  const jamSekarang = new Date().getHours();
  if (jamSekarang >= 4 && jamSekarang < 11) return 'Selamat pagi';
  if (jamSekarang >= 11 && jamSekarang < 15) return 'Selamat siang';
  if (jamSekarang >= 15 && jamSekarang < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export default function Kasir() {
  const router = useRouter();
  const tanggal = todayISO();
  const [userId, setUserId] = useState<string | null>(null);
  const [namaUsaha, setNamaUsaha] = useState('[Nama Usaha]');
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tren, setTren] = useState<TitikTren[]>([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [qris, setQris] = useState<{ key: string; jumlah: number; invoiceNo?: string; nominalCocok?: boolean; title?: string; detail?: string } | null>(null);
  const [baruIds, setBaruIds] = useState<Set<string>>(new Set());
  const [hapusTarget, setHapusTarget] = useState<Product | null>(null);
  const [menghapus, setMenghapus] = useState(false);
  const [suara, setSuara] = useState(true);

  // New CAVA UI states
  const [sembunyikanNominal, setSembunyikanNominal] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);

  const sudahDiproses = useRef<Set<string>>(new Set());
  const sesiRef = useRef<Sesi | null>(null);
  sesiRef.current = sesi;

  const info = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2500); };

  async function importQris(sesiId: string) {
    const { error } = await supabase.rpc('post_pending_gopay_notifications', {
      p_session_id: sesiId,
    });
    if (error) {
      console.error('Gagal memproses inbox GoPay:', error.message);
      setErr('Ada notifikasi QRIS yang belum berhasil dimasukkan. Muat ulang kasir atau hubungi pengelola.');
    }
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId('guest');
      setNamaUsaha('[Nama Usaha]');
      setProducts([
        { id: 'sample-1', nama: 'Kopi Cava Latte', harga: 18000, stok: 15, satuan: 'cup', aktif: true, jenis_item: 'finished_good' } as any,
        { id: 'sample-2', nama: 'Roti Bakar Kaya', harga: 15000, stok: 20, satuan: 'porsi', aktif: true, jenis_item: 'finished_good' } as any,
        { id: 'sample-3', nama: 'Gula Pasir Kristal', harga: 17500, stok: 2, stok_minimum: 5, satuan: 'kg', aktif: true, jenis_item: 'merchandise' } as any,
      ]);
      setReady(true);
      return;
    }

    const [p, s] = await Promise.all([
      supabase.from('products').select('id,nama,harga,stok,stok_minimum,satuan').eq('aktif', true).in('jenis_item', ['merchandise', 'finished_good', 'service']).order('created_at'),
      supabase.from('daily_sessions').select('id,modal_harian').eq('tanggal', tanggal).maybeSingle(),
    ]);
    setProducts((p.data ?? []).map((x) => ({ ...x, harga: Number(x.harga) })));
    if (s.data) {
      setSesi({ id: s.data.id, modal_harian: Number(s.data.modal_harian) });
      await importQris(s.data.id);
      const [t, pending] = await Promise.all([
        supabase.from('transactions').select('*').eq('session_id', s.data.id).order('created_at'),
        supabase.from('qris_invoice_drafts').select('invoice_no,total').eq('session_id', s.data.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setTxs((t.data ?? []).map((x) => ({ ...x, jumlah: Number(x.jumlah) })) as Tx[]);
      // Invoice dinamis yang menunggu dibuat dari modal Catat; beranda hanya perlu tahu untuk mencocokkan notifikasi.
      publishActiveInvoice(pending.data ? { invoice_no: pending.data.invoice_no as string, total: Number(pending.data.total) } : null);
    } else {
      publishActiveInvoice(null);
    }
    setReady(true);
  }, [router, tanggal]);

  useEffect(() => { load(); }, [load]);

  // Listen to quick transaction modal events
  useEffect(() => {
    const handleSaved = (e: Event) => {
      const detail = (e as CustomEvent<QuickSavedDetail | undefined>).detail;
      if (detail?.guest && detail.rows.length) {
        // Mode tamu: tidak ada database, jadi baris dari modal ditambahkan langsung ke beranda.
        const rows = detail.rows.map((r) => ({ ...r, jumlah: Number(r.jumlah) })) as Tx[];
        setTxs((prev) => [...rows, ...prev.filter((x) => !rows.some((r) => r.id === x.id))]);
        setBaruIds((cur) => new Set([...cur, ...rows.map((r) => r.id)]));
        setTimeout(() => setBaruIds((cur) => { const n = new Set(cur); rows.forEach((r) => n.delete(r.id)); return n; }), 2600);
        return;
      }
      load();
    };
    window.addEventListener(TRANSACTION_SAVED_EVENT, handleSaved);
    return () => window.removeEventListener(TRANSACTION_SAVED_EVENT, handleSaved);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    const v = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [load]);

  useEffect(() => {
    setSuara(isSoundOn());
    const buka = () => unlockSound();
    window.addEventListener('pointerdown', buka, { once: true });
    return () => window.removeEventListener('pointerdown', buka);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const akhir = new Date(tanggal + 'T12:00:00'); akhir.setDate(akhir.getDate() - 1);
    const awal = new Date(akhir); awal.setDate(awal.getDate() - 6);
    fetchHari(awal.toLocaleDateString('en-CA'), akhir.toLocaleDateString('en-CA')).then((h) =>
      setTren([...h].reverse().map((x) => { const sum = summarize(x.modal, x.txs); return { tanggal: x.tanggal, uangMasuk: sum.pendapatan, untung: sum.labaBersih }; }))
    ).catch(() => undefined);
  }, [ready, tanggal]);

  const tampilkanQris = useCallback((r: TxBaris) => {
    if (sudahDiproses.current.has(r.id)) return;
    sudahDiproses.current.add(r.id);
    const tx = keTx(r);
    setTxs((t) => (t.some((x) => x.id === tx.id) ? t : [...t, tx]));
    setBaruIds((s) => new Set(s).add(tx.id));
    setTimeout(() => setBaruIds((s) => { const n = new Set(s); n.delete(tx.id); return n; }), 2600);
    const invoiceNow = getActiveInvoice();
    const nominalCocok = Boolean(invoiceNow && invoiceNow.total === tx.jumlah);
    if (nominalCocok) {
      if (invoiceNow) announceInvoiceMatch(invoiceNow.invoice_no);
      info(`🔔 Notifikasi GoPay/MacroDroid ${rupiah(tx.jumlah)} cocok dengan ${invoiceNow?.invoice_no}.`);
    }
    setQris({ key: tx.id, jumlah: tx.jumlah, invoiceNo: nominalCocok ? invoiceNow?.invoice_no : undefined, nominalCocok });
    kaChing();
    setTimeout(() => setQris((q) => (q?.key === tx.id ? null : q)), 4500);
  }, []);

  const status = useQrisRealtime(userId, {
    onQrisMasuk: tampilkanQris,
    onInboxBaru: (m) => { if (!sesiRef.current) { kaChing(); info(`💰 QRIS ${rupiah(Number(m.jumlah))} masuk. Sesi harian belum dimulai.`); } },
    onTersambung: () => { if (sesiRef.current) load(); },
  });

  async function mulaiHari(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const modal = angka(new FormData(e.currentTarget).get('modal'));
    const { error } = await supabase.from('daily_sessions').insert({ tanggal, modal_harian: modal });
    if (error) return setErr(error.message);
    load();
  }

  async function catat(row: { jenis: 'penjualan' | 'biaya'; keterangan: string; jumlah: number; metode: 'tunai' | 'qris' | null }, productId?: string) {
    let sesiAktif = sesi;
    if (!sesiAktif && userId && userId !== 'guest') {
      const id = await ensureTodaySession(tanggal);
      if (!id) return setErr('Sesi penjualan hari ini gagal dibuat. Transaksi belum tersimpan.');
      sesiAktif = { id, modal_harian: 0 };
      setSesi(sesiAktif);
    }
    if (!sesiAktif) {
      const mockTx: Tx = {
        id: crypto.randomUUID(),
        jenis: row.jenis,
        keterangan: row.keterangan,
        jumlah: row.jumlah,
        metode: row.metode,
        qty: 1,
        created_at: new Date().toISOString(),
      };
      setTxs((prev) => [mockTx, ...prev]);
      kaChing();
      info(`✅ ${row.keterangan} (${rupiah(row.jumlah)}) tercatat`);
      return;
    }
    setErr('');
    if (row.jenis === 'penjualan' && productId) {
      const { data, error } = await supabase.rpc('record_inventory_sale', {
        p_session_id: sesiAktif.id,
        p_product_id: productId,
        p_quantity: 1,
        p_method: row.metode ?? 'tunai',
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) {
        if (error.message.includes('insufficient_stock')) return setErr('Stok produk tidak mencukupi.');
        return setErr(error.message);
      }
      const transaction = data?.transaction;
      if (!transaction) return setErr('Transaksi berhasil diproses tetapi data transaksi tidak ditemukan.');
      setTxs((t) => (t.some((x) => x.id === transaction.id) ? t : [...t, keTx(transaction)]));
      kaChing();
      info(`✅ ${row.keterangan} tercatat`);
      return;
    }
    const { data, error } = await supabase.from('transactions').insert({ ...row, session_id: sesiAktif.id, qty: 1 }).select('*').single();
    if (error) return setErr(error.message);
    setTxs((t) => (t.some((x) => x.id === data.id) ? t : [...t, keTx(data)]));
    kaChing();
    info(row.jenis === 'penjualan' ? `✅ ${row.keterangan} tercatat` : '✅ Pengeluaran tercatat');
  }

  function pilihProduk(p: Product) {
    void catat({ jenis: 'penjualan', keterangan: p.nama, jumlah: p.harga, metode: 'tunai' }, p.id);
  }

  async function batalTerakhir() {
    if (!sesi) { setTxs((t) => t.slice(1)); info('Transaksi terakhir dibatalkan.'); return; } // mode tamu: terbaru ada di depan
    const last = txs[txs.length - 1];
    if (!last) return;
    if (last.payment_source === 'qris_simulation') {
      const { data, error } = await supabase.rpc('cancel_qris_payment_simulation', { p_transaction_id: last.id });
      if (error) return setErr(`Pembatalan QRIS simulasi gagal: ${error.message}`);
      const ids = Array.isArray(data?.transaction_ids) ? data.transaction_ids as string[] : [last.id];
      setTxs((current) => current.filter((tx) => !ids.includes(tx.id)));
      info(`✅ Pembayaran QRIS simulasi dibatalkan. ${Number(data?.cancelled_count ?? ids.length)} transaksi dibatalkan dan stok dikembalikan.`);
      return;
    }
    if (last.product_id && last.payment_source === 'cashier') {
      const { error } = await supabase.rpc('cancel_inventory_sale', { p_transaction_id: last.id });
      if (error) return setErr(error.message);
      setTxs((t) => t.filter((x) => x.id !== last.id));
      info('✅ Transaksi dibatalkan dan stok dikembalikan.');
      return;
    }
    const { error } = await supabase.from('transactions').delete().eq('id', last.id);
    if (error) return setErr(error.message);
    setTxs((t) => t.slice(0, -1));
  }

  // Ringkasan memakai catatan aktual. Tidak ada angka contoh yang ditampilkan sebagai data usaha.
  const modalHarian = sesi?.modal_harian ?? 0;
  const liveSummary = summarize(modalHarian, txs);
  const untungBersih = liveSummary.labaBersih;
  const totalMasuk = liveSummary.pendapatan;
  const totalKeluar = liveSummary.beban;
  const sisaModal = modalHarian > 0
    ? Math.max(0, modalHarian - (totalMasuk - totalKeluar))
    : 0;
  const persenBalik = modalHarian > 0
    ? Math.min(100, Math.max(0, Math.round(((modalHarian - sisaModal) / modalHarian) * 100)))
    : 0;

  // Progres misi dihitung dari transaksi yang benar-benar tercatat hari ini.
  const missionProgress = Math.min(3, txs.length);

  // Check low stock
  const lowStockItem = products.find((p) => typeof (p as any).stok === 'number' && (p as any).stok <= ((p as any).stok_minimum || 5));

  function gantiSuara() {
    const on = !suara;
    setSuara(on);
    setSoundOn(on);
    unlockSound();
    if (on) kaChing();
  }

  if (!ready) {
    return (
      <div className="wrap">
        <div className="header-app">
          <p className="text-sm font-bold text-[#307B8E]">Memuat CAVA…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      {/* Header biru + kartu ringkasan yang menumpuk di atasnya */}
      <div className="home-band">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
              <CavaVMark size={26} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#A9D3C5]">{salamWaktu()},</p>
              <h1 className="truncate text-base font-extrabold tracking-tight text-white">{namaUsaha}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={gantiSuara}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Toggle sound"
            >
              {suara ? <Volume2 size={18} /> : <VolumeX size={18} className="text-white/50" />}
            </button>
            <button
              type="button"
              onClick={() => setShowNotifModal(true)}
              className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Notifikasi"
            >
              <Bell size={18} />
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[#A9D3C5]" />
            </button>
          </div>
        </header>
      </div>

      <Rise delay={0.02} className="home-hero">
        <section className="balance-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#4F6B7C]">Untung bersih hari ini</span>
            <button
              type="button"
              onClick={() => setSembunyikanNominal(!sembunyikanNominal)}
              className="p-1 text-[#307B8E] transition hover:text-[#103A57]"
              aria-label={sembunyikanNominal ? 'Tampilkan saldo' : 'Sembunyikan saldo'}
            >
              {sembunyikanNominal ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="mt-1">
            <span className="text-[1.9rem] font-extrabold tabular-nums tracking-tight text-[#103A57]">
              {sembunyikanNominal ? 'Rp •••••••' : rupiah(untungBersih)}
            </span>
          </div>

          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#DCEAE3]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${persenBalik}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="h-full rounded-full bg-[#307B8E]"
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#4F6B7C]">
              {modalHarian > 0
                ? `${persenBalik}% balik modal · kurang ${rupiah(sisaModal)}`
                : 'Isi modal harian untuk mulai menghitung progres balik modal.'}
            </p>
          </div>

          <div className="stat3">
            <div>
              <b className="tabular-nums">{sembunyikanNominal ? 'Rp •••' : rupiah(totalMasuk)}</b>
              <span>Masuk</span>
            </div>
            <div>
              <b className="tabular-nums">{sembunyikanNominal ? 'Rp •••' : rupiah(totalKeluar)}</b>
              <span>Keluar</span>
            </div>
            <div>
              <b className="tabular-nums">{sembunyikanNominal ? 'Rp •••' : rupiah(modalHarian)}</b>
              <span>Modal</span>
            </div>
          </div>
        </section>
      </Rise>

      {err && (
        <div className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-[#991B1B]">
          {err}
        </div>
      )}

      {/* 3. Aksi Cepat (5 round quick action buttons in Pastel Blue #A9D3C5) */}
      <Rise delay={0.05}>
        <section className="card">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="card-title">Aksi Cepat</h2>
            <Link href="/lainnya" className="card-link">
              Lihat Semua
            </Link>
          </div>

          <div className="grid grid-cols-5 gap-2 text-center">
            {/* 1. Jual */}
            <button
              type="button"
              onClick={() => bukaCatatTransaksi({ type: 'masuk', metode: 'tunai' })}
              className="flex flex-col items-center gap-1.5 group"
            >
              <span className="ico-tile group-active:scale-95 transition">
                <Plus size={20} strokeWidth={2.5} />
              </span>
              <span className="text-[11px] font-bold text-[#103A57]">Jual</span>
            </button>

            {/* 2. Keluar */}
            <button
              type="button"
              onClick={() => bukaCatatTransaksi({ type: 'keluar' })}
              className="flex flex-col items-center gap-1.5 group"
            >
              <span className="ico-tile group-active:scale-95 transition">
                <Minus size={20} strokeWidth={2.5} />
              </span>
              <span className="text-[11px] font-bold text-[#103A57]">Keluar</span>
            </button>

            {/* 3. QRIS */}
            <button
              type="button"
              onClick={() => bukaCatatTransaksi({ type: 'masuk', metode: 'qris' })}
              className="flex flex-col items-center gap-1.5 group"
            >
              <span className="ico-tile group-active:scale-95 transition">
                <QrCode size={19} strokeWidth={2.2} />
              </span>
              <span className="text-[11px] font-bold text-[#103A57]">QRIS</span>
            </button>

            {/* 4. Stok */}
            <Link href="/inventaris" className="flex flex-col items-center gap-1.5 group">
              <span className="ico-tile group-active:scale-95 transition">
                <Package size={19} strokeWidth={2.2} />
              </span>
              <span className="text-[11px] font-bold text-[#103A57]">Stok</span>
            </Link>

            {/* 5. Harga */}
            <Link href="/harga" className="flex flex-col items-center gap-1.5 group">
              <span className="ico-tile group-active:scale-95 transition">
                <TrendingUp size={19} strokeWidth={2.2} />
              </span>
              <span className="text-[11px] font-bold text-[#103A57]">Harga</span>
            </Link>
          </div>
        </section>
      </Rise>

      {/* Responsive Grid for Alerts & Missions on larger screens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 4. Pengingat Usaha (Business Alerts) */}
        <Rise delay={0.08} className="h-full">
          <section className="card space-y-3 h-full">
            <h2 className="card-title">Pengingat Usaha</h2>

            {/* Alert 1: Low stock alert */}
            <div className="flex items-start gap-3 rounded-2xl bg-[#EEF5F1] p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-black text-[#103A57]">
                  {lowStockItem
                    ? `Stok ${lowStockItem.nama} tinggal ${(lowStockItem as any).stok} ${(lowStockItem as any).satuan || 'item'}`
                    : products.length > 0 ? 'Tidak ada stok kritis' : 'Data stok belum tersedia'}
                </h3>
                <p className="mt-0.5 text-[11px] font-semibold text-[#307B8E]">
                  {lowStockItem
                    ? 'Periksa persediaan dan rencanakan pengisian ulang.'
                    : products.length > 0 ? 'Persediaan berada di atas batas minimum.' : 'Tambahkan produk melalui menu Inventaris.'}
                </p>
              </div>
            </div>

            {/* Alert 2: Balik modal */}
            <div className="flex items-start gap-3 rounded-2xl bg-[#EEF5F1] p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#A9D3C5] text-[#103A57]">
                <Clock size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-black text-[#103A57]">
                  {modalHarian > 0 ? `Balik modal tinggal ${rupiah(sisaModal)}` : 'Sesi harian belum dimulai'}
                </h3>
                <p className="mt-0.5 text-[11px] font-semibold text-[#307B8E]">
                  {modalHarian > 0 ? 'Pantau perubahan berdasarkan transaksi hari ini.' : 'Mulai sesi harian untuk menetapkan modal usaha.'}
                </p>
              </div>
            </div>
          </section>
        </Rise>

        {/* 5. Misi Hari Ini (Teal Blue Card #307B8E) */}
        <Rise delay={0.1} className="h-full">
          <section className="rounded-[18px] bg-[#307B8E] p-5 text-white h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black tracking-wide">
                  Misi hari ini: catat 3 transaksi
                </span>
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-black">
                  {missionProgress}/3
                </span>
              </div>
              <p className="text-[11px] text-white/80 mt-1">
                Tercatat {missionProgress} dari 3 target transaksi harian untuk mempertahankan skor kelayakan kredit Anda.
              </p>
            </div>
            <div className="mt-4">
              <div className="h-2.5 w-full rounded-full bg-black/20 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(missionProgress / 3) * 100}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full rounded-full bg-[#A9D3C5]"
                />
              </div>
            </div>
          </section>
        </Rise>
      </div>

      {/* Katalog kasir: ketuk produk untuk mencatat penjualan tunai. Pembayaran QRIS ada di Catat Transaksi. */}
      <Rise delay={0.12}>
        <section id="katalog-kasir" className="card scroll-mt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="card-title">Katalog Kasir</h2>
              <p className="mt-0.5 text-[11px] font-semibold text-[#4F6B7C]">Ketuk produk untuk mencatat penjualan tunai</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCatalog(!showCatalog)}
              className="rounded-full bg-[#E3F0EA] px-3.5 py-2 text-xs font-extrabold text-[#103A57] transition hover:bg-[#CEE5D6]"
            >
              {showCatalog ? 'Sembunyikan' : 'Buka Kasir'}
            </button>
          </div>

          {showCatalog && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {products.map((p) => (
                  <button key={p.id} type="button" className="tile" onClick={() => pilihProduk(p)}>
                    <span className="tile-name">{p.nama}</span>
                    <span className="tile-price block">{rupiah(p.harga)}</span>
                  </button>
                ))}
              </div>
              {products.length === 0 && <p className="muted">Belum ada produk. Tambahkan di menu Inventaris.</p>}

              <button
                type="button"
                onClick={() => bukaCatatTransaksi({ type: 'masuk', metode: 'qris' })}
                className="btn-ghost"
              >
                Bayar pakai QRIS (keranjang &amp; invoice)
              </button>
              <button type="button" onClick={batalTerakhir} disabled={!txs.length} className="btn-ghost">
                Batalkan transaksi terakhir
              </button>
            </div>
          )}
        </section>
      </Rise>

      {/* Notification Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#103A57] text-white px-4 py-2.5 rounded-2xl text-xs font-extrabold shadow-xl z-50 border border-white/20">
          {toast}
        </div>
      )}

      {/* Real-time QRIS incoming toast */}
      <AnimatePresence>
        {qris && (
          <motion.div
            key={qris.key}
            initial={{ y: -90, x: '-50%', opacity: 0 }}
            animate={{ y: 0, x: '-50%', opacity: 1 }}
            exit={{ y: -90, x: '-50%', opacity: 0 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-sm rounded-2xl bg-[#103A57] text-white p-4 shadow-2xl border border-[#A9D3C5]/40 flex items-center gap-3"
          >
            <span className="text-2xl">🔔</span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#A9D3C5]">{qris.title || (qris.nominalCocok ? 'Notifikasi QRIS sesuai nominal' : 'Uang masuk QRIS')}</p>
              <p className="text-lg font-black tabular-nums">{rupiah(qris.jumlah)}</p>
              {qris.detail && <p className="mt-0.5 text-[10px] font-semibold text-white/80">{qris.detail}</p>}
              {qris.invoiceNo && <p className="mt-0.5 text-[10px] font-semibold text-white/80">Nominal sama dengan {qris.invoiceNo}. Periksa mutasi GoPay Merchant; invoice tidak otomatis lunas.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
