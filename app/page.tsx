'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { exportExcel } from '@/lib/exportExcel';
import { angka, rupiah, summarize, todayISO, tglPanjang, type Product, type Tx } from '@/lib/accounting';
import BottomNav from '@/components/BottomNav';
import RpInput from '@/components/RpInput';

type Sesi = { id: string; modal_harian: number };

export default function Kasir() {
  const router = useRouter();
  const tanggal = todayISO();
  const [namaUsaha, setNamaUsaha] = useState('');
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [metode, setMetode] = useState<'tunai' | 'qris'>('tunai');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const info = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2000); };

  // Pindahkan pembayaran QRIS yang masuk lewat webhook Moota ke transaksi hari ini
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
      if (error && error.code !== '23505') continue; // 23505 = sudah tercatat sebelumnya
      await supabase.from('qris_inbox').update({ posted: true }).eq('id', m.id);
    }
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
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
  // Segarkan otomatis agar pembayaran QRIS tampil mendekati real time
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

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
    setTxs((t) => [...t, { ...data, jumlah: Number(data.jumlah) } as Tx]);
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

  if (!ready) return <div className="wrap"><div className="header-app"><p>Memuat…</p></div></div>;
  const s = sesi ? summarize(sesi.modal_harian, txs) : null;

  return (
    <div className="wrap">
      <div className="header-app">
        <h1>UMKM <span>Kasir</span></h1>
        <p>{namaUsaha} · {tglPanjang(tanggal)}</p>
      </div>
      {err && <p className="err">{err}</p>}

      {!sesi && (
        <form className="glass-card" onSubmit={mulaiHari}>
          <span className="label">Mulai hari ini</span>
          <RpInput name="modal" placeholder="Modal hari ini, mis. Rp 500.000" />
          <button className="btn-main">MULAI BERJUALAN</button>
        </form>
      )}

      {sesi && s && (
        <>
          <div className="balance-card">
            <small>{s.labaBersih < 0 ? 'Menuju titik impas' : 'Laba bersih sementara'}</small>
            <h2 className={s.labaBersih < 0 ? 'neg' : 'pos'}>{rupiah(s.labaBersih)}</h2>
            <div className="track"><i style={{ width: `${s.progress}%`, background: s.labaBersih >= 0 ? '#10b981' : '#f59e0b' }} /></div>
            <div className="stat3">
              <div><b>{rupiah(s.hpp)}</b><span>Modal</span></div>
              <div><b>{rupiah(s.pendapatan)}</b><span>Pendapatan</span></div>
              <div><b>{rupiah(s.beban)}</b><span>Beban</span></div>
            </div>
          </div>

          <div className="glass-card">
            <span className="label">Catat penjualan</span>
            <div className="toggle-stats">
              <button className={metode === 'tunai' ? 'active' : ''} onClick={() => setMetode('tunai')}>💵 Tunai</button>
              <button className={metode === 'qris' ? 'active' : ''} onClick={() => setMetode('qris')}>📱 QRIS</button>
            </div>
            <div className="tiles">
              {products.map((p) => (
                <button key={p.id} className="tile" onClick={() => catat({ jenis: 'penjualan', keterangan: p.nama, jumlah: p.harga, metode })}>
                  {p.nama}<small>{rupiah(p.harga)}</small>
                </button>
              ))}
            </div>
            {products.length === 0 && <p className="muted">Belum ada produk. Tambahkan di bawah.</p>}
            <button className="btn-soft" onClick={batalTerakhir} disabled={!txs.length}>Batalkan transaksi terakhir</button>
          </div>

          <form className="glass-card" onSubmit={tambahBiaya}>
            <span className="label">Catat pengeluaran lain</span>
            <input name="ket" placeholder="Mis. gas, plastik, parkir" required />
            <RpInput name="jumlah" placeholder="Jumlah (Rp)" />
            <button className="btn-soft">Simpan pengeluaran</button>
          </form>

          <div className="glass-card">
            <span className="label">Transaksi terakhir</span>
            {txs.length === 0 && <p className="muted">Belum ada transaksi hari ini.</p>}
            {[...txs].reverse().slice(0, 6).map((t) => (
              <div key={t.id} className="trx" style={{ borderLeftColor: t.jenis === 'penjualan' ? '#10b981' : '#ef4444' }}>
                <div className="grow"><b>{t.keterangan}</b><div className="muted">{t.metode ? t.metode.toUpperCase() : 'Beban'} · {new Date(t.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}</div></div>
                <div className={`amt ${t.jenis === 'penjualan' ? 'pos' : 'neg'}`}>{t.jenis === 'penjualan' ? '+' : '-'} {rupiah(t.jumlah)}</div>
              </div>
            ))}
          </div>

          <button className="btn-main" onClick={() => exportExcel({ namaUsaha, tanggal, modal: sesi.modal_harian, txs })}>
            UNDUH LAPORAN EXCEL HARI INI
          </button>
        </>
      )}

      <form className="glass-card" onSubmit={tambahProduk}>
        <span className="label">Tambah produk</span>
        <input name="nama" placeholder="Nama produk, mis. Bakwan" required />
        <RpInput name="harga" placeholder="Harga jual (Rp)" />
        <button className="btn-soft">Simpan produk</button>
      </form>
      <button className="btn-soft" onClick={keluar}>Keluar</button>

      {toast && <div className="toast">{toast}</div>}
      <BottomNav />
    </div>
  );
}
