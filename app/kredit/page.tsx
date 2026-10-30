'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { fetchHari } from '@/lib/data';
import { rupiah, todayISO } from '@/lib/accounting';
import { hitungKelayakan, SYARAT, type Kelayakan } from '@/lib/credit';
import { bandingkan } from '@/lib/pembiayaan';
import { BI_RATE, BI_RATE_SUMBER, BI_RATE_TGL, KUR_BUNGA } from '@/lib/config';
import { exportExcelPeriode } from '@/lib/exportExcel';
import { exportPdf } from '@/lib/exportPdf';
import { ISTILAH } from '@/lib/istilah';
import BottomNav from '@/components/BottomNav';
import { Press, Rise } from '@/components/Motion';

const geser = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };

function Ring({ nilai, warna }: { nilai: number; warna: string }) {
  const R = 60, C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 150 150" className="skor-ring">
      <circle cx="75" cy="75" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
      <motion.circle cx="75" cy="75" r={R} fill="none" stroke={warna} strokeWidth="14" strokeLinecap="round" transform="rotate(-90 75 75)"
        strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - nilai / 100) }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      <text x="75" y="72" textAnchor="middle" fontSize="34" fontWeight="800" fill="#0f172a">{nilai}</text>
      <text x="75" y="94" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">dari 100</text>
    </svg>
  );
}

export default function Kredit() {
  const router = useRouter();
  const hariIni = todayISO();
  const areaRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'skor' | 'simulasi'>('skor');
  const [nama, setNama] = useState('Usaha Saya');
  const [k, setK] = useState<Kelayakan | null>(null);
  const [err, setErr] = useState('');
  // simulasi
  const [pokok, setPokok] = useState(10_000_000);
  const [tenor, setTenor] = useState(24);
  const [biBaru, setBiBaru] = useState(BI_RATE);
  const [spread, setSpread] = useState(9);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setNama(user.user_metadata?.nama_usaha ?? 'Usaha Saya');
    try {
      const [hari, pertama] = await Promise.all([
        fetchHari(geser(hariIni, -SYARAT.windowHari), geser(hariIni, -1)),
        supabase.from('daily_sessions').select('tanggal').order('tanggal').limit(1).maybeSingle(),
      ]);
      setK(hitungKelayakan(hari, pertama.data?.tanggal ?? null, hariIni));
      setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [router, hariIni]);
  useEffect(() => { load(); }, [load]);

  const sim = useMemo(() => bandingkan(pokok, tenor, BI_RATE, biBaru, spread, KUR_BUNGA), [pokok, tenor, biBaru, spread]);
  const simKini = useMemo(() => bandingkan(pokok, tenor, BI_RATE, BI_RATE, spread, KUR_BUNGA), [pokok, tenor, spread]);
  const untungBulan = Math.max(0, k?.totalUntung ?? 0);
  const selisih = sim.murabahah.cicilan - simKini.murabahah.cicilan;
  const porsi = (c: number) => (untungBulan > 0 ? Math.round((c / untungBulan) * 100) : null);

  async function unduhExcel() {
    const hari = await fetchHari(geser(hariIni, -SYARAT.windowHari), geser(hariIni, -1));
    await exportExcelPeriode({ namaUsaha: nama, start: geser(hariIni, -SYARAT.windowHari), end: geser(hariIni, -1), hari });
  }

  const warna = k?.level === 'siap' ? '#10b981' : k?.level === 'hampir' ? '#f59e0b' : '#64748b';

  return (
    <div className="wrap" ref={areaRef}>
      <div className="header-app"><h1>Kesiapan <span>Kredit</span></h1><p>Rapor usaha dan simulasi cicilan</p></div>
      <div className="toggle-stats" data-html2canvas-ignore>
        <button className={tab === 'skor' ? 'active' : ''} onClick={() => setTab('skor')}>Rapor Usaha</button>
        <button className={tab === 'simulasi' ? 'active' : ''} onClick={() => setTab('simulasi')}>Simulasi Cicilan</button>
      </div>
      {err && <p className="err">{err}</p>}

      {tab === 'skor' && (!k ? <p className="muted" style={{ textAlign: 'center' }}>Menghitung…</p> : (
        <>
          <Rise>
            <div className={`badge-kur ${k.level}`}>
              <span style={{ fontSize: '1.8rem' }}>{k.level === 'siap' ? '🏅' : k.level === 'hampir' ? '📈' : '🌱'}</span>
              <h3>{k.level === 'siap' ? 'Catatan usaha Anda siap diajukan KUR' : k.level === 'hampir' ? 'Hampir siap diajukan KUR' : 'Mulai bangun rapor usaha'}</h3>
              <p>{k.level === 'siap'
                ? 'Catatan 30 hari terakhir rapi, untung, dan stabil. Ini nilai tambah saat bicara dengan bank. Keputusan akhir tetap ada di bank.'
                : 'Rajin catat tiap hari berjualan. Semakin rapi catatan, semakin kuat bukti usaha Anda di mata bank.'}</p>
            </div>
          </Rise>

          <div className="glass-card">
            <Ring nilai={k.skor.total} warna={warna} />
            {[
              ['Rajin mencatat', k.skor.konsistensi, 30, `${k.hariCatat} hari tercatat dari 30 hari terakhir`],
              ['Hari untung', k.skor.untung, 30, `${k.hariUntung} dari ${k.hariCatat} hari berakhir untung`],
              ['Uang masuk stabil', k.skor.stabil, 25, k.hariCatat > 1 ? `Naik-turun ${Math.round(k.cv * 100)}% dari rata-rata (maks. ${SYARAT.maxCV * 100}%)` : 'Butuh lebih banyak data'],
              ['Arah usaha', k.skor.tren, 15, 'Uang masuk 2 minggu terakhir dibanding 2 minggu sebelumnya'],
            ].map(([l, v, mx, ket]) => (
              <div key={String(l)}>
                <div className="row"><b style={{ fontSize: '.82rem' }}>{l}</b><b className="tnum" style={{ fontSize: '.8rem' }}>{v}/{mx}</b></div>
                <div className="progress"><i style={{ width: `${(Number(v) / Number(mx)) * 100}%`, background: warna }} /></div>
                <div className="muted">{ket}</div>
              </div>
            ))}
          </div>

          {k.kurang.length > 0 && (
            <div className="glass-card">
              <span className="label">Yang masih kurang</span>
              {k.kurang.map((x) => <div key={x} className="cek"><i>⏳</i><span>{x}</span></div>)}
            </div>
          )}

          <div className="glass-card">
            <span className="label">Perkiraan kemampuan mencicil</span>
            <div className="row"><span className="muted">{ISTILAH.labaBersih} 30 hari terakhir</span><b className="tnum">{rupiah(k.totalUntung)}</b></div>
            <div className="row"><span className="muted">Cicilan wajar (maks. {SYARAT.porsiCicilan * 100}% dari untung)</span><b className="tnum">{rupiah(k.mampuCicil)}/bln</b></div>
            <div className="row"><span className="muted">Plafon yang wajar dipertimbangkan*</span><b className="tnum pos">{rupiah(k.plafonIndikatif)}</b></div>
            <p className="muted" style={{ margin: 0 }}>*Hitungan kasar: tenor {SYARAT.tenorHitung} bulan, bunga KUR {KUR_BUNGA}%/tahun. Bank menilai dengan caranya sendiri, jadi anggap ini gambaran, bukan janji.</p>
          </div>

          <div className="glass-card">
            <span className="label">Yang perlu Anda siapkan sendiri</span>
            <div className="cek"><i>{k.usiaCatatanHari >= 180 ? '✅' : '🕒'}</i><span>Usaha berjalan minimal 6 bulan. Catatan di aplikasi ini baru berusia {k.usiaCatatanHari} hari; kalau usaha Anda sudah lama, bank menghitung dari awal Anda berjualan.</span></div>
            <div className="cek"><i>📄</i><span>KTP, KK, dan surat izin usaha (NIB atau IUMK). Tanyakan ke bank apakah NPWP diperlukan untuk plafon Anda.</span></div>
            <div className="cek"><i>🏦</i><span>Tidak sedang memiliki kredit produktif lain dan tidak ada tunggakan.</span></div>
          </div>

          <div data-html2canvas-ignore style={{ display: 'grid', gap: 10 }}>
            <Press className="btn-main" onClick={() => areaRef.current && exportPdf(areaRef.current, `Rapor-Usaha-${hariIni}.pdf`, `${nama} · Rapor Usaha`)}>📄 CETAK RAPOR USAHA (PDF)</Press>
            <Press className="btn-soft" onClick={unduhExcel}>📗 Unduh laporan 30 hari (Excel)</Press>
          </div>
        </>
      ))}

      {tab === 'simulasi' && (
        <>
          <div className="glass-card">
            <span className="label">Kalau BI Rate berubah…</span>
            <p className="muted" style={{ margin: 0 }}>BI Rate sekarang <b>{BI_RATE.toFixed(2).replace('.', ',')}%</b> (keputusan {BI_RATE_TGL}). Geser untuk melihat apa yang terjadi pada cicilan.</p>
            <div className="row"><b>BI Rate skenario</b><b className="tnum">{biBaru.toFixed(2).replace('.', ',')}%</b></div>
            <input type="range" min={3.5} max={9} step={0.25} value={biBaru} onChange={(e) => setBiBaru(Number(e.target.value))} />
            <div className="row"><b>Pinjaman</b><b className="tnum">{rupiah(pokok)}</b></div>
            <input type="range" min={1_000_000} max={100_000_000} step={500_000} value={pokok} onChange={(e) => setPokok(Number(e.target.value))} />
            <select value={tenor} onChange={(e) => setTenor(Number(e.target.value))}>
              {[12, 24, 36, 48].map((t) => <option key={t} value={t}>Tenor {t} bulan</option>)}
            </select>
            <details>
              <summary className="muted" style={{ cursor: 'pointer' }}>Asumsi selisih bank: +{spread.toFixed(1).replace('.', ',')}% di atas BI Rate</summary>
              <input type="range" min={4} max={15} step={0.5} value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
              <p className="muted">Ini asumsi, bukan data bank tertentu. Pembiayaan komersial untuk usaha mikro biasanya jauh di atas BI Rate karena risikonya. Ubah sesuai tawaran bank yang Anda terima.</p>
            </details>
          </div>

          <div className="sim-card">
            <h4>🏛️ KUR (subsidi pemerintah)</h4>
            <div className="big">{rupiah(sim.kur.cicilan)}<small className="muted"> /bulan</small></div>
            <div className="muted">Bunga {sim.kur.bunga}%/tahun, ditetapkan pemerintah. <b>Tidak ikut naik</b> saat BI Rate naik. {porsi(sim.kur.cicilan) !== null && `Menyedot ${porsi(sim.kur.cicilan)}% untung bulanan Anda.`}</div>
          </div>

          <div className="sim-card hl">
            <h4>🕌 Murabahah (syariah, margin terkunci saat akad)</h4>
            <div className="big">{rupiah(sim.murabahah.cicilan)}<small className="muted"> /bulan</small></div>
            <div className="muted">Margin {sim.murabahah.margin.toFixed(2).replace('.', ',')}%/tahun (BI Rate + selisih). Total dibayar {rupiah(sim.murabahah.total)}. Margin dihitung flat, jadi angkanya tampak lebih besar dari bunga efektif yang sama.</div>
            {Math.abs(selisih) >= 1 && <div className={selisih > 0 ? 'delta-naik' : 'delta-turun'}>{selisih > 0 ? '▲' : '▼'} {rupiah(Math.abs(selisih))}/bln dibanding akad hari ini</div>}
            <div className="muted">Kalau akad ditandatangani sekarang, cicilan <b>tetap sama sampai lunas</b> walau BI Rate berubah. Skenario ini berlaku bagi yang mengajukan setelah BI Rate bergerak. {porsi(sim.murabahah.cicilan) !== null && `Menyedot ${porsi(sim.murabahah.cicilan)}% untung bulanan Anda.`}</div>
          </div>

          <div className="sim-card">
            <h4>📉 Kredit bunga mengambang</h4>
            <div className="big">{rupiah(sim.mengambang.awal)}<small className="muted"> /bulan di awal</small></div>
            <div className="muted">Setelah 6 bulan BI Rate jadi {biBaru.toFixed(2).replace('.', ',')}%, cicilan sisa menjadi <b className="tnum">{rupiah(sim.mengambang.setelah)}</b>/bulan{' '}
              {Math.abs(sim.mengambang.setelah - sim.mengambang.awal) >= 1 && <span className={sim.mengambang.setelah > sim.mengambang.awal ? 'delta-naik' : 'delta-turun'}>({sim.mengambang.setelah > sim.mengambang.awal ? '▲' : '▼'} {rupiah(Math.abs(sim.mengambang.setelah - sim.mengambang.awal))})</span>}.
              Pada kredit seperti ini, perubahan suku bunga langsung terasa di dompet.</div>
          </div>

          <div className="glass-card">
            <span className="label">Pelajaran singkat</span>
            <div className="cek"><i>1️⃣</i><span>BI Rate adalah suku bunga acuan. Bank menjadikannya patokan, jadi bunga pinjaman komersial cenderung ikut naik saat BI Rate naik.</span></div>
            <div className="cek"><i>2️⃣</i><span>KUR dipatok pemerintah, jadi lebih tahan terhadap gejolak suku bunga.</span></div>
            <div className="cek"><i>3️⃣</i><span>Murabahah mengunci margin di awal. Yang perlu dicermati adalah kapan Anda tanda tangan akad.</span></div>
            <p className="muted" style={{ margin: 0 }}>Sumber BI Rate: <a href={BI_RATE_SUMBER} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>Bank Indonesia</a>. Simulasi ini untuk belajar, bukan penawaran produk.</p>
          </div>
        </>
      )}
      <BottomNav />
    </div>
  );
}
