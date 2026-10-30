'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchHari, type Hari } from '@/lib/data';
import { PALET, rupiah, summarize } from '@/lib/accounting';
import { exportPdf } from '@/lib/exportPdf';
import { ISTILAH } from '@/lib/istilah';
import { Press } from '@/components/Motion';
import TrenChart from '@/components/TrenChart';
import BottomNav from '@/components/BottomNav';
import Donut from '@/components/Donut';
import PeriodFilter, { preset, type Periode } from '@/components/PeriodFilter';

export default function Statistik() {
  const router = useRouter();
  const [periode, setPeriode] = useState<Periode>(() => preset('30'));
  const [jenis, setJenis] = useState<'penjualan' | 'biaya'>('penjualan');
  const [hari, setHari] = useState<Hari[]>([]);
  const [err, setErr] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  const [nama, setNama] = useState('Usaha Saya');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setNama(user.user_metadata?.nama_usaha ?? 'Usaha Saya');
    try { setHari(await fetchHari(periode.start, periode.end)); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [periode, router]);
  useEffect(() => { load(); }, [load]);

  const st = useMemo(() => {
    const ringkas = hari.map((h) => ({ h, s: summarize(h.modal, h.txs) }));
    const semua = hari.flatMap((h) => h.txs);
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
      laba: ringkas.reduce((a, r) => a + r.s.labaBersih, 0),
      untung: ringkas.filter((r) => r.s.labaBersih > 0).length,
      rugi: ringkas.filter((r) => r.s.labaBersih < 0).length,
      tren: [...ringkas].reverse().slice(-90).map((r) => ({ tanggal: r.h.tanggal, uangMasuk: r.s.pendapatan, untung: r.s.labaBersih })),
    };
  }, [hari, jenis]);

  const pQris = st.tunai + st.qris > 0 ? Math.round((st.qris / (st.tunai + st.qris)) * 100) : 0;

  return (
    <div className="wrap" ref={areaRef}>
      <div className="header-app"><h1>Statistik <span>Usaha</span></h1><p>Ringkasan penjualan, biaya, dan laba</p></div>
      <div className="balance-card">
        <small>{ISTILAH.labaBersih} periode</small>
        <h2 className={st.laba < 0 ? 'neg' : 'pos'}>{rupiah(st.laba)}</h2>
        <div className="stat3" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div><b>{st.untung} hari</b><span>Hari untung</span></div>
          <div><b>{st.rugi} hari</b><span>Hari rugi</span></div>
        </div>
      </div>

      <PeriodFilter value={periode} onChange={setPeriode} />
      {err && <p className="err">{err}</p>}

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
      <Press className="btn-main" data-html2canvas-ignore onClick={() => areaRef.current && exportPdf(areaRef.current, `Statistik-${periode.start}_sd_${periode.end}.pdf`, `${nama} · Statistik ${periode.start} s.d. ${periode.end}`)}>
        📄 CETAK PDF UNTUK BANK
      </Press>
      <BottomNav />
    </div>
  );
}
