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
type SaldoUsaha = { kas: number; bank: number };
type RingkasanKeuanganHarian = { pendapatan: number; hpp: number; beban: number };
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
  const [namaUsaha, setNamaUsaha] = useState('Usaha saya');
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
  const [menyimpanModal, setMenyimpanModal] = useState(false);
  const [saldoAwalTersimpan, setSaldoAwalTersimpan] = useState<boolean | null>(null);
  const [saldoAwal, setSaldoAwal] = useState<SaldoUsaha>({ kas: 0, bank: 0 });
  const [saldoSaatIni, setSaldoSaatIni] = useState<SaldoUsaha>({ kas: 0, bank: 0 });
  const [ringkasanHarian, setRingkasanHarian] = useState<RingkasanKeuanganHarian>({ pendapatan: 0, hpp: 0, beban: 0 });
  const [saldoKasInput, setSaldoKasInput] = useState('0');
  const [saldoBankInput, setSaldoBankInput] = useState('0');

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
      setSesi(null);
      setTxs([]);
      setSaldoAwalTersimpan(true);
      setSaldoAwal({ kas: 0, bank: 0 });
      setSaldoSaatIni({ kas: 0, bank: 0 });
      setRingkasanHarian({ pendapatan: 0, hpp: 0, beban: 0 });
      setNamaUsaha('Mode Tamu');
      setProducts([
        { id: 'sample-1', nama: 'Kopi Cava Latte', harga: 18000, stok: 15, satuan: 'cup', aktif: true, jenis_item: 'finished_good' } as any,
        { id: 'sample-2', nama: 'Roti Bakar Kaya', harga: 15000, stok: 20, satuan: 'porsi', aktif: true, jenis_item: 'finished_good' } as any,
        { id: 'sample-3', nama: 'Gula Pasir Kristal', harga: 17500, stok: 2, stok_minimum: 5, satuan: 'kg', aktif: true, jenis_item: 'merchandise' } as any,
      ]);
      publishActiveInvoice(null);
      setReady(true);
      return;
    }

    setUserId(user.id);
    const tanggalBesok = new Date(`${tanggal}T12:00:00`);
    tanggalBesok.setDate(tanggalBesok.getDate() + 1);
    const tanggalBesokISO = tanggalBesok.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const [p, s, profil, opening, saldoPembuka, saldoTerkini] = await Promise.all([
      supabase.from('products').select('id,nama,harga,stok,stok_minimum,satuan').eq('user_id', user.id).eq('aktif', true).in('jenis_item', ['merchandise', 'finished_good', 'service']).order('created_at'),
      supabase.from('daily_sessions').select('id,modal_harian').eq('user_id', user.id).eq('tanggal', tanggal).maybeSingle(),
      supabase.from('business_profiles').select('nama_usaha').eq('user_id', user.id).maybeSingle(),
      supabase.from('business_opening_balances').select('user_id,recorded_at').eq('user_id', user.id).maybeSingle(),
      supabase.rpc('get_business_cash_balances', { p_before_date: tanggal }),
      supabase.rpc('get_business_cash_balances', { p_before_date: tanggalBesokISO }),
    ]);

    if (s.error) {
      setErr('Sesi harian gagal diperiksa. Periksa koneksi dan izin database, lalu muat ulang.');
      setReady(true);
      return;
    }
    if (opening.error || saldoPembuka.error || saldoTerkini.error) {
      console.error('Gagal memuat saldo usaha:', opening.error?.message, saldoPembuka.error?.message, saldoTerkini.error?.message);
      setErr('Fitur saldo awal belum tersedia. Jalankan migration_v17_cash_balance_flow.sql di Supabase, lalu muat ulang CAVA.');
      setReady(true);
      return;
    }

    const awal = {
      kas: Number(saldoPembuka.data?.cash_balance ?? 0),
      bank: Number(saldoPembuka.data?.bank_balance ?? 0),
    };
    const terkini = {
      kas: Number(saldoTerkini.data?.cash_balance ?? 0),
      bank: Number(saldoTerkini.data?.bank_balance ?? 0),
    };
    setSaldoAwalTersimpan(Boolean(opening.data));
    const tanggalPencatatanAwal = opening.data?.recorded_at
      ? new Date(opening.data.recorded_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
      : null;
    // Bila saldo awal baru disimpan hari ini, nilainya menjadi saldo pembuka hari ini.
    setSaldoAwal(tanggalPencatatanAwal === tanggal ? terkini : awal);
    setSaldoSaatIni(terkini);
    setRingkasanHarian({
      pendapatan: Number(saldoTerkini.data?.daily_revenue ?? 0),
      hpp: Number(saldoTerkini.data?.daily_cogs ?? 0),
      beban: Number(saldoTerkini.data?.daily_expenses ?? 0),
    });
    if (!opening.data) {
      setSaldoKasInput(String(Math.max(0, Math.round(terkini.kas))));
      setSaldoBankInput(String(Math.max(0, Math.round(terkini.bank))));
    }

    // Nama usaha bersumber dari profil akun yang sedang login.
    // Metadata Auth menjadi cadangan bila profil usaha belum tersedia.
    const namaProfil = typeof profil.data?.nama_usaha === 'string' ? profil.data.nama_usaha.trim() : '';
    const namaMetadata = typeof user.user_metadata?.nama_usaha === 'string' ? user.user_metadata.nama_usaha.trim() : '';
    const namaAkun = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
    setNamaUsaha(namaProfil || namaMetadata || namaAkun || 'Usaha saya');

    setProducts((p.data ?? []).map((x) => ({ ...x, harga: Number(x.harga) })));
    if (s.data) {
      const sesiHariIni = { id: s.data.id, modal_harian: Number(s.data.modal_harian) };
      setSesi(sesiHariIni);

      // Modal_harian dipertahankan hanya untuk kompatibilitas catatan lama.
      // Sesi baru bernilai Rp0 karena saldo awal dihitung dari jurnal kas dan bank.
      await importQris(s.data.id);
      const [t, pending] = await Promise.all([
        supabase.from('transactions').select('*').eq('user_id', user.id).eq('session_id', s.data.id).order('created_at'),
        supabase.from('qris_invoice_drafts').select('invoice_no,total').eq('session_id', s.data.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (t.error) {
        setErr('Transaksi hari ini gagal dimuat. Muat ulang halaman untuk mencoba lagi.');
      }
      setTxs((t.data ?? []).map((x) => ({ ...x, jumlah: Number(x.jumlah) })) as Tx[]);
      publishActiveInvoice(pending.data ? { invoice_no: pending.data.invoice_no as string, total: Number(pending.data.total) } : null);
    } else {
      setSesi(null);
      setTxs([]);
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

  const refreshSaldo = useCallback(async () => {
    if (!userId || userId === 'guest') return;
    const besok = new Date(`${tanggal}T12:00:00`);
    besok.setDate(besok.getDate() + 1);
    const beforeDate = besok.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const { data, error } = await supabase.rpc('get_business_cash_balances', { p_before_date: beforeDate });
    if (error || !data) {
      console.error('Gagal memperbarui saldo kas:', error?.message);
      return;
    }
    setSaldoSaatIni({
      kas: Number(data.cash_balance ?? 0),
      bank: Number(data.bank_balance ?? 0),
    });
    setRingkasanHarian({
      pendapatan: Number(data.daily_revenue ?? 0),
      hpp: Number(data.daily_cogs ?? 0),
      beban: Number(data.daily_expenses ?? 0),
    });
  }, [tanggal, userId]);

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
    void refreshSaldo();
  }, [refreshSaldo]);

  const status = useQrisRealtime(userId, {
    onQrisMasuk: tampilkanQris,
    onInboxBaru: (m) => { if (!sesiRef.current) { kaChing(); info(`💰 QRIS ${rupiah(Number(m.jumlah))} masuk. Sesi harian belum dimulai.`); } },
    onTersambung: () => { if (sesiRef.current) load(); },
  });

  async function mulaiHari(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (menyimpanModal) return;

    setMenyimpanModal(true);
    setErr('');
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const user = authData.user;
      if (authError || !user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');

      if (saldoAwalTersimpan !== true) {
        const form = new FormData(e.currentTarget);
        const kas = angka(form.get('saldoKas'));
        const bank = angka(form.get('saldoBank'));
        if (!Number.isSafeInteger(kas) || !Number.isSafeInteger(bank) || kas < 0 || bank < 0) {
          throw new Error('Masukkan saldo kas dan bank/QRIS yang valid. Nilai Rp0 diperbolehkan.');
        }

        const { error: openingError } = await supabase.rpc('set_business_opening_balances', {
          p_cash_amount: kas,
          p_bank_amount: bank,
        });
        if (openingError) {
          if (openingError.message.includes('opening_balance_already_set')) {
            throw new Error('Saldo awal usaha sudah pernah dikonfirmasi. Muat ulang halaman untuk melanjutkan.');
          }
          throw new Error(`Saldo awal gagal disimpan: ${openingError.message}`);
        }
        setSaldoAwalTersimpan(true);
      }

      let sesiBaru: { id: string; modal_harian: number | string } | null = sesi
        ? { id: sesi.id, modal_harian: sesi.modal_harian }
        : null;

      if (!sesiBaru) {
        const { data, error } = await supabase
          .from('daily_sessions')
          .insert({ user_id: user.id, tanggal, modal_harian: 0 })
          .select('id,modal_harian')
          .single();

        if (error?.code === '23505') {
          const { data: existing, error: lookupError } = await supabase
            .from('daily_sessions')
            .select('id,modal_harian')
            .eq('user_id', user.id)
            .eq('tanggal', tanggal)
            .maybeSingle();
          if (lookupError || !existing) throw error;
          sesiBaru = existing;
        } else {
          if (error || !data) throw error ?? new Error('Sesi harian gagal dibuka.');
          sesiBaru = data;
        }
      }

      if (!sesiBaru) throw new Error('Sesi harian gagal dibuka.');
      setSesi({ id: sesiBaru.id, modal_harian: Number(sesiBaru.modal_harian) });
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Gagal membuka aktivitas harian. Coba lagi.');
    } finally {
      setMenyimpanModal(false);
    }
  }

  async function catat(row: { jenis: 'penjualan' | 'biaya'; keterangan: string; jumlah: number; metode: 'tunai' | 'qris' | null }, productId?: string) {
    let sesiAktif = sesi;
    if (!sesiAktif && userId && userId !== 'guest') {
      const id = await ensureTodaySession(tanggal);
      if (!id) return setErr('Buka aktivitas harian dari Beranda setelah saldo awal usaha dikonfirmasi.');
      const { data: sesiTersimpan, error: sesiError } = await supabase
        .from('daily_sessions')
        .select('id,modal_harian')
        .eq('id', id)
        .eq('user_id', userId)
        .single();
      if (sesiError || !sesiTersimpan) {
        return setErr('Sesi harian belum dibuka. Mulai aktivitas dari Beranda terlebih dahulu.');
      }
      sesiAktif = { id: sesiTersimpan.id, modal_harian: Number(sesiTersimpan.modal_harian) };
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
      await refreshSaldo();
      kaChing();
      info(`✅ ${row.keterangan} tercatat`);
      return;
    }
    const { data, error } = await supabase.from('transactions').insert({ ...row, session_id: sesiAktif.id, qty: 1 }).select('*').single();
    if (error) return setErr(error.message);
    setTxs((t) => (t.some((x) => x.id === data.id) ? t : [...t, keTx(data)]));
    await refreshSaldo();
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
      await refreshSaldo();
      info(`✅ Pembayaran QRIS simulasi dibatalkan. ${Number(data?.cancelled_count ?? ids.length)} transaksi dibatalkan dan stok dikembalikan.`);
      return;
    }
    if (last.product_id && last.payment_source === 'cashier') {
      const { error } = await supabase.rpc('cancel_inventory_sale', { p_transaction_id: last.id });
      if (error) return setErr(error.message);
      setTxs((t) => t.filter((x) => x.id !== last.id));
      await refreshSaldo();
      info('✅ Transaksi dibatalkan dan stok dikembalikan.');
      return;
    }
    const { error } = await supabase.from('transactions').delete().eq('id', last.id);
    if (error) return setErr(error.message);
    setTxs((t) => t.slice(0, -1));
    await refreshSaldo();
  }

  // Ringkasan memakai catatan aktual. Tidak ada angka contoh yang ditampilkan sebagai data usaha.
  // Laba harian dihitung dari jurnal: pendapatan dikurangi HPP dan beban aktual.
  // modal_harian hanya dipertahankan untuk kompatibilitas laporan historis.
  const liveSummary = summarize(0, txs);
  const untungBersih = ringkasanHarian.pendapatan - ringkasanHarian.hpp - ringkasanHarian.beban;
  const totalMasuk = liveSummary.pendapatan;
  const totalKeluar = liveSummary.beban;
  const saldoUsahaSekarang = saldoSaatIni.kas + saldoSaatIni.bank;

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

  if (userId && userId !== 'guest' && (saldoAwalTersimpan !== true || !sesi)) {
    const perluSaldoAwal = saldoAwalTersimpan !== true;
    return (
      <main className="min-h-[100svh] bg-[#F2F6F3] px-4 py-8 text-[#103A57] sm:px-6">
        <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md flex-col justify-center">
          <div className="mb-7 flex justify-center">
            <CavaLogo variant="horizontal" height={42} />
          </div>
          <form onSubmit={mulaiHari} className="rounded-[28px] border border-[#103A57]/10 bg-white p-6 shadow-[0_18px_55px_-28px_rgba(16,58,87,0.35)] sm:p-7">
            <div className="mb-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#307B8E]">
                {perluSaldoAwal ? 'Pengaturan awal usaha' : 'Aktivitas harian'}
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">
                {perluSaldoAwal ? 'Siapkan saldo awal usaha' : 'Mulai hari dengan CAVA'}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {perluSaldoAwal
                  ? 'Masukkan saldo uang yang benar-benar tersedia saat ini. Pengaturan ini hanya dilakukan satu kali; saldo akan dicocokkan dengan pembukuan tanpa menghapus riwayat transaksi.'
                  : 'Saldo awal hari ini otomatis dibawa dari penutupan hari sebelumnya. Tidak perlu menyetor modal baru untuk mulai berjualan.'}
              </p>
            </div>

            {perluSaldoAwal ? (
              <div className="space-y-4">
                <label className="block">
                  <span className="block text-sm font-bold text-[#103A57]">Saldo kas tunai</span>
                  <span className="mt-1 block text-[11px] text-slate-500">Uang tunai yang tersedia di laci/kas usaha.</span>
                  <input
                    name="saldoKas"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={saldoKasInput}
                    onChange={(event) => setSaldoKasInput(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-extrabold tabular-nums text-[#103A57] outline-none focus:border-[#307B8E] focus:bg-white"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-bold text-[#103A57]">Saldo bank / QRIS</span>
                  <span className="mt-1 block text-[11px] text-slate-500">Saldo usaha yang tersimpan di rekening atau dompet merchant.</span>
                  <input
                    name="saldoBank"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={saldoBankInput}
                    onChange={(event) => setSaldoBankInput(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-extrabold tabular-nums text-[#103A57] outline-none focus:border-[#307B8E] focus:bg-white"
                  />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[#EEF5F1] p-4">
                  <span className="text-[11px] font-bold text-[#4F6B7C]">Kas tunai</span>
                  <p className="mt-1 text-lg font-black tabular-nums text-[#103A57]">{rupiah(saldoAwal.kas)}</p>
                </div>
                <div className="rounded-2xl bg-[#EEF5F1] p-4">
                  <span className="text-[11px] font-bold text-[#4F6B7C]">Bank / QRIS</span>
                  <p className="mt-1 text-lg font-black tabular-nums text-[#103A57]">{rupiah(saldoAwal.bank)}</p>
                </div>
                <p className="col-span-2 text-[11px] leading-5 text-slate-500">
                  Saldo ini bukan setoran modal baru. Bila ada tambahan uang dari pemilik, catat terpisah melalui Catat Transaksi → Setor modal.
                </p>
              </div>
            )}

            {err && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">{err}</p>}

            <button
              type="submit"
              disabled={menyimpanModal}
              className="mt-5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#103A57] px-4 py-3 text-sm font-extrabold text-white transition hover:bg-[#205874] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {menyimpanModal
                ? 'Menyimpan…'
                : perluSaldoAwal ? 'Simpan saldo awal & mulai' : 'Mulai aktivitas hari ini'}
            </button>
            <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
              Setelah sesi hari ini dibuka, CAVA akan langsung membawa kamu ke dashboard tanpa meminta modal lagi.
            </p>
          </form>
        </div>
      </main>
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#EEF5F1] px-3 py-2.5">
              <span className="text-[10px] font-bold text-[#4F6B7C]">Saldo kas tunai</span>
              <p className="mt-0.5 text-sm font-extrabold tabular-nums text-[#103A57]">
                {sembunyikanNominal ? 'Rp •••' : rupiah(saldoSaatIni.kas)}
              </p>
            </div>
            <div className="rounded-xl bg-[#EEF5F1] px-3 py-2.5">
              <span className="text-[10px] font-bold text-[#4F6B7C]">Saldo bank / QRIS</span>
              <p className="mt-0.5 text-sm font-extrabold tabular-nums text-[#103A57]">
                {sembunyikanNominal ? 'Rp •••' : rupiah(saldoSaatIni.bank)}
              </p>
            </div>
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
              <b className="tabular-nums">{sembunyikanNominal ? 'Rp •••' : rupiah(saldoUsahaSekarang)}</b>
              <span>Saldo usaha</span>
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
                  Saldo usaha {rupiah(saldoUsahaSekarang)}
                </h3>
                <p className="mt-0.5 text-[11px] font-semibold text-[#307B8E]">
                  Kas tunai dan bank/QRIS dihitung terpisah. Tambahan dana pemilik dicatat sebagai setoran modal.
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
