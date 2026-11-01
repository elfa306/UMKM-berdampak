'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
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

type Sesi = { id: string; modal_harian: number };
type QrisInvoiceItem = { productId: string; nama: string; harga: number; qty: number; subtotal: number };
type QrisInvoice = { id: string; invoice_no: string; total: number; items: QrisInvoiceItem[]; created_at: string; status: 'pending' | 'paid_manual'; paid_at?: string | null; notificationMatch?: boolean };
const jam = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const keTx = (r: TxBaris | Tx): Tx => ({ ...(r as Tx), jumlah: Number(r.jumlah) });

export default function Kasir() {
  const router = useRouter();
  const tanggal = todayISO();
  const [userId, setUserId] = useState<string | null>(null);
  const [namaUsaha, setNamaUsaha] = useState('');
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tren, setTren] = useState<TitikTren[]>([]);
  const [metode, setMetode] = useState<'tunai' | 'qris'>('tunai');
  const [jenisQris, setJenisQris] = useState<'statis' | 'dinamis'>('statis');
  const [keranjang, setKeranjang] = useState<Record<string, number>>({});
  const [invoiceQris, setInvoiceQris] = useState<QrisInvoice | null>(null);
  const [confirmQrisType, setConfirmQrisType] = useState<'statis' | 'dinamis' | null>(null);
  const [busyQrisConfirm, setBusyQrisConfirm] = useState(false);
  const [staticQrisConfirmation, setStaticQrisConfirmation] = useState<{ total: number; count: number } | null>(null);
  const staticConfirmationKeyRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [qris, setQris] = useState<{ key: string; jumlah: number; invoiceNo?: string; nominalCocok?: boolean; title?: string; detail?: string } | null>(null);
  const [baruIds, setBaruIds] = useState<Set<string>>(new Set());
  const [suara, setSuara] = useState(true);
  const sudahDiproses = useRef<Set<string>>(new Set());
  const sesiRef = useRef<Sesi | null>(null);
  const invoiceQrisRef = useRef<QrisInvoice | null>(null);
  sesiRef.current = sesi;
  invoiceQrisRef.current = invoiceQris;

  const cartLines = useMemo(() => Object.entries(keranjang).map(([id, qty]) => {
    const product = products.find((item) => item.id === id);
    return product ? { product, qty } : null;
  }).filter((line): line is { product: Product; qty: number } => line !== null), [keranjang, products]);
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.harga * line.qty, 0);

  const info = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2000); };

  // Pindahkan pembayaran MacroDroid yang tertahan di inbox secara atomik.
  // RPC hanya memproses inbox milik pengguna yang sedang login dan tanggal sesi yang sama.
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
    if (!user) { router.replace('/login'); return; }
    setUserId(user.id);
    setNamaUsaha(user.user_metadata?.nama_usaha ?? 'Usaha Saya');

    const [p, s] = await Promise.all([
      supabase.from('products').select('id,nama,harga').eq('aktif', true).in('jenis_item', ['merchandise', 'finished_good', 'service']).order('created_at'),
      supabase.from('daily_sessions').select('id,modal_harian').eq('tanggal', tanggal).maybeSingle(),
    ]);
    setProducts((p.data ?? []).map((x) => ({ ...x, harga: Number(x.harga) })));
    if (s.data) {
      setSesi({ id: s.data.id, modal_harian: Number(s.data.modal_harian) });
      await importQris(s.data.id);
      const [t, invoiceResult] = await Promise.all([
        supabase.from('transactions').select('*').eq('session_id', s.data.id).order('created_at'),
        supabase.from('qris_invoice_drafts').select('id,invoice_no,total,items,created_at,status,paid_at').eq('session_id', s.data.id).in('status', ['pending', 'paid_manual']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setTxs((t.data ?? []).map((x) => ({ ...x, jumlah: Number(x.jumlah) })) as Tx[]);
      if (invoiceResult.error) {
        console.error('Gagal memuat draft invoice QRIS:', invoiceResult.error.message);
        setErr('Untuk memakai invoice QRIS, jalankan migration_v14_qris_invoice_drafts.sql di Supabase.');
        setInvoiceQris(null);
      } else if (invoiceResult.data) {
        const saved = invoiceResult.data;
        setMetode('qris');
        setJenisQris('dinamis');
        setInvoiceQris({
          id: saved.id, invoice_no: saved.invoice_no, total: Number(saved.total),
          items: Array.isArray(saved.items) ? saved.items as QrisInvoiceItem[] : [],
          created_at: saved.created_at, status: saved.status as 'pending' | 'paid_manual', paid_at: saved.paid_at, notificationMatch: false,
        });
      } else {
        setInvoiceQris(null);
      }
    } else {
      setInvoiceQris(null);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tanggal]);

  useEffect(() => { load(); }, [load]);

  // Pengaman: ambil ulang tiap 60 dtk dan saat layar HP dibuka kembali (koneksi realtime bisa tertidur di latar belakang)
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    const v = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [load]);

  // Buka kunci suara pada sentuhan pertama (aturan browser HP) dan baca preferensi
  useEffect(() => {
    setSuara(isSoundOn());
    const buka = () => unlockSound();
    window.addEventListener('pointerdown', buka, { once: true });
    return () => window.removeEventListener('pointerdown', buka);
  }, []);

  // Tren 7 hari (tanpa hari ini; hari ini dihitung langsung dari state agar ikut bergerak saat QRIS masuk)
  useEffect(() => {
    if (!ready) return;
    const akhir = new Date(tanggal + 'T12:00:00'); akhir.setDate(akhir.getDate() - 1);
    const awal = new Date(akhir); awal.setDate(awal.getDate() - 6);
    fetchHari(awal.toLocaleDateString('en-CA'), akhir.toLocaleDateString('en-CA')).then((h) =>
      setTren([...h].reverse().map((x) => { const s = summarize(x.modal, x.txs); return { tanggal: x.tanggal, uangMasuk: s.pendapatan, untung: s.labaBersih }; }))
    ).catch(() => undefined);
  }, [ready, tanggal]);

  // ====== REAL-TIME QRIS ======
  const tampilkanQris = useCallback((r: TxBaris) => {
    if (sudahDiproses.current.has(r.id)) return;
    sudahDiproses.current.add(r.id);
    const tx = keTx(r);
    setTxs((t) => (t.some((x) => x.id === tx.id) ? t : [...t, tx]));
    setBaruIds((s) => new Set(s).add(tx.id));
    setTimeout(() => setBaruIds((s) => { const n = new Set(s); n.delete(tx.id); return n; }), 2600);
    const invoiceNow = invoiceQrisRef.current;
    const nominalCocok = Boolean(invoiceNow && invoiceNow.total === tx.jumlah);
    if (nominalCocok) {
      setInvoiceQris((current) => current ? { ...current, notificationMatch: true } : current);
      info(`🔔 Notifikasi GoPay/MacroDroid ${rupiah(tx.jumlah)} memiliki nominal yang sama dengan ${invoiceNow?.invoice_no}. Periksa mutasi merchant; invoice contoh tidak otomatis lunas.`);
    }
    setQris({ key: tx.id, jumlah: tx.jumlah, invoiceNo: nominalCocok ? invoiceNow?.invoice_no : undefined, nominalCocok });
    kaChing();
    setTimeout(() => setQris((q) => (q?.key === tx.id ? null : q)), 4500);
  }, []);

  const status = useQrisRealtime(userId, {
    onQrisMasuk: tampilkanQris,
    // Pembayaran masuk tetapi hari belum dimulai: beri tahu, jangan diam saja
    onInboxBaru: (m) => { if (!sesiRef.current) { kaChing(); info(`💰 QRIS ${rupiah(Number(m.jumlah))} masuk. Tekan MULAI BERJUALAN agar tercatat.`); } },
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
    if (!sesi) return;
    setErr('');
    if (row.jenis === 'penjualan' && productId) {
      const { data, error } = await supabase.rpc('record_inventory_sale', {
        p_session_id: sesi.id,
        p_product_id: productId,
        p_quantity: 1,
        p_method: row.metode ?? 'tunai',
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) {
        if (error.message.includes('insufficient_stock')) return setErr('Stok produk tidak mencukupi. Periksa menu Inventaris.');
        return setErr(error.message);
      }
      const transaction = data?.transaction;
      if (!transaction) return setErr('Transaksi berhasil diproses tetapi data transaksi tidak ditemukan. Muat ulang kasir.');
      setTxs((t) => (t.some((x) => x.id === transaction.id) ? t : [...t, keTx(transaction)]));
      info(`✅ ${row.keterangan} tercatat`);
      return;
    }
    const { data, error } = await supabase.from('transactions').insert({ ...row, session_id: sesi.id, qty: 1 }).select('*').single();
    if (error) return setErr(error.message);
    setTxs((t) => (t.some((x) => x.id === data.id) ? t : [...t, keTx(data)]));
    info(row.jenis === 'penjualan' ? `✅ ${row.keterangan} tercatat` : '✅ Pengeluaran tercatat');
  }

  function pilihProduk(p: Product) {
    if (metode === 'qris') {
      if (invoiceQris) { info('Tutup invoice QRIS yang sedang terbuka sebelum membuat keranjang baru.'); return; }
      staticConfirmationKeyRef.current = null;
      setStaticQrisConfirmation(null);
      setKeranjang((current) => ({ ...current, [p.id]: (current[p.id] ?? 0) + 1 }));
      return;
    }
    void catat({ jenis: 'penjualan', keterangan: p.nama, jumlah: p.harga, metode: 'tunai' }, p.id);
  }

  function ubahJumlahKeranjang(productId: string, delta: number) {
    staticConfirmationKeyRef.current = null;
    setKeranjang((current) => {
      const next = { ...current };
      const value = (next[productId] ?? 0) + delta;
      if (value <= 0) delete next[productId]; else next[productId] = value;
      return next;
    });
  }

  async function buatInvoiceQris() {
    if (!sesi || !userId || !cartLines.length || jenisQris !== 'dinamis' || invoiceQris) return;
    setErr('');
    const invoiceNo = `INV-${tanggal.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    const items: QrisInvoiceItem[] = cartLines.map(({ product, qty }) => ({
      productId: product.id, nama: product.nama, harga: product.harga, qty, subtotal: product.harga * qty,
    }));
    const { data, error } = await supabase.from('qris_invoice_drafts').insert({
      session_id: sesi.id, invoice_no: invoiceNo, total: cartTotal, items, status: 'pending',
    }).select('id,invoice_no,total,items,created_at').single();
    if (error) {
      console.error('Gagal menyimpan invoice QRIS:', error.message);
      setErr(error.message.includes('qris_invoice_drafts')
        ? 'Tabel invoice QRIS belum tersedia. Jalankan migration_v14_qris_invoice_drafts.sql di Supabase.'
        : `Invoice QRIS gagal dibuat: ${error.message}`);
      return;
    }
    const invoice: QrisInvoice = {
      id: data.id, invoice_no: data.invoice_no, total: Number(data.total),
      items: Array.isArray(data.items) ? data.items as QrisInvoiceItem[] : items,
      created_at: data.created_at, status: 'pending', paid_at: null, notificationMatch: false,
    };
    setInvoiceQris(invoice);
    setKeranjang({});
    info('Invoice QRIS dinamis dibuat. QR yang tampil masih contoh dan tidak dapat dibayar.');
  }

  async function tutupInvoiceQris() {
    if (!invoiceQris) return;
    const { error } = await supabase.from('qris_invoice_drafts')
      .update({ status: 'cancelled' }).eq('id', invoiceQris.id).eq('status', 'pending');
    if (error) return setErr(`Invoice tidak dapat ditutup: ${error.message}`);
    const alreadyPaid = invoiceQris.status === 'paid_manual';
    setInvoiceQris(null);
    info(alreadyPaid ? 'Invoice ditutup. Pencatatan simulasi tetap tersimpan.' : 'Invoice QRIS ditutup tanpa membuat transaksi.');
  }

  function mintaKonfirmasiQris(type: 'statis' | 'dinamis') {
    if (busyQrisConfirm) return;
    if (!sesi) return setErr('Mulai sesi penjualan terlebih dahulu.');
    if (type === 'statis' && !cartLines.length) return setErr('Tambahkan produk ke keranjang sebelum mencatat pembayaran.');
    if (type === 'dinamis' && (!invoiceQris || invoiceQris.status !== 'pending')) return setErr('Invoice QRIS dinamis tidak tersedia atau sudah diproses.');
    if (type === 'statis' && !staticConfirmationKeyRef.current) staticConfirmationKeyRef.current = crypto.randomUUID();
    setConfirmQrisType(type);
  }

  async function konfirmasiQrisDibayar() {
    if (!confirmQrisType || !sesi || busyQrisConfirm) return;
    const type = confirmQrisType;
    const total = type === 'statis' ? cartTotal : (invoiceQris?.total ?? 0);
    const count = type === 'statis'
      ? cartLines.reduce((sum, line) => sum + line.qty, 0)
      : (invoiceQris?.items.reduce((sum, item) => sum + item.qty, 0) ?? 0);
    if (total <= 0) return setErr('Total pembayaran harus lebih dari nol.');

    setBusyQrisConfirm(true);
    setErr('');
    const { data, error } = await supabase.rpc('confirm_qris_payment_simulation', {
      p_session_id: sesi.id,
      p_qris_type: type,
      p_items: type === 'statis' ? cartLines.map(({ product, qty }) => ({ productId: product.id, qty })) : null,
      p_invoice_id: type === 'dinamis' ? invoiceQris?.id : null,
      p_confirmation_key: type === 'statis' ? staticConfirmationKeyRef.current : null,
    });
    setBusyQrisConfirm(false);
    if (error) {
      const message = error.message || 'Konfirmasi pembayaran gagal.';
      if (message.includes('insufficient_stock')) setErr('Stok salah satu produk tidak mencukupi. Tidak ada transaksi yang dicatat.');
      else if (message.includes('confirm_qris_payment_simulation')) setErr('Fitur belum tersedia. Jalankan migration_v15_qris_simulation_confirmation.sql di Supabase terlebih dahulu.');
      else setErr(`Pembayaran simulasi gagal dicatat: ${message}`);
      return;
    }

    const recordedTotal = Number(data?.total ?? total);
    const rows = Array.isArray(data?.transactions) ? data.transactions as Tx[] : [];
    if (rows.length) {
      setTxs((current) => {
        const ids = new Set(current.map((tx) => tx.id));
        return [...current, ...rows.filter((tx) => !ids.has(tx.id)).map(keTx)];
      });
      setBaruIds((current) => new Set([...current, ...rows.map((tx) => tx.id)]));
      setTimeout(() => setBaruIds((current) => {
        const next = new Set(current);
        rows.forEach((tx) => next.delete(tx.id));
        return next;
      }), 2600);
    }

    if (type === 'dinamis') {
      setInvoiceQris((current) => current ? { ...current, status: 'paid_manual', paid_at: new Date().toISOString() } : current);
    } else {
      setKeranjang({});
      setStaticQrisConfirmation({ total: recordedTotal, count });
      staticConfirmationKeyRef.current = null;
    }

    setConfirmQrisType(null);
    const label = type === 'statis' ? 'QRIS Statis' : `QRIS Dinamis ${invoiceQris?.invoice_no ?? ''}`.trim();
    info(`✅ ${label} tercatat sebagai pembayaran simulasi sebesar ${rupiah(recordedTotal)}.`);
    const key = `qris-sim-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    setQris({
      key,
      jumlah: recordedTotal,
      title: 'Pembayaran QRIS Tercatat',
      detail: `${label} · ${count} item · simulasi manual tersimpan di transaksi dan laporan.`,
    });
    kaChing();
    setTimeout(() => setQris((current) => current?.key === key ? null : current), 5000);
  }

  async function batalTerakhir() {
    const last = txs[txs.length - 1];
    if (!last) return;
    if (last.payment_source === 'qris_simulation') {
      const { data, error } = await supabase.rpc('cancel_qris_payment_simulation', { p_transaction_id: last.id });
      if (error) return setErr(`Pembatalan QRIS simulasi gagal: ${error.message}`);
      const ids = Array.isArray(data?.transaction_ids) ? data.transaction_ids as string[] : [last.id];
      setTxs((current) => current.filter((tx) => !ids.includes(tx.id)));
      setInvoiceQris(null);
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

  async function tambahProduk(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const { data, error } = await supabase
      .from('products').insert({ nama: String(fd.get('nama')), harga: angka(fd.get('harga')) }).select('id,nama,harga').single();
    if (error) return setErr(error.message);
    setProducts((p) => [...p, { ...data, harga: Number(data.harga) }]);
    form.reset();
  }

  async function tambahBiaya(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    await catat({ jenis: 'biaya', keterangan: String(fd.get('ket')), jumlah: angka(fd.get('jumlah')), metode: null });
    form.reset();
  }

  async function keluar() { await supabase.auth.signOut(); router.replace('/login'); }
  function gantiSuara() { const on = !suara; setSuara(on); setSoundOn(on); unlockSound(); if (on) kaChing(); }

  const s = sesi ? summarize(sesi.modal_harian, txs) : null;
  const dataTren = useMemo<TitikTren[]>(
    () => (s ? [...tren, { tanggal, uangMasuk: s.pendapatan, untung: s.labaBersih }] : tren),
    [tren, s, tanggal]
  );

  if (!ready) return <div className="wrap"><div className="header-app"><p>Memuat…</p></div></div>;

  return (
    <div className="wrap">
      <div className="header-app">
        <h1>UMKM <span>Kasir</span></h1>
        <p>{namaUsaha} · {tglPanjang(tanggal)}</p>
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 8 }}>
          <span className={`live ${status === 'live' ? 'on' : status === 'offline' ? 'off' : ''}`}>
            <i />{status === 'live' ? 'QRIS live' : status === 'offline' ? 'Menyambung ulang…' : 'Menyambung…'}
          </span>
          <button className="sound-btn" onClick={gantiSuara}>{suara ? '🔔 Suara aktif' : '🔕 Suara mati'}</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      {!sesi && (
        <Rise>
          <form className="glass-card" onSubmit={mulaiHari}>
            <span className="label">Mulai hari ini</span>
            <RpInput name="modal" placeholder="Modal belanja hari ini, mis. Rp 500.000" />
            <Press className="btn-main">MULAI BERJUALAN</Press>
          </form>
        </Rise>
      )}

      {sesi && s && (
        <>
          <Rise>
            <div className="balance-card">
              <small>{ISTILAH.bep}</small>
              <h2 className={s.labaBersih < 0 ? 'neg' : 'pos'} style={s.labaBersih < 0 ? { fontSize: '1.35rem', lineHeight: 1.3 } : undefined}>
                {s.labaBersih < 0 ? teksBalikModal(s.labaBersih, rupiah) : <AnimatedRupiah value={s.labaBersih} />}
              </h2>
              {s.labaBersih >= 0 && <small style={{ display: 'block', marginTop: 6 }}>{ISTILAH.labaBersih} sementara</small>}
              <div className="track"><motion.i animate={{ width: `${s.progress}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} style={{ background: s.labaBersih >= 0 ? '#10b981' : '#f59e0b' }} /></div>
              <div className="stat3">
                <div><b>{rupiah(s.hpp)}</b><span>{ISTILAH.modal}</span></div>
                <div><b><AnimatedRupiah value={s.pendapatan} /></b><span>{ISTILAH.pendapatan}</span></div>
                <div><b>{rupiah(s.beban)}</b><span>{ISTILAH.beban}</span></div>
              </div>
            </div>
          </Rise>

          <Rise delay={0.05}>
            <div className="glass-card">
              <span className="label">Kasir dan metode pembayaran</span>
              <div className="toggle-stats">
                <button type="button" className={metode === 'tunai' ? 'active' : ''} onClick={() => { setMetode('tunai'); setKeranjang({}); }} disabled={!!invoiceQris}>💵 Tunai</button>
                <button type="button" className={metode === 'qris' ? 'active' : ''} onClick={() => setMetode('qris')} disabled={!!invoiceQris}>📱 QRIS</button>
              </div>
              {metode === 'qris' && (
                <>
                  <div className="toggle-stats">
                    <button type="button" className={jenisQris === 'statis' ? 'active' : ''} onClick={() => setJenisQris('statis')} disabled={!!invoiceQris}>QRIS Statis</button>
                    <button type="button" className={jenisQris === 'dinamis' ? 'active' : ''} onClick={() => setJenisQris('dinamis')} disabled={!!invoiceQris}>QRIS Dinamis</button>
                  </div>
                  <p className="muted" style={{ margin: '0 0 10px' }}>Tambahkan produk ke keranjang. QRIS Statis langsung tampil di layar; QRIS Dinamis membuat invoice terlebih dahulu.</p>
                </>
              )}
              <div className="tiles">
                {products.map((p) => (
                  <Press key={p.id} className="tile" onClick={() => pilihProduk(p)} disabled={!!invoiceQris}>
                    {p.nama}<small>{rupiah(p.harga)}{metode === 'qris' ? ` · + Keranjang${keranjang[p.id] ? ` (${keranjang[p.id]})` : ''}` : ' · Catat tunai'}</small>
                  </Press>
                ))}
              </div>
              {products.length === 0 && <p className="muted">Belum ada produk. Tambahkan di bawah.</p>}

              {metode === 'qris' && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <div><b className="text-sm">Keranjang QRIS</b><p className="m-0 mt-1 text-[11px] text-slate-500">{cartLines.reduce((sum, line) => sum + line.qty, 0)} item dipilih</p></div>
                    <button type="button" onClick={() => { staticConfirmationKeyRef.current = null; setKeranjang({}); }} disabled={!cartLines.length || !!invoiceQris} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600 disabled:opacity-40">Kosongkan</button>
                  </div>
                  {cartLines.length ? (
                    <div className="mt-3 space-y-2">
                      {cartLines.map(({ product, qty }) => (
                        <div key={product.id} className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <div className="min-w-0 flex-1"><b className="block truncate text-xs">{product.nama}</b><span className="text-[10px] text-slate-500">{rupiah(product.harga)} × {qty}</span></div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => ubahJumlahKeranjang(product.id, -1)} disabled={!!invoiceQris} className="h-7 w-7 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">−</button>
                            <span className="w-5 text-center text-xs font-black">{qty}</span>
                            <button type="button" onClick={() => ubahJumlahKeranjang(product.id, 1)} disabled={!!invoiceQris} className="h-7 w-7 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">+</button>
                          </div>
                          <b className="text-xs">{rupiah(product.harga * qty)}</b>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1"><span className="text-xs font-bold text-slate-600">Total</span><strong className="text-lg">{rupiah(cartTotal)}</strong></div>
                    </div>
                  ) : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">Keranjang kosong. Pilih produk di atas.</p>}

                  {jenisQris === 'statis' ? (
                    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                      <div className="text-center"><b className="text-sm text-emerald-900">QRIS Statis · Tampil Langsung</b><p className="mt-1 text-[10px] text-emerald-800">Tidak membuat invoice. Pelanggan biasanya memasukkan nominal secara manual.</p></div>
                      <img src="/qris-contoh.png" alt="QRIS contoh statis yang tidak dapat menerima pembayaran" className="mx-auto mt-3 aspect-square w-full max-w-[250px] rounded-xl bg-white object-contain p-2" />
                      <div className="mt-2 text-center text-sm font-black text-slate-900">Total pilihan produk: {rupiah(cartTotal)}</div>
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-5 text-amber-900">Gambar ini hanya contoh visual dan tidak dapat menerima pembayaran. Tombol di bawah hanya membuat pencatatan simulasi, bukan bukti dana masuk.</p>
                      <button type="button" onClick={() => mintaKonfirmasiQris('statis')} disabled={!cartLines.length || busyQrisConfirm} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{busyQrisConfirm ? 'MENYIMPAN…' : 'TANDAI SUDAH DIBAYAR · SIMULASI'}</button>
                      {staticQrisConfirmation && <p className="mt-2 rounded-xl border border-emerald-200 bg-white p-2 text-[10px] leading-5 text-emerald-900">✅ Pembayaran simulasi terakhir tercatat: {rupiah(staticQrisConfirmation.total)} untuk {staticQrisConfirmation.count} item. Cek bagian Transaksi terakhir dan Laporan.</p>}
                    </div>
                  ) : (
                    invoiceQris ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-center justify-between gap-2"><b className="text-sm text-amber-950">Invoice QRIS Dinamis</b><span className={`rounded-full px-2 py-1 text-[9px] font-black ${invoiceQris.status === 'paid_manual' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{invoiceQris.status === 'paid_manual' ? 'LUNAS · SIMULASI' : 'MENUNGGU'}</span></div>
                        <p className="mt-2 text-xs font-bold text-amber-900">{invoiceQris.invoice_no}</p>
                        <div className="mt-2 space-y-1 rounded-xl bg-white p-3">
                          {invoiceQris.items.map((item, index) => <div key={`${item.productId}-${index}`} className="flex justify-between gap-3 text-[11px]"><span>{item.nama} × {item.qty}</span><b>{rupiah(item.subtotal)}</b></div>)}
                          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm"><b>Total invoice</b><strong>{rupiah(invoiceQris.total)}</strong></div>
                        </div>
                        <img src="/qris-contoh.png" alt="QRIS dinamis contoh untuk tampilan invoice" className="mx-auto mt-3 aspect-square w-full max-w-[250px] rounded-xl bg-white object-contain p-2" />
                        <p className="mt-2 rounded-xl border border-amber-200 bg-white p-2 text-[10px] leading-5 text-amber-900">QR di atas tetap gambar contoh yang sama, bukan QR dinamis yang membawa nominal atau reference invoice. Tombol konfirmasi hanya mencatat simulasi manual; tidak memverifikasi dana dari bank atau GoPay Merchant.</p>
                        {invoiceQris.notificationMatch && invoiceQris.status === 'pending' && <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-[10px] leading-5 text-emerald-900">Ada notifikasi GoPay/MacroDroid dengan nominal yang sama. Cocokkan waktu dan mutasi di aplikasi merchant sebelum memakai konfirmasi manual.</p>}
                        {invoiceQris.status === 'pending' && <button type="button" onClick={() => mintaKonfirmasiQris('dinamis')} disabled={busyQrisConfirm} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white disabled:opacity-40">{busyQrisConfirm ? 'MENYIMPAN…' : 'TANDAI SUDAH DIBAYAR · SIMULASI'}</button>}
                        {invoiceQris.status === 'paid_manual' && <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-[10px] leading-5 text-emerald-900">✅ Pembayaran simulasi tercatat{invoiceQris.paid_at ? ` pada ${jam(invoiceQris.paid_at)}` : ''}. Transaksi dan jurnal sudah dibuat.</p>}
                        <button type="button" onClick={tutupInvoiceQris} className="mt-3 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-xs font-extrabold text-amber-950">{invoiceQris.status === 'pending' ? 'Tutup / Batalkan Invoice' : 'Tutup Invoice'}</button>
                      </div>
                    ) : (
                      <button type="button" onClick={buatInvoiceQris} disabled={!cartLines.length} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">BUAT INVOICE QRIS DINAMIS</button>
                    )
                  )}
                </div>
              )}
              <Press className="btn-soft" onClick={batalTerakhir} disabled={!txs.length}>Batalkan transaksi terakhir</Press>
            </div>
          </Rise>

          <Rise delay={0.1}>
            <div className="glass-card">
              <span className="label">Tren 7 hari terakhir</span>
              <TrenChart data={dataTren} tinggi={170} />
            </div>
          </Rise>

          <form className="glass-card" onSubmit={tambahBiaya}>
            <span className="label">Catat pengeluaran lain</span>
            <input name="ket" placeholder="Mis. gas, plastik, parkir" required />
            <RpInput name="jumlah" placeholder="Jumlah (Rp)" />
            <Press className="btn-soft">Simpan pengeluaran</Press>
          </form>

          <div className="glass-card">
            <span className="label">Transaksi terakhir</span>
            {txs.length === 0 && <p className="muted">Belum ada transaksi hari ini.</p>}
            <AnimatePresence initial={false}>
              {[...txs].reverse().slice(0, 8).map((t) => {
                const masuk = t.jenis === 'penjualan';
                return (
                  <motion.div key={t.id} layout initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                    className={`mut ${baruIds.has(t.id) ? 'baru' : ''}`}>
                    <div className={`mut-ico ${masuk ? 'in' : 'out'}`}>{masuk ? '↓' : '↑'}</div>
                    <div className="grow"><b>{t.keterangan}</b><div className="muted">{t.payment_source === 'qris_simulation' ? 'QRIS SIMULASI' : t.metode ? t.metode.toUpperCase() : 'Biaya'} · {jam(t.created_at)}</div></div>
                    <div className={`mut-amt ${masuk ? 'in' : 'out'}`}>{rupiahTanda(t.jumlah, masuk)}</div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <Press className="btn-main" onClick={() => exportExcel({ namaUsaha, tanggal, modal: sesi.modal_harian, txs })}>
            UNDUH LAPORAN EXCEL HARI INI
          </Press>
        </>
      )}

      <form className="glass-card" onSubmit={tambahProduk}>
        <span className="label">Tambah produk</span>
        <input name="nama" placeholder="Nama produk, mis. Bakwan" required />
        <RpInput name="harga" placeholder="Harga jual (Rp)" />
        <Press className="btn-soft">Simpan produk</Press>
      </form>
      <Press className="btn-soft" onClick={keluar}>Keluar</Press>

      <AnimatePresence>
        {qris && (
          <motion.div key={qris.key} className="qris-toast" role="status"
            initial={{ y: -90, x: '-50%', opacity: 0, scale: 0.9 }} animate={{ y: 0, x: '-50%', opacity: 1, scale: 1 }} exit={{ y: -90, x: '-50%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
            <span className="ico">🔔</span>
            <div><b>{qris.title || (qris.nominalCocok ? 'Notifikasi QRIS Sesuai Nominal' : 'Pembayaran QRIS Masuk')}</b><strong>{rupiah(qris.jumlah)}!</strong>{qris.detail && <small style={{ display: 'block', marginTop: 3, fontSize: 10 }}>{qris.detail}</small>}{qris.invoiceNo && <small style={{ display: 'block', marginTop: 3, fontSize: 10 }}>Nominal sama dengan {qris.invoiceNo}. Periksa mutasi GoPay Merchant; invoice tidak otomatis lunas.</small>}</div>
          </motion.div>
        )}
      </AnimatePresence>
      {confirmQrisType && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="qris-confirm-title">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 text-slate-900 shadow-2xl">
            <div className="flex items-center gap-2"><span className="text-2xl">🔔</span><h2 id="qris-confirm-title" className="m-0 text-lg font-black">Konfirmasi Pembayaran QRIS</h2></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">QRIS yang tampil adalah gambar contoh dan tidak bisa menerima uang. Melanjutkan akan membuat <b>transaksi simulasi</b> sebesar <b>{rupiah(confirmQrisType === 'statis' ? cartTotal : (invoiceQris?.total ?? 0))}</b>, memperbarui stok yang dilacak, dan memasukkannya ke laporan dengan label <b>QRIS Simulasi</b>.</p>
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Jangan gunakan tombol ini sebagai bukti pembayaran sungguhan. Untuk transaksi nyata, periksa dana di aplikasi merchant terlebih dahulu.</p>
            <div className="mt-4 flex gap-2"><button type="button" disabled={busyQrisConfirm} onClick={() => setConfirmQrisType(null)} className="flex-1 rounded-xl border border-slate-200 px-3 py-3 text-xs font-bold">Kembali</button><button type="button" disabled={busyQrisConfirm} onClick={konfirmasiQrisDibayar} className="flex-1 rounded-xl bg-emerald-700 px-3 py-3 text-xs font-extrabold text-white disabled:opacity-50">{busyQrisConfirm ? 'Menyimpan…' : 'Ya, catat simulasi'}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      <BottomNav />
    </div>
  );
}
