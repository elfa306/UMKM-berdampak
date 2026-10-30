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
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [qris, setQris] = useState<{ key: string; jumlah: number } | null>(null);
  const [baruIds, setBaruIds] = useState<Set<string>>(new Set());
  const [suara, setSuara] = useState(true);
  const sudahDiproses = useRef<Set<string>>(new Set());
  const sesiRef = useRef<Sesi | null>(null);
  sesiRef.current = sesi;

  const info = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2000); };

  // Pindahkan pembayaran QRIS yang sempat tertahan di kotak masuk (hari belum dimulai) ke transaksi hari ini
  async function importQris(sesiId: string) {
    const { data: inbox } = await supabase
      .from('qris_inbox').select('id,mutation_id,jumlah,catatan,received_at').eq('posted', false).order('received_at');
    for (const m of inbox ?? []) {
      const hari = new Date(m.received_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      if (hari !== tanggal) continue;
      const ket = 'QRIS masuk' + (m.catatan ? ` · ${String(m.catatan).slice(0, 40)}` : '');
      const { error } = await supabase.from('transactions').insert({
        session_id: sesiId, jenis: 'penjualan', keterangan: ket, jumlah: Number(m.jumlah), qty: 1, metode: 'qris', ref_id: m.mutation_id,
      });
      if (error && error.code !== '23505') continue; // 23505 = sudah tercatat
      await supabase.from('qris_inbox').update({ posted: true }).eq('id', m.id);
    }
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setUserId(user.id);
    setNamaUsaha(user.user_metadata?.nama_usaha ?? 'Usaha Saya');

    const [p, s] = await Promise.all([
      supabase.from('products').select('id,nama,harga').order('created_at'),
      supabase.from('daily_sessions').select('id,modal_harian').eq('tanggal', tanggal).maybeSingle(),
    ]);
    setProducts((p.data ?? []).map((x) => ({ ...x, harga: Number(x.harga) })));
    if (s.data) {
      setSesi({ id: s.data.id, modal_harian: Number(s.data.modal_harian) });
      await importQris(s.data.id);
      const t = await supabase.from('transactions').select('*').eq('session_id', s.data.id).order('created_at');
      setTxs((t.data ?? []).map((x) => ({ ...x, jumlah: Number(x.jumlah) })) as Tx[]);
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
    setQris({ key: tx.id, jumlah: tx.jumlah });
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

  async function catat(row: { jenis: 'penjualan' | 'biaya'; keterangan: string; jumlah: number; metode: 'tunai' | 'qris' | null }) {
    if (!sesi) return;
    setErr('');
    const { data, error } = await supabase.from('transactions').insert({ ...row, session_id: sesi.id, qty: 1 }).select('*').single();
    if (error) return setErr(error.message);
    setTxs((t) => (t.some((x) => x.id === data.id) ? t : [...t, keTx(data)]));
    info(row.jenis === 'penjualan' ? `✅ ${row.keterangan} tercatat` : '✅ Pengeluaran tercatat');
  }

  async function batalTerakhir() {
    const last = txs[txs.length - 1];
    if (!last) return;
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
              <span className="label">Catat penjualan</span>
              <div className="toggle-stats">
                <button className={metode === 'tunai' ? 'active' : ''} onClick={() => setMetode('tunai')}>💵 Tunai</button>
                <button className={metode === 'qris' ? 'active' : ''} onClick={() => setMetode('qris')}>📱 QRIS</button>
              </div>
              <div className="tiles">
                {products.map((p) => (
                  <Press key={p.id} className="tile" onClick={() => catat({ jenis: 'penjualan', keterangan: p.nama, jumlah: p.harga, metode })}>
                    {p.nama}<small>{rupiah(p.harga)}</small>
                  </Press>
                ))}
              </div>
              {products.length === 0 && <p className="muted">Belum ada produk. Tambahkan di bawah.</p>}
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
                    <div className="grow"><b>{t.keterangan}</b><div className="muted">{t.metode ? t.metode.toUpperCase() : 'Biaya'} · {jam(t.created_at)}</div></div>
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
            <div><b>Pembayaran QRIS Masuk</b><strong>{rupiah(qris.jumlah)}!</strong></div>
          </motion.div>
        )}
      </AnimatePresence>
      {toast && <div className="toast">{toast}</div>}
      <BottomNav />
    </div>
  );
}
