'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Sparkles, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase';
import { fetchHari } from '@/lib/data';
import { todayISO } from '@/lib/accounting';
import { BI_RATE } from '@/lib/config';
import { buatProfilRekomendasi, type ProfilRekomendasi } from '@/lib/rekomendasiProfile';

/* =====================================================================
 * 1. DATA SIMULASI LEMBAGA & LOGIKA (otaknya)
 * ===================================================================== */

// Basis suku bunga (makro), mengikuti konfigurasi aplikasi.
const currentBiRate = BI_RATE;

// Bunga <= batas ini diwarnai hijau (murah), di atasnya merah (mahal).
const BATAS_BUNGA_MURAH = 8;
// Cicilan dianggap aman bila tidak lebih dari 30% untung bulanan.
const BATAS_RASIO_CICILAN = 0.3;

type Risiko = 'rendah' | 'sedang' | 'tinggi';

type Bank = {
  id: string;
  nama: string;
  jenis: string;
  plafonMin: number;
  plafonMax: number;
  tenorBulan: number;
  hitungBunga: (biRate: number) => number; // % per tahun
  basisBunga: string; // teks singkat cara hitung bunga
  minUsiaBulan: number;
  minOmzetHarian: number;
  prosesHari: number;
  agunan: boolean;
  risiko: Risiko;
};

type Profil = ProfilRekomendasi;

const mockBanks: Bank[] = [
  {
    id: 'kur-bri', nama: 'KUR BRI', jenis: 'Bank · Subsidi pemerintah',
    plafonMin: 1_000_000, plafonMax: 100_000_000, tenorBulan: 36,
    hitungBunga: () => 6, basisBunga: 'Tetap 6%',
    minUsiaBulan: 6, minOmzetHarian: 100_000, prosesHari: 7, agunan: false, risiko: 'rendah',
  },
  {
    id: 'bprs-amanah', nama: 'BPRS Amanah', jenis: 'BPR Syariah',
    plafonMin: 2_000_000, plafonMax: 50_000_000, tenorBulan: 24,
    hitungBunga: (bi) => bi + 2, basisBunga: 'BI Rate + 2%',
    minUsiaBulan: 3, minOmzetHarian: 150_000, prosesHari: 5, agunan: false, risiko: 'rendah',
  },
  {
    id: 'bpr-sejahtera', nama: 'BPR Sejahtera', jenis: 'Bank perkreditan rakyat',
    plafonMin: 5_000_000, plafonMax: 75_000_000, tenorBulan: 24,
    hitungBunga: (bi) => bi + 3.5, basisBunga: 'BI Rate + 3,5%',
    minUsiaBulan: 12, minOmzetHarian: 500_000, prosesHari: 10, agunan: true, risiko: 'sedang',
  },
  {
    id: 'kop-makmur', nama: 'Koperasi Makmur', jenis: 'Koperasi simpan pinjam',
    plafonMin: 1_000_000, plafonMax: 25_000_000, tenorBulan: 18,
    hitungBunga: (bi) => bi + 4, basisBunga: 'BI Rate + 4%',
    minUsiaBulan: 3, minOmzetHarian: 100_000, prosesHari: 3, agunan: false, risiko: 'sedang',
  },
  {
    id: 'pinjol-kilat', nama: 'Pinjol Kilat', jenis: 'Fintech pinjaman online',
    plafonMin: 500_000, plafonMax: 20_000_000, tenorBulan: 6,
    hitungBunga: (bi) => bi + 10, basisBunga: 'BI Rate + 10%',
    minUsiaBulan: 0, minOmzetHarian: 0, prosesHari: 1, agunan: false, risiko: 'tinggi',
  },
];

/* ---------- format angka ---------- */
const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const persen = (n: number, d = 2) => n.toFixed(d).replace('.', ',') + '%';
const ringkas = (n: number) =>
  n >= 1_000_000 ? `Rp ${+(n / 1_000_000).toFixed(1)} jt`.replace('.', ',')
  : n >= 1_000 ? `Rp ${Math.round(n / 1_000)} rb`
  : `Rp ${n}`;

/* ---------- skor kesehatan finansial ---------- */
type Skor = { total: number; grade: 'A' | 'B' | 'C' | 'D'; komponen: { label: string; nilai: number; maks: number }[] };

function hitungSkorKesehatan(p: Profil): Skor {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const komponen = [
    { label: 'Margin untung', maks: 30, nilai: clamp(p.marginUntung / 0.3) * 30 },
    { label: 'Rajin mencatat', maks: 25, nilai: clamp(p.hariDicatat30 / 30) * 25 },
    { label: 'Omzet stabil', maks: 25, nilai: clamp(1 - p.fluktuasiOmzet / 0.5) * 25 },
    { label: 'Usia usaha', maks: 20, nilai: clamp(p.usiaUsahaBulan / 12) * 20 },
  ].map((k) => ({ ...k, nilai: Math.round(k.nilai) }));
  const total = komponen.reduce((a, k) => a + k.nilai, 0);
  const grade = total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D';
  return { total, grade, komponen };
}

/* ---------- rekomendasi (rule-based) ---------- */
const anuitas = (pokok: number, bungaTahun: number, bulan: number) => {
  const r = bungaTahun / 100 / 12;
  return r === 0 ? pokok / bulan : (pokok * r) / (1 - Math.pow(1 + r, -bulan));
};

type Rekomendasi = {
  bank: Bank;
  bunga: number;
  pinjaman: number;
  cicilanBulan: number;
  cicilanHari: number;
  rasio: number; // cicilan / untung bulanan
  layak: boolean;
  alasan: string[]; // alasan bila tidak layak
  skor: number; // 0-100, makin tinggi makin cocok
};

const RISIKO_PENALTI: Record<Risiko, number> = { rendah: 0, sedang: 5, tinggi: 20 };

function calculateRecommendation(p: Profil, banks: Bank[], biRate: number): Rekomendasi[] {
  const untungBulan = p.omzetHarian * p.marginUntung * p.hariBukaPerBulan;

  return banks
    .map((bank) => {
      const bunga = bank.hitungBunga(biRate);
      const pinjaman = Math.min(p.kebutuhanModal, bank.plafonMax);
      const cicilanBulan = anuitas(pinjaman, bunga, bank.tenorBulan);
      const rasio = untungBulan > 0 ? cicilanBulan / untungBulan : 1;

      // Aturan wajib: gagal satu saja = tidak disarankan
      const alasan: string[] = [];
      if (p.usiaUsahaBulan < bank.minUsiaBulan) alasan.push(`Usaha minimal ${bank.minUsiaBulan} bulan`);
      if (p.omzetHarian < bank.minOmzetHarian) alasan.push(`Omzet harian minimal ${rupiah(bank.minOmzetHarian)}`);
      if (p.kebutuhanModal < bank.plafonMin) alasan.push(`Plafon minimal ${rupiah(bank.plafonMin)}`);
      if (rasio > BATAS_RASIO_CICILAN) alasan.push(`Cicilan ${Math.round(rasio * 100)}% dari untung (batas aman ${BATAS_RASIO_CICILAN * 100}%)`);

      // Skor kecocokan: mulai 100, dikurangi mahalnya bunga, risiko, dan agunan
      const skor = Math.max(0, Math.round(
        100
        - (bunga - 6) * 4
        - RISIKO_PENALTI[bank.risiko]
        - (bank.agunan ? 5 : 0)
        + (bank.prosesHari <= 2 ? 5 : 0),
      ));

      return { bank, bunga, pinjaman, cicilanBulan, cicilanHari: cicilanBulan / 30, rasio, layak: alasan.length === 0, alasan, skor };
    })
    .sort((a, b) => Number(b.layak) - Number(a.layak) || b.skor - a.skor || a.bunga - b.bunga);
}

/* ---------- teks "AI" (mockup, nanti ganti panggilan LLM) ---------- */
function buatPenjelasan(r: Rekomendasi, p: Profil, urutan: number): string {
  if (!r.layak) {
    return `Untuk saat ini ${r.bank.nama} kurang cocok: ${r.alasan.join('; ').toLowerCase()}. Pilihan lain di atas lebih sesuai dengan kemampuan usaha Anda.`;
  }
  const awal = urutan === 0 ? 'Ini pilihan paling cocok. ' : '';
  const agunan = r.bank.agunan ? 'Siapkan agunan karena bank ini memintanya.' : 'Tanpa agunan, jadi lebih ringan di awal.';
  const risiko = r.bank.risiko === 'tinggi' ? ' Hati-hati: bunganya jauh di atas pilihan lain, sebaiknya jadi opsi terakhir.' : '';
  return `${awal}Karena omzet Anda stabil di ${ringkas(p.omzetHarian)}/hari, cicilan sekitar ${rupiah(r.cicilanHari)}/hari dari ${r.bank.nama} ini ${r.rasio <= 0.2 ? 'sangat aman' : 'masih aman'} untuk cashflow Anda (${Math.round(r.rasio * 100)}% dari untung bulanan). ${agunan}${risiko}`;
}

/* =====================================================================
 * 2. KOMPONEN UI
 * ===================================================================== */

const warnaBunga = (b: number) => (b <= BATAS_BUNGA_MURAH ? 'text-emerald-600' : 'text-red-600');

/* ---------- Angka naik dari 0 ---------- */
function CountUp({ ke }: { ke: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? ke : 0);
  useEffect(() => {
    if (reduce) { setN(ke); return; }
    const kontrol = animate(0, ke, { duration: 1.1, ease: 'easeOut', onUpdate: (v) => setN(Math.round(v)) });
    return () => kontrol.stop();
  }, [ke, reduce]);
  return <>{n}</>;
}

/* ---------- Papan skor UMKM ---------- */
function PapanSkor({ profil }: { profil: Profil }) {
  const skor = useMemo(() => hitungSkorKesehatan(profil), [profil]);
  const untungBulan = profil.omzetHarian * profil.marginUntung * profil.hariBukaPerBulan;
  const warna = skor.grade === 'A' ? 'text-emerald-600' : skor.grade === 'B' ? 'text-amber-500' : 'text-red-600';
  const warnaBar = skor.grade === 'A' ? 'bg-emerald-500' : skor.grade === 'B' ? 'bg-amber-400' : 'bg-red-500';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Skor Kesehatan Finansial</p>

      <div className="mt-2 flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-5xl font-extrabold tabular-nums ${warna}`}><CountUp ke={skor.total} /></span>
          <span className="text-sm font-semibold text-slate-400">/100</span>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-slate-500">Grade</p>
          <motion.p
            initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.5 }}
            className={`text-4xl font-extrabold leading-none ${warna}`}
          >
            {skor.grade}
          </motion.p>
        </div>
      </div>

      <div className="mt-4 grid gap-2.5">
        {skor.komponen.map((k, i) => (
          <div key={k.label}>
            <div className="flex justify-between text-xs font-semibold text-slate-600">
              <span>{k.label}</span>
              <span className="tabular-nums">{k.nilai}/{k.maks}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                className={`h-full rounded-full ${warnaBar}`}
                initial={{ width: 0 }} animate={{ width: `${(k.nilai / k.maks) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.15 * i, ease: 'easeOut' }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Omzet/hari', ringkas(profil.omzetHarian)],
          ['Untung/bulan', ringkas(untungBulan)],
          ['Butuh modal', ringkas(profil.kebutuhanModal)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-slate-50 py-2">
            <p className="text-[11px] font-semibold text-slate-500">{l}</p>
            <p className="text-sm font-bold tabular-nums text-slate-900">{v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Teks mengetik ala AI ---------- */
function Typewriter({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) { setN(text.length); return; }
    setN(0);
    const t = setInterval(() => setN((v) => (v >= text.length ? v : v + 2)), 18);
    return () => clearInterval(t);
  }, [text, reduce]);
  return (
    <p className="text-sm leading-relaxed text-slate-700">
      {text.slice(0, n)}
      {n < text.length && <span className="animate-pulse">▍</span>}
    </p>
  );
}

/* ---------- Kartu bank (accordion) ---------- */
function KartuBank({ r, urutan, terbuka, onToggle, profil }: {
  r: Rekomendasi; urutan: number; terbuka: boolean; onToggle: () => void; profil: Profil;
}) {
  const { bank } = r;
  const Ikon = r.bunga <= BATAS_BUNGA_MURAH ? TrendingDown : TrendingUp;
  const penjelasan = useMemo(() => buatPenjelasan(r, profil, urutan), [r, profil, urutan]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: urutan * 0.07, type: 'spring', stiffness: 260, damping: 26 }}
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${terbuka ? 'border-slate-400' : 'border-slate-200'} ${r.layak ? '' : 'opacity-75'}`}
    >
      <button
        type="button" onClick={onToggle} aria-expanded={terbuka}
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-4 text-left font-[inherit] text-inherit"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="m-0 text-base font-bold text-slate-900">{bank.nama}</h3>
            {r.layak && urutan === 0 && (
              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Paling Cocok</span>
            )}
            {!r.layak && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Kurang cocok</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Plafon maks <span className="font-semibold tabular-nums text-slate-700">{ringkas(bank.plafonMax)}</span>
          </p>
        </div>

        <div className="text-right">
          <div className={`flex items-center justify-end gap-1 text-lg font-extrabold tabular-nums ${warnaBunga(r.bunga)}`}>
            <Ikon size={16} />
            {persen(r.bunga)}
          </div>
          <p className="text-[11px] text-slate-400">{bank.basisBunga}</p>
        </div>

        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform duration-200 ${terbuka ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {terbuka && (
          <motion.div
            key="isi"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 border-t border-slate-100 p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  [`Pinjaman`, ringkas(r.pinjaman)],
                  ['Cicilan/bulan', rupiah(r.cicilanBulan)],
                  ['Cicilan/hari', rupiah(r.cicilanHari)],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-slate-50 px-1 py-2">
                    <p className="text-[11px] font-semibold text-slate-500">{l}</p>
                    <p className="text-[13px] font-bold tabular-nums text-slate-900">{v}</p>
                  </div>
                ))}
              </div>

              <p className="m-0 text-xs text-slate-500">
                Tenor {bank.tenorBulan} bulan · cair ±{bank.prosesHari} hari · {bank.agunan ? 'pakai agunan' : 'tanpa agunan'}
              </p>

              <div className="rounded-xl bg-slate-900 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  {r.layak ? <Sparkles size={14} /> : <TriangleAlert size={14} />}
                  Penjelasan AI
                </div>
                <div className="[&_p]:text-slate-200">
                  <Typewriter text={penjelasan} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

/* ---------- Halaman ---------- */
function rentang30HariSampaiKemarin() {
  // Gunakan tanggal kalender WIB; hari ini belum dihitung karena belum selesai.
  const akhir = new Date(`${todayISO()}T00:00:00Z`);
  akhir.setUTCDate(akhir.getUTCDate() - 1);
  const awal = new Date(akhir);
  awal.setUTCDate(awal.getUTCDate() - 29);
  return { start: awal.toISOString().slice(0, 10), end: akhir.toISOString().slice(0, 10) };
}

export default function RekomendasiModalPage() {
  const router = useRouter();
  const [profil, setProfil] = useState<Profil | null>(null);
  const [loading, setLoading] = useState(true);
  const [menyimpan, setMenyimpan] = useState(false);
  const [error, setError] = useState('');
  const [editProfil, setEditProfil] = useState(false);
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [form, setForm] = useState({
    nama_usaha: '',
    tanggal_mulai_usaha: '',
    hari_buka_per_bulan: '26',
    kebutuhan_modal: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) { router.replace('/login'); return; }

      const [hasilProfil, hari] = await Promise.all([
        supabase.from('business_profiles')
          .select('nama_usaha,tanggal_mulai_usaha,hari_buka_per_bulan,kebutuhan_modal')
          .eq('user_id', user.id)
          .maybeSingle(),
        (() => {
          const periode = rentang30HariSampaiKemarin();
          return fetchHari(periode.start, periode.end);
        })(),
      ]);

      if (hasilProfil.error) throw hasilProfil.error;
      const dataProfil = hasilProfil.data;
      if (!dataProfil) {
        setProfil(null);
        setForm((f) => ({
          ...f,
          nama_usaha: user.user_metadata?.nama_usaha ?? f.nama_usaha,
        }));
      } else {
        const profilBaru = buatProfilRekomendasi(dataProfil, hari, user.user_metadata?.nama_usaha ?? 'Usaha Saya');
        setProfil(profilBaru);
        setForm({
          nama_usaha: dataProfil.nama_usaha,
          tanggal_mulai_usaha: dataProfil.tanggal_mulai_usaha,
          hari_buka_per_bulan: String(dataProfil.hari_buka_per_bulan),
          kebutuhan_modal: String(dataProfil.kebutuhan_modal),
        });
      }
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat data usaha.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const hasil = useMemo(
    () => profil ? calculateRecommendation(profil, mockBanks, currentBiRate) : [],
    [profil],
  );

  useEffect(() => {
    setTerbuka(hasil[0]?.bank.id ?? null);
  }, [hasil]);

  async function simpanProfil(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setMenyimpan(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) { router.replace('/login'); return; }

      const payload = {
        user_id: user.id,
        nama_usaha: form.nama_usaha.trim(),
        tanggal_mulai_usaha: form.tanggal_mulai_usaha,
        hari_buka_per_bulan: Number(form.hari_buka_per_bulan),
        kebutuhan_modal: Number(form.kebutuhan_modal),
        updated_at: new Date().toISOString(),
      };
      if (!payload.nama_usaha || !payload.tanggal_mulai_usaha ||
          !Number.isInteger(payload.hari_buka_per_bulan) || payload.hari_buka_per_bulan < 1 || payload.hari_buka_per_bulan > 31 ||
          !Number.isFinite(payload.kebutuhan_modal) || !Number.isInteger(payload.kebutuhan_modal) || payload.kebutuhan_modal <= 0) {
        throw new Error('Lengkapi nama usaha, tanggal mulai, hari buka, dan kebutuhan modal dengan benar.');
      }

      const { error: simpanError } = await supabase
        .from('business_profiles')
        .upsert(payload, { onConflict: 'user_id' });
      if (simpanError) throw simpanError;

      // Samakan nama usaha di metadata agar halaman lama (Kasir/Statistik) tetap memakai nama yang sama.
      await supabase.auth.updateUser({ data: { nama_usaha: payload.nama_usaha } });
      setEditProfil(false);
      await load();
    } catch (e) {
      setError((e as Error).message || 'Gagal menyimpan profil usaha.');
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto grid max-w-[480px] gap-4 px-4 pb-28 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="m-0 text-xl font-extrabold tracking-tight text-slate-900">Rekomendasi Modal</h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {profil ? `${profil.nama} · butuh ${ringkas(profil.kebutuhanModal)}` : 'Gunakan catatan usaha dari akun Anda'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-right">
            <p className="text-[10px] font-semibold uppercase text-slate-400">BI Rate</p>
            <p className="text-sm font-bold tabular-nums text-white">{persen(currentBiRate)}</p>
          </div>
        </header>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-center text-sm text-slate-500">Memuat data usaha dari Supabase…</p>}

        {!loading && (!profil || editProfil) && (
          <form onSubmit={simpanProfil} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="m-0 text-sm font-extrabold text-slate-900">Profil usaha</h2>
              <p className="mt-1 text-xs text-slate-500">Data ini tersimpan khusus untuk akun yang sedang login.</p>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Nama usaha
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" required value={form.nama_usaha}
                onChange={(e) => setForm((f) => ({ ...f, nama_usaha: e.target.value }))} placeholder="Contoh: Warung Makan Berkah" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Mulai menjalankan usaha
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="date" required max={todayISO()} value={form.tanggal_mulai_usaha}
                onChange={(e) => setForm((f) => ({ ...f, tanggal_mulai_usaha: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Rata-rata hari buka per bulan
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="number" min="1" max="31" required value={form.hari_buka_per_bulan}
                onChange={(e) => setForm((f) => ({ ...f, hari_buka_per_bulan: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Kebutuhan modal yang diajukan (Rp)
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="number" min="1" step="1" required value={form.kebutuhan_modal}
                onChange={(e) => setForm((f) => ({ ...f, kebutuhan_modal: e.target.value }))} placeholder="Contoh: 10000000" />
            </label>
            <button className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={menyimpan}>
              {menyimpan ? 'Menyimpan…' : 'Simpan profil usaha'}
            </button>
            {profil && <button type="button" className="text-sm font-semibold text-slate-500" onClick={() => setEditProfil(false)}>Batal</button>}
          </form>
        )}

        {!loading && profil && !editProfil && (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <p className="m-0 text-xs text-slate-600">Profil usaha tersimpan. Analisis memakai catatan kasir 30 hari terakhir.</p>
            <button type="button" className="shrink-0 text-xs font-bold text-slate-900 underline" onClick={() => setEditProfil(true)}>Ubah</button>
          </div>
        )}

        {!loading && profil && profil.hariDicatat30 === 0 && !editProfil && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Belum ada catatan kasir dalam 30 hari terakhir. Mulai catat modal harian, penjualan, dan biaya di halaman Kasir agar rekomendasi dapat dihitung dari data usaha Anda.
          </section>
        )}

        {!loading && profil && profil.hariDicatat30 > 0 && !editProfil && (
          <>
            <PapanSkor profil={profil} />
            <section className="grid gap-3">
              <div>
                <h2 className="m-0 text-sm font-extrabold text-slate-900">Pilihan untuk Anda</h2>
                <p className="mt-0.5 text-xs text-slate-500">Diurutkan berdasarkan kecocokan dengan catatan usaha akun ini.</p>
              </div>
              {hasil.map((r, i) => (
                <KartuBank
                  key={r.bank.id} r={r} urutan={i} profil={profil}
                  terbuka={terbuka === r.bank.id}
                  onToggle={() => setTerbuka((t) => (t === r.bank.id ? null : r.bank.id))}
                />
              ))}
            </section>
          </>
        )}

        <p className="m-0 text-center text-[11px] text-slate-400">
          Profil dan perhitungan omzet berasal dari akun Anda. Daftar lembaga, bunga, dan plafon di halaman ini masih data simulasi, bukan penawaran resmi. Verifikasi langsung ke lembaga keuangan sebelum mengambil keputusan.
        </p>
      </div>

      <BottomNav />
    </main>
  );
}
