'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchHari, type Hari } from '@/lib/data';
import { exportExcel } from '@/lib/exportExcel';
import { labaLabel, rupiah, summarize, tglPendek } from '@/lib/accounting';
import BottomNav from '@/components/BottomNav';
import PeriodFilter, { preset, type Periode } from '@/components/PeriodFilter';

const ROWS = 10;

export default function Riwayat() {
  const router = useRouter();
  const [periode, setPeriode] = useState<Periode>(() => preset('30'));
  const [hari, setHari] = useState<Hari[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [nama, setNama] = useState('Usaha Saya');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setNama(user.user_metadata?.nama_usaha ?? 'Usaha Saya');
    setLoading(true);
    try { setHari(await fetchHari(periode.start, periode.end)); setErr(''); }
    catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, [periode, router]);

  useEffect(() => { load(); setPage(1); }, [load]);

  const ringkas = useMemo(() => hari.map((h) => ({ h, s: summarize(h.modal, h.txs) })), [hari]);
  const tampil = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return ringkas;
    return ringkas.filter(({ h }) =>
      tglPendek(h.tanggal).toLowerCase().includes(k) ||
      h.txs.some((t) => t.keterangan.toLowerCase().includes(k) || String(t.jumlah).includes(k)));
  }, [ringkas, q]);

  const totalLaba = ringkas.reduce((a, r) => a + r.s.labaBersih, 0);
  const totalPend = ringkas.reduce((a, r) => a + r.s.pendapatan, 0);
  const pages = Math.max(1, Math.ceil(tampil.length / ROWS));
  const slice = tampil.slice((page - 1) * ROWS, page * ROWS);

  async function hapus(id: string) {
    if (!confirm('Hapus transaksi ini? Laba hari tersebut akan dihitung ulang.')) return;
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return setErr(error.message);
    load();
  }

  return (
    <div className="wrap">
      <div className="header-app"><h1>Riwayat <span>Harian</span></h1><p>Rekap setiap hari berjualan</p></div>
      <div className="balance-card">
        <small>Laba bersih periode</small>
        <h2 className={totalLaba < 0 ? 'neg' : 'pos'}>{rupiah(totalLaba)}</h2>
        <div className="stat3" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div><b>{rupiah(totalPend)}</b><span>Pendapatan</span></div>
          <div><b>{hari.length} hari</b><span>Berjualan</span></div>
        </div>
      </div>

      <PeriodFilter value={periode} onChange={setPeriode} />
      <input placeholder="🔍 Cari tanggal, produk, nominal..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {err && <p className="err">{err}</p>}
      {loading && <p className="muted" style={{ textAlign: 'center' }}>Memuat…</p>}
      {!loading && tampil.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>Belum ada data pada periode ini</p>}

      {slice.map(({ h, s }) => (
        <div key={h.id} className="glass-card">
          <button className="day-head" onClick={() => setOpen(open === h.id ? null : h.id)}>
            <div>
              <div className="fw" style={{ fontSize: '.9rem' }}>{tglPendek(h.tanggal)}</div>
              <div className="muted">{h.txs.length} transaksi · Pendapatan {rupiah(s.pendapatan)}</div>
            </div>
            <div className="right">
              <div className={`fw ${s.labaBersih < 0 ? 'neg' : 'pos'}`}>{rupiah(s.labaBersih)}</div>
              <span className={`badge ${s.labaBersih > 0 ? 'ok' : s.labaBersih < 0 ? 'bad' : 'flat'}`}>{labaLabel(s.labaBersih)}</span>
            </div>
          </button>

          {open === h.id && (
            <>
              <div>
                <div className="line"><span>Modal (HPP)</span><span>{rupiah(s.hpp)}</span></div>
                <div className="line"><span>Penjualan tunai</span><span>{rupiah(s.tunai)}</span></div>
                <div className="line"><span>Penjualan QRIS</span><span>{rupiah(s.qris)}</span></div>
                <div className="line"><span>Beban operasional</span><span>{rupiah(s.beban)}</span></div>
              </div>
              {[...h.txs].reverse().map((t) => (
                <div key={t.id} className="trx" style={{ borderLeftColor: t.jenis === 'penjualan' ? '#10b981' : '#ef4444' }}>
                  <div className="grow">
                    <b>{t.keterangan}</b>
                    <div className="muted">{t.metode ? t.metode.toUpperCase() : 'Beban'} · {new Date(t.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}</div>
                  </div>
                  <div className={`amt ${t.jenis === 'penjualan' ? 'pos' : 'neg'}`}>{t.jenis === 'penjualan' ? '+' : '-'} {rupiah(t.jumlah)}</div>
                  <button className="x-btn" aria-label="Hapus" onClick={() => hapus(t.id)}>✕</button>
                </div>
              ))}
              <button className="btn-main" onClick={() => exportExcel({ namaUsaha: nama, tanggal: h.tanggal, modal: h.modal, txs: h.txs })}>
                UNDUH EXCEL HARI INI
              </button>
            </>
          )}
        </div>
      ))}

      {tampil.length > ROWS && (
        <div className="pager">
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>←</button>
          <span className="muted fw">{page} / {pages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page === pages}>→</button>
        </div>
      )}
      <BottomNav />
    </div>
  );
}
