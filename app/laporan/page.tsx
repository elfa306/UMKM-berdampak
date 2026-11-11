'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, ChartColumn, ChevronDown, Download, FileSpreadsheet, FileText, History, QrCode, Search, TrendingUp, TrendingDown, Clock, ShieldCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchHari, type Hari } from '@/lib/data';
import { PALET, rupiah, rupiahTanda, summarize, tglPendek, todayISO } from '@/lib/accounting';
import { exportExcel, exportExcelPeriode } from '@/lib/exportExcel';
import { exportPdf } from '@/lib/exportPdf';
import { ISTILAH } from '@/lib/istilah';
import { Press, Rise } from '@/components/Motion';
import TrenChart from '@/components/TrenChart';
import BottomNav from '@/components/BottomNav';
import Donut from '@/components/Donut';
import PeriodFilter, { preset, type Periode } from '@/components/PeriodFilter';

const ROWS = 10;
type Tab = 'ringkasan' | 'transaksi';

// CAVA Color Palette for charts
const CAVA_CHART_COLORS = ['#103A57', '#307B8E', '#A9D3C5', '#366B2B', '#D97706', '#991B1B'];

export default function Laporan() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [periode, setPeriode] = useState<Periode>(() => preset('30'));
  const [hari, setHari] = useState<Hari[]>([]);
  const [jenis, setJenis] = useState<'penjualan' | 'biaya'>('penjualan');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [nama, setNama] = useState('Usaha Saya');
  const [bulanAkuntansi, setBulanAkuntansi] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7)
  );
  const [unduhAkuntansi, setUnduhAkuntansi] = useState(false);
  const [pesanAkuntansi, setPesanAkuntansi] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setNama('[Nama Usaha]');
      setLoading(false);
      const iso = todayISO();
      const sampleHari: Hari[] = [
        {
          id: 'sample-h1',
          tanggal: iso,
          modal: 340000,
          txs: [
            { id: 'sample-t1', jenis: 'penjualan', keterangan: 'Kopi Cava Latte', jumlah: 240000, metode: 'qris', qty: 12, created_at: `${iso}T08:30:00Z` },
            { id: 'sample-t2', jenis: 'penjualan', keterangan: 'Roti Bakar Kaya', jumlah: 170000, metode: 'tunai', qty: 10, created_at: `${iso}T09:15:00Z` },
            { id: 'sample-t3', jenis: 'biaya', keterangan: 'Beli Es Batu & Kantong', jumlah: 65000, metode: 'tunai', qty: 1, created_at: `${iso}T10:00:00Z` },
            { id: 'sample-t4', jenis: 'biaya', keterangan: 'Bahan Baku Susu & Kopi', jumlah: 100000, metode: 'qris', qty: 1, created_at: `${iso}T11:20:00Z` },
          ],
        },
        {
          id: 'sample-h2',
          tanggal: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
          modal: 300000,
          txs: [
            { id: 'sample-t5', jenis: 'penjualan', keterangan: 'Kopi Cava Latte', jumlah: 320000, metode: 'qris', qty: 16, created_at: `${iso}T14:00:00Z` },
            { id: 'sample-t6', jenis: 'biaya', keterangan: 'Listrik & Gas Portabel', jumlah: 90000, metode: 'tunai', qty: 1, created_at: `${iso}T16:00:00Z` },
          ],
        },
      ];
      setHari(sampleHari);
      return;
    }
    setNama(user.user_metadata?.nama_usaha ?? 'Usaha Saya');
    setLoading(true);
    try {
      setHari(await fetchHari(periode.start, periode.end));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
    setLoading(false);
  }, [periode]);

  useEffect(() => {
    load();
    setPage(1);
  }, [load]);

  const ringkas = useMemo(() => hari.map((h) => ({ h, s: summarize(h.modal, h.txs) })), [hari]);

  // Statistics
  const st = useMemo(() => {
    const semua = ringkas.flatMap((r) => r.h.txs);
    const g = new Map<string, { nilai: number; n: number }>();
    semua.filter((t) => t.jenis === jenis).forEach((t) => {
      const x = g.get(t.keterangan) ?? { nilai: 0, n: 0 };
      x.nilai += t.jumlah;
      x.n += t.qty;
      g.set(t.keterangan, x);
    });
    const rows = [...g]
      .map(([label, v], i) => ({ label, ...v, i }))
      .sort((a, b) => b.nilai - a.nilai)
      .map((r, i) => ({ ...r, color: CAVA_CHART_COLORS[i % CAVA_CHART_COLORS.length] }));
    const tunai = ringkas.reduce((a, r) => a + r.s.tunai, 0);
    const qris = ringkas.reduce((a, r) => a + r.s.qris, 0);
    return {
      rows,
      total: rows.reduce((a, r) => a + r.nilai, 0),
      tunai,
      qris,
      untung: ringkas.filter((r) => r.s.labaBersih > 0).length,
      rugi: ringkas.filter((r) => r.s.labaBersih < 0).length,
      tren: [...ringkas].reverse().slice(-90).map((r) => ({
        tanggal: r.h.tanggal,
        uangMasuk: r.s.pendapatan,
        untung: r.s.labaBersih,
      })),
    };
  }, [ringkas, jenis]);

  const pQris = st.tunai + st.qris > 0 ? Math.round((st.qris / (st.tunai + st.qris)) * 100) : 0;
  const totalLaba = ringkas.reduce((a, r) => a + r.s.labaBersih, 0);
  const totalPend = ringkas.reduce((a, r) => a + r.s.pendapatan, 0);

  // Search filtered rows
  const tampil = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return ringkas;
    return ringkas.filter(
      ({ h }) =>
        tglPendek(h.tanggal).toLowerCase().includes(k) ||
        h.txs.some((t) => t.keterangan.toLowerCase().includes(k) || String(t.jumlah).includes(k))
    );
  }, [ringkas, q]);

  const pages = Math.max(1, Math.ceil(tampil.length / ROWS));
  const slice = tampil.slice((page - 1) * ROWS, page * ROWS);

  async function unduhLaporanAkuntansiBulanan() {
    setUnduhAkuntansi(true);
    setPesanAkuntansi('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
      const response = await fetch(`/api/akuntansi/export?month=${encodeURIComponent(bulanAkuntansi)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'Unduhan laporan akuntansi gagal.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `CAVA-Akuntansi-${bulanAkuntansi}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setPesanAkuntansi(`Laporan akuntansi ${bulanAkuntansi} berhasil diunduh.`);
    } catch (error) {
      setPesanAkuntansi(error instanceof Error ? error.message : 'Unduhan laporan akuntansi gagal.');
    } finally {
      setUnduhAkuntansi(false);
    }
  }

  async function hapus(id: string) {
    if (!confirm('Hapus transaksi ini? Saldo, jurnal, dan laporan akan diperbarui.')) return;
    setErr('');
    const target = hari.flatMap((item) => item.txs).find((tx) => tx.id === id);

    if (target?.payment_source === 'qris_simulation') {
      const { error } = await supabase.rpc('cancel_qris_payment_simulation', { p_transaction_id: id });
      if (error) return setErr(`Pembatalan QRIS simulasi gagal: ${error.message}`);
    } else if (target?.product_id && target.payment_source === 'cashier') {
      const { error } = await supabase.rpc('cancel_inventory_sale', { p_transaction_id: id });
      if (error) return setErr(`Pembatalan penjualan stok gagal: ${error.message}`);
    } else {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) return setErr(error.message);
    }
    await load();
  }

  const cetakPdf = () =>
    areaRef.current &&
    exportPdf(
      areaRef.current,
      `CAVA-Laporan-${tab === 'ringkasan' ? 'Ringkasan' : 'Riwayat'}-${periode.start}_sd_${periode.end}.pdf`,
      `${nama} · Laporan CAVA ${periode.start} s.d. ${periode.end}`
    );

  return (
    <div className="wrap" ref={areaRef}>
      {/* Header */}
      <div className="header-app">
        <div>
          <h1>Riwayat &amp; Laporan</h1>
          <p>Pencatatan keuangan</p>
        </div>
      </div>

      {/* Hero Card (Prussian Blue #103A57) */}
      <Rise delay={0.02}>
        <div className="balance-card">
          <small>Untung bersih periode</small>
          <h2 className={`tabular-nums ${totalLaba < 0 ? 'neg' : ''}`}>
            {rupiah(totalLaba)}
          </h2>
          <div className="stat3">
            <div>
              <b className="tabular-nums">{rupiah(totalPend)}</b>
              <span>Pemasukan</span>
            </div>
            <div>
              <b className="tabular-nums">{st.untung} hari</b>
              <span>Hari untung</span>
            </div>
            <div>
              <b className="tabular-nums">{st.rugi} hari</b>
              <span>Hari rugi</span>
            </div>
          </div>
        </div>
      </Rise>

      {/* Filter rentang tanggal */}
      <PeriodFilter value={periode} onChange={setPeriode} />

      {/* Excel Bulanan Card */}
      <section className="glass-card" data-html2canvas-ignore>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="ico-tile !h-10 !w-10 !rounded-xl"><FileSpreadsheet size={18} /></span>
            <div className="min-w-0">
              <b className="text-[13px] font-black text-[#103A57]">Laporan Akuntansi SAK EMKM</b>
              <p className="mt-0.5 text-[11px] font-semibold text-[#4F6B7C]">Format Excel siap diserahkan ke bank</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              aria-label="Pilih bulan"
              type="month"
              value={bulanAkuntansi}
              onChange={(e) => setBulanAkuntansi(e.target.value)}
              className="!w-auto min-w-0 flex-1 !rounded-xl !px-3 !py-2.5 !text-[13px] sm:!w-[170px] sm:flex-none"
            />
            <button
              onClick={unduhLaporanAkuntansiBulanan}
              disabled={unduhAkuntansi || !bulanAkuntansi}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#103A57] px-4 py-3 text-[13px] font-extrabold text-white transition hover:bg-[#174968] active:scale-95 disabled:opacity-50"
            >
              <FileSpreadsheet size={15} />
              {unduhAkuntansi ? 'Menyiapkan…' : 'Unduh'}
            </button>
          </div>
        </div>
        {pesanAkuntansi && <p className="text-xs font-bold text-[#366B2B]">{pesanAkuntansi}</p>}
      </section>

      {err && <div className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-[#991B1B]">{err}</div>}

      {/* Toggle View: Ringkasan vs Transaksi */}
      <div className="toggle-stats" data-html2canvas-ignore>
        <button className={tab === 'ringkasan' ? 'active' : ''} onClick={() => setTab('ringkasan')}>
          <ChartColumn size={16} /> Ringkasan &amp; Tren
        </button>
        <button className={tab === 'transaksi' ? 'active' : ''} onClick={() => setTab('transaksi')}>
          <History size={16} /> Riwayat Mutasi
        </button>
      </div>

      {tab === 'ringkasan' && (
        <>
          <div className="toggle-stats">
            <button className={jenis === 'penjualan' ? 'active' : ''} onClick={() => setJenis('penjualan')}>
              Penjualan
            </button>
            <button className={jenis === 'biaya' ? 'active' : ''} onClick={() => setJenis('biaya')}>
              Biaya & Pengeluaran
            </button>
          </div>

          {/* Donut Chart */}
          <div className="glass-card">
            <Donut
              data={st.rows.map((r) => ({ label: r.label, value: r.nilai, color: r.color }))}
              center={rupiah(st.total)}
            />
            {st.rows.length === 0 && <p className="text-center text-xs font-semibold text-[#4F6B7C] py-4">Belum ada data</p>}
            <div className="divide-y divide-slate-100">
              {st.rows.map((r) => {
                const p = st.total > 0 ? Math.round((r.nilai / st.total) * 100) : 0;
                return (
                  <div key={r.label} className="cat-item">
                    <div className="cat-dot" style={{ background: r.color + '33', color: '#103A57' }}>
                      {p}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center text-xs">
                        <b className="truncate text-[#103A57]">{r.label}</b>
                        <b className="tabular-nums text-[#103A57]">{rupiah(r.nilai)}</b>
                      </div>
                      <div className="text-[11px] font-semibold text-[#4F6B7C]">
                        {r.n}× {jenis === 'penjualan' ? 'terjual' : 'dicatat'}
                      </div>
                      <div className="progress">
                        <i style={{ width: `${p}%`, background: r.color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tunai vs QRIS */}
          <div className="glass-card">
            <span className="label">Pembayaran: Tunai vs QRIS</span>
            <div className="flex justify-between text-xs font-bold text-[#103A57]">
              <span className="inline-flex items-center gap-2"><Banknote size={16} className="text-[#103A57]" /> Tunai</span>
              <span className="tabular-nums">{rupiah(st.tunai)}</span>
            </div>
            <div className="flex justify-between text-xs font-bold text-[#307B8E]">
              <span className="inline-flex items-center gap-2"><QrCode size={16} className="text-[#307B8E]" /> QRIS</span>
              <span className="tabular-nums">{rupiah(st.qris)}</span>
            </div>
            <div className="progress">
              <i style={{ width: `${pQris}%`, background: '#307B8E' }} />
            </div>
            <p className="text-[11px] font-semibold text-slate-500">{pQris}% penerimaan tercatat via QRIS</p>
          </div>

          {/* Tren Grafik */}
          <div className="glass-card">
            <span className="label">Tren Harian Periode</span>
            <TrenChart data={st.tren} tinggi={200} />
          </div>
        </>
      )}

      {tab === 'transaksi' && (
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#307B8E]" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Cari transaksi atau tanggal…"
              className="!rounded-2xl !border-0 !py-3 !pl-10 !pr-4 !text-[13px] shadow-[var(--shadow-card)]"
            />
          </div>

          {/* Transactions list grouped by day */}
          {slice.map(({ h, s }) => {
            const isOpen = open === h.tanggal;
            return (
              <div key={h.tanggal} className="card !p-4">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : h.tanggal)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <h3 className="text-xs font-black text-[#103A57]">{tglPendek(h.tanggal)}</h3>
                    <p className="text-[11px] font-semibold text-[#4F6B7C]">{h.txs.length} transaksi</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-black tabular-nums ${s.labaBersih >= 0 ? 'text-[#366B2B]' : 'text-[#991B1B]'}`}>
                      {rupiahTanda(s.labaBersih, s.labaBersih >= 0)}
                    </span>
                    <ChevronDown size={16} className={`text-[#307B8E] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 border-t border-[#E6F0EB] pt-2">
                    {h.txs.map((t) => {
                      const isSale = t.jenis === 'penjualan';
                      return (
                        <div key={t.id} className="flex items-center justify-between gap-3 border-b border-[#E6F0EB] py-2.5 text-xs last:border-0">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-[#103A57]">{t.keterangan}</p>
                            <span className="text-[10px] font-semibold text-[#4F6B7C]">
                              {t.metode ? t.metode.toUpperCase() : 'Tunai'} · {t.qty}x
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={`font-black tabular-nums ${isSale ? 'text-[#366B2B]' : 'text-[#991B1B]'}`}>
                              {rupiahTanda(t.jumlah, isSale)}
                            </span>
                            <button
                              type="button"
                              onClick={() => hapus(t.id)}
                              className="grid h-8 w-8 place-items-center rounded-full text-[#4F6B7C]/60 transition hover:bg-red-50 hover:text-[#991B1B]"
                              aria-label="Hapus transaksi"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {slice.length === 0 && (
            <div className="card py-10 text-center text-xs font-semibold text-[#4F6B7C]">
              Tidak ada catatan transaksi pada filter ini.
            </div>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex justify-center items-center gap-3 pt-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#103A57] shadow-[var(--shadow-card)] disabled:opacity-40"
              >
                ← Sebelumnya
              </button>
              <span className="text-xs font-bold text-[#307B8E]">
                {page} / {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#103A57] shadow-[var(--shadow-card)] disabled:opacity-40"
              >
                Selanjutnya →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Export PDF Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={cetakPdf}
          className="btn-soft flex items-center justify-center gap-2"
        >
          <FileText size={16} /> Unduh Laporan PDF
        </button>
      </div>

      <BottomNav />
    </div>
  );
}
