'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchHari, type Hari } from '@/lib/data';
import { PALET, labaLabel, rupiah, rupiahTanda, summarize, tglPendek } from '@/lib/accounting';
import { exportExcel, exportExcelPeriode } from '@/lib/exportExcel';
import { exportPdf } from '@/lib/exportPdf';
import { ISTILAH } from '@/lib/istilah';
import { Press } from '@/components/Motion';
import TrenChart from '@/components/TrenChart';
import BottomNav from '@/components/BottomNav';
import Donut from '@/components/Donut';
import PeriodFilter, { preset, type Periode } from '@/components/PeriodFilter';

const ROWS = 10;
type Tab = 'statistik' | 'riwayat';

// Halaman gabungan: Statistik + Riwayat (satu periode, satu kali ambil data)
export default function Laporan() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('statistik');
  const [periode, setPeriode] = useState<Periode>(() => preset('30'));
  const [hari, setHari] = useState<Hari[]>([]);
  const [jenis, setJenis] = useState<'penjualan' | 'biaya'>('penjualan');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [nama, setNama] = useState('Usaha Saya');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);

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

  // ---- Statistik ----
  const st = useMemo(() => {
    const semua = ringkas.flatMap((r) => r.h.txs);
    const g = new Map<string, { nilai: number; n: number }>();
    semua.filter((t) => t.jenis === jenis).forEach((t) => {
      const x = g.get(t.keterangan) ?? { nilai: 0, n: 0 };
      x.nilai += t.jumlah; x.n += t.qty; g.set(t.keterangan, x);
    });
    const rows = [...g].map(([label, v], i) => ({ label, ...v, i })).sort((a, b) => b.nilai - a.nilai)
      .map((r, i) => ({ ...r, color: PALET[i % PALET.length] }));
    const tunai = ringkas.reduce((a, r) => a + r.s.tunai, 0);
    const qris = ringkas.reduce((a, r) => a + r.s.qris, 0);
    return {
      rows, total: rows.reduce((a, r) => a + r.nilai, 0), tunai, qris,
      untung: ringkas.filter((r) => r.s.labaBersih > 0).length,
      rugi: ringkas.filter((r) => r.s.labaBersih < 0).length,
      tren: [...ringkas].reverse().slice(-90).map((r) => ({ tanggal: r.h.tanggal, uangMasuk: r.s.pendapatan, untung: r.s.labaBersih })),
    };
  }, [ringkas, jenis]);
  const pQris = st.tunai + st.qris > 0 ? Math.round((st.qris / (st.tunai + st.qris)) * 100) : 0;

  // ---- Ringkasan bersama ----
  const totalLaba = ringkas.reduce((a, r) => a + r.s.labaBersih, 0);
  const totalPend = ringkas.reduce((a, r) => a + r.s.pendapatan, 0);

  // ---- Riwayat ----
  const tampil = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return ringkas;
    return ringkas.filter(({ h }) =>
      tglPendek(h.tanggal).toLowerCase().includes(k) ||
      h.txs.some((t) => t.keterangan.toLowerCase().includes(k) || String(t.jumlah).includes(k)));
  }, [ringkas, q]);
  const pages = Math.max(1, Math.ceil(tampil.length / ROWS));
  const slice = tampil.slice((page - 1) * ROWS, page * ROWS);

  async function hapus(id: string) {
    if (!confirm('Hapus transaksi ini? Laba hari tersebut akan dihitung ulang.')) return;
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return setErr(error.message);
    load();
  }

  const cetakPdf = () => areaRef.current && exportPdf(
    areaRef.current,
    `${tab === 'statistik' ? 'Statistik' : 'Riwayat'}-${periode.start}_sd_${periode.end}.pdf`,
    `${nama} · ${tab === 'statistik' ? 'Statistik' : 'Riwayat'} ${periode.start} s.d. ${periode.end}`,
  );

  return (
    <div className="wrap" ref={areaRef}>
      <div className="header-app"><h1>Riwayat <span>&amp; Statistik</span></h1><p>Rekap harian, penjualan, biaya, dan laba</p></div>

      <div className="balance-card">
        <small>{ISTILAH.labaBersih} periode</small>
        <h2 className={totalLaba < 0 ? 'neg' : 'pos'}>{rupiah(totalLaba)}</h2>
        <div className="stat3" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><b>{rupiah(totalPend)}</b><span>{ISTILAH.pendapatan}</span></div>
          <div><b>{st.untung} hari</b><span>Hari untung</span></div>
          <div><b>{st.rugi} hari</b><span>Hari rugi</span></div>
        </div>
      </div>

      <PeriodFilter value={periode} onChange={setPeriode} />
      {err && <p className="err">{err}</p>}

      <div className="toggle-stats" data-html2canvas-ignore>
        <button className={tab === 'statistik' ? 'active' : ''} onClick={() => setTab('statistik')}>📊 Statistik</button>
        <button className={tab === 'riwayat' ? 'active' : ''} onClick={() => setTab('riwayat')}>🕘 Riwayat</button>
      </div>

      {tab === 'statistik' && (
        <>
          <div className="toggle-stats">
            <button className={jenis === 'penjualan' ? 'active' : ''} onClick={() => setJenis('penjualan')}>Jualan</button>
            <button className={jenis === 'biaya' ? 'active' : ''} onClick={() => setJenis('biaya')}>Belanja &amp; Biaya</button>
          </div>

          <div className="glass-card">
            <Donut data={st.rows.map((r) => ({ label: r.label, value: r.nilai, color: r.color }))} center={rupiah(st.total)} />
            {st.rows.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Belum ada data</p>}
            {st.rows.map((r) => {
              const p = st.total > 0 ? Math.round((r.nilai / st.total) * 100) : 0;
              return (
                <div key={r.label} className="cat-item">
                  <div className="cat-dot" style={{ background: r.color + '22', color: r.color }}>{p}%</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row"><b style={{ fontSize: '.82rem' }}>{r.label}</b><b style={{ fontSize: '.82rem' }}>{rupiah(r.nilai)}</b></div>
                    <div className="muted">{r.n}× {jenis === 'penjualan' ? 'terjual' : 'dicatat'}</div>
                    <div className="progress"><i style={{ width: `${p}%`, background: r.color }} /></div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="glass-card">
            <span className="label">Tunai vs QRIS</span>
            <div className="row"><b style={{ fontSize: '.8rem' }}>💵 Tunai</b><b style={{ fontSize: '.8rem' }}>{rupiah(st.tunai)}</b></div>
            <div className="row"><b style={{ fontSize: '.8rem' }}>📱 QRIS</b><b style={{ fontSize: '.8rem' }}>{rupiah(st.qris)}</b></div>
            <div className="progress"><i style={{ width: `${pQris}%`, background: '#2563eb' }} /></div>
            <p className="muted" style={{ margin: 0 }}>{pQris}% pendapatan lewat QRIS</p>
          </div>

          <div className="glass-card">
            <span className="label">Tren uang masuk &amp; untung harian</span>
            <TrenChart data={st.tren} />
            <p className="muted" style={{ margin: 0 }}>Garis biru: uang masuk. Batang hijau: untung. Batang merah: rugi.</p>
          </div>
        </>
      )}

      {tab === 'riwayat' && (
        <>
          <div className="row" data-html2canvas-ignore style={{ gap: 8 }}>
            <Press className="btn-soft" disabled={!hari.length} onClick={() => exportExcelPeriode({ namaUsaha: nama, start: periode.start, end: periode.end, hari })}>📗 Excel periode</Press>
          </div>
          <input placeholder="🔍 Cari tanggal, produk, nominal..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          {loading && <p className="muted" style={{ textAlign: 'center' }}>Memuat…</p>}
          {!loading && tampil.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>Belum ada data pada periode ini</p>}

          {slice.map(({ h, s }) => (
            <div key={h.id} className="glass-card">
              <button className="day-head" onClick={() => setOpen(open === h.id ? null : h.id)}>
                <div>
                  <div className="fw" style={{ fontSize: '.9rem' }}>{tglPendek(h.tanggal)}</div>
                  <div className="muted">{h.txs.length} transaksi · Uang masuk {rupiah(s.pendapatan)}</div>
                </div>
                <div className="right">
                  <div className={`fw ${s.labaBersih < 0 ? 'neg' : 'pos'}`}>{rupiah(s.labaBersih)}</div>
                  <span className={`badge ${s.labaBersih > 0 ? 'ok' : s.labaBersih < 0 ? 'bad' : 'flat'}`}>{labaLabel(s.labaBersih)}</span>
                </div>
              </button>

              {open === h.id && (
                <>
                  <div>
                    <div className="line"><span>{ISTILAH.modal}</span><span>{rupiah(s.hpp)}</span></div>
                    <div className="line"><span>{ISTILAH.tunai}</span><span>{rupiah(s.tunai)}</span></div>
                    <div className="line"><span>{ISTILAH.qris}</span><span>{rupiah(s.qris)}</span></div>
                    <div className="line"><span>{ISTILAH.bebanKet}</span><span>{rupiah(s.beban)}</span></div>
                  </div>
                  {[...h.txs].reverse().map((t) => {
                    const masuk = t.jenis === 'penjualan';
                    return (
                      <div key={t.id} className="mut">
                        <div className={`mut-ico ${masuk ? 'in' : 'out'}`}>{masuk ? '↓' : '↑'}</div>
                        <div className="grow">
                          <b>{t.keterangan}</b>
                          <div className="muted">{t.metode ? t.metode.toUpperCase() : 'Biaya'} · {new Date(t.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}</div>
                        </div>
                        <div className={`mut-amt ${masuk ? 'in' : 'out'}`}>{rupiahTanda(t.jumlah, masuk)}</div>
                        <button className="x-btn" data-html2canvas-ignore aria-label="Hapus" onClick={() => hapus(t.id)}>✕</button>
                      </div>
                    );
                  })}
                  <button className="btn-main" data-html2canvas-ignore onClick={() => exportExcel({ namaUsaha: nama, tanggal: h.tanggal, modal: h.modal, txs: h.txs })}>
                    UNDUH EXCEL HARI INI
                  </button>
                </>
              )}
            </div>
          ))}

          {tampil.length > ROWS && (
            <div className="pager" data-html2canvas-ignore>
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>←</button>
              <span className="muted fw">{page} / {pages}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page === pages}>→</button>
            </div>
          )}
        </>
      )}

      <Press className="btn-main" data-html2canvas-ignore onClick={cetakPdf}>📄 CETAK PDF UNTUK BANK</Press>
      <BottomNav />
    </div>
  );
}
