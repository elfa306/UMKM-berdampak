'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchHari } from '@/lib/data';
import { rupiah, todayISO, tglPendek } from '@/lib/accounting';
import { bahanStatis, gabungBahan, hargaWajar, pilihBahan, type PetaBahan } from '@/lib/bahan';
import { Press, Rise } from '@/components/Motion';
import BottomNav from '@/components/BottomNav';

type Item = {
  judul: string; harga: number | null; toko: string;
  rating: number | null; ulasan: number | null; link: string | null; gambar: string | null;
};
type Kartu = {
  nama: string; produk: string[];
  median: number | null; termurah: Item | null;
  perubahan: number | null; pembanding: string | null; // % dibanding snapshot terakhir sebelum hari ini
};
type Paket = { kartu: Kartu[]; produk: string[]; tanpaBahan: string[]; sumber: string; punyaRiwayat: boolean; galat?: string };

const MAKS_PRODUK = 12; // produk yang dipantau sekaligus
const PER_PERMINTAAN = 6; // batas produk per panggilan /api/bahan
const MAKS_BAHAN = 10; // batas bahan yang dicek harganya (hemat kuota SerpApi)
const SEGARKAN_MS = 30 * 60 * 1000; // muat ulang penuh jika data lebih tua dari ini saat halaman dibuka kembali

const persenFmt = (n: number) => Math.abs(n).toFixed(1).replace('.', ',') + '%';
const daftarKata = (a: string[]) => (a.length <= 1 ? a[0] ?? '' : a.slice(0, -1).join(', ') + ' dan ' + a[a.length - 1]);

export default function Harga() {
  const router = useRouter();
  const [paket, setPaket] = useState<Paket | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [kosong, setKosong] = useState(false);

  // pencarian manual (opsional)
  const [items, setItems] = useState<Item[]>([]);
  const [urut, setUrut] = useState<'harga' | 'rating' | 'ulasan'>('harga');
  const [minRating, setMinRating] = useState(0);
  const [toko, setToko] = useState('');
  const [mencari, setMencari] = useState(false);

  const tandaRef = useRef('');       // tanda daftar produk pada pemuatan terakhir
  const kapanRef = useRef(0);        // waktu pemuatan terakhir
  const permintaanRef = useRef(0);   // mencegah hasil lama menimpa hasil baru

  // Selalu membaca daftar produk terbaru dari database (tanpa cache di perangkat).
  //  paksa : abaikan cache harga di server dan muat ulang walau daftar produk sama
  //  senyap: pemuatan otomatis (realtime / halaman dibuka kembali) tanpa menutup tampilan lama
  const muat = useCallback(async (paksa = false, senyap = false) => {
    const nomor = ++permintaanRef.current;
    const usang = () => nomor !== permintaanRef.current;
    if (!senyap) { setLoading(true); setErr(''); setKosong(false); }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      const { data: { session } } = await supabase.auth.getSession();
      const auth = { Authorization: `Bearer ${session?.access_token ?? ''}` };
      const hariIni = todayISO();

      // 1) Produk dagangan aktif milik pengguna, langsung dari database
      const { data: prod, error: eProd } = await supabase.from('products').select('nama')
        .eq('user_id', user.id).eq('aktif', true).in('jenis_item', ['merchandise', 'finished_good']).order('created_at');
      if (eProd) throw new Error(eProd.message);
      const semua = (prod ?? []).map((p) => String(p.nama).trim()).filter(Boolean);
      const tanda = semua.join('\u0001');

      // Pemuatan otomatis tidak perlu mengulang pekerjaan berat bila produk tidak berubah dan data masih baru
      if (senyap && !paksa && tanda === tandaRef.current && Date.now() - kapanRef.current < SEGARKAN_MS) return;

      if (!semua.length) {
        if (usang()) return;
        tandaRef.current = tanda; kapanRef.current = Date.now();
        setPaket(null); setKosong(true); setLoading(false); return;
      }

      // 2) Urutkan produk: yang paling sering terjual 30 hari terakhir lebih dulu (gagal membaca penjualan tidak boleh menyembunyikan produk)
      const terjual = new Map<string, number>();
      try {
        const mulai = new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const hari = await fetchHari(mulai, hariIni);
        hari.flatMap((h) => h.txs).filter((t) => t.jenis === 'penjualan')
          .forEach((t) => terjual.set(t.keterangan, (terjual.get(t.keterangan) ?? 0) + t.qty));
      } catch { /* abaikan: pakai urutan pembuatan produk */ }
      const produk = [...new Set(semua)].sort((a, b) => (terjual.get(b) ?? 0) - (terjual.get(a) ?? 0)).slice(0, MAKS_PRODUK);

      // 3) Produk -> bahan baku (Gemini, cadangan: kamus bawaan). Dipecah per 6 produk; produk baru tidak ikut terpotong.
      const kelompok: string[][] = [];
      for (let i = 0; i < produk.length; i += PER_PERMINTAAN) kelompok.push(produk.slice(i, i + PER_PERMINTAAN));
      const hasilPeta = await Promise.all(kelompok.map(async (daftar) => {
        try {
          const rp = await fetch('/api/bahan', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ produk: daftar }) });
          const jp = await rp.json();
          if (!rp.ok) throw new Error(jp.error ?? 'Gagal memetakan bahan');
          return { peta: jp.peta as PetaBahan, sumber: String(jp.sumber) };
        } catch {
          return { peta: daftar.map((p) => ({ produk: p, bahan: bahanStatis(p) })) as PetaBahan, sumber: 'kamus' };
        }
      }));
      const peta = hasilPeta.flatMap((h) => h.peta);
      const sumber = hasilPeta.every((h) => h.sumber === 'gemini') ? 'gemini' : 'kamus';
      const tanpaBahan = produk.filter((p) => !peta.some((x) => x.produk === p && x.bahan.length));
      const gabung = pilihBahan(gabungBahan(peta), produk, MAKS_BAHAN);

      // 4) Harga tiap bahan lewat /api/harga ("Perbarui" melewati cache server)
      const hasil = await Promise.all(gabung.map(async (g) => {
        try {
          const r = await fetch(`/api/harga?q=${encodeURIComponent(g.bahan.kueri)}${paksa ? '&segar=1' : ''}`, { headers: auth, cache: 'no-store' });
          const j = await r.json();
          return r.ok ? (j.items as Item[]) : [];
        } catch { return [] as Item[]; }
      }));

      // 5) Pembanding: harga median terakhir sebelum hari ini
      const namaBahan = gabung.map((g) => g.bahan.nama);
      const { data: lama, error: eLama } = namaBahan.length
        ? await supabase.from('harga_snapshot').select('bahan,tanggal,harga_median').in('bahan', namaBahan).lt('tanggal', hariIni).order('tanggal', { ascending: false })
        : { data: [] as { bahan: string; tanggal: string; harga_median: number | string }[], error: null };
      const punyaRiwayat = !eLama;
      const terakhir = new Map<string, { tanggal: string; harga: number }>();
      (lama ?? []).forEach((r) => { if (!terakhir.has(r.bahan)) terakhir.set(r.bahan, { tanggal: r.tanggal, harga: Number(r.harga_median) }); });

      const kartu: Kartu[] = gabung.map((g, i) => {
        const wajar = hargaWajar(hasil[i].map((x) => x.harga ?? 0));
        const termurah = wajar ? hasil[i].filter((x) => (x.harga ?? 0) >= wajar.min).sort((a, b) => (a.harga ?? 0) - (b.harga ?? 0))[0] ?? null : null;
        const pb = terakhir.get(g.bahan.nama);
        return {
          nama: g.bahan.nama, produk: g.produk, median: wajar?.median ?? null, termurah,
          perubahan: wajar && pb ? ((wajar.median - pb.harga) / pb.harga) * 100 : null,
          pembanding: pb?.tanggal ?? null,
        };
      });

      // 6) Simpan harga hari ini untuk pembanding besok
      const baris = kartu.filter((k) => k.median).map((k) => ({
        user_id: user.id, bahan: k.nama, tanggal: hariIni, harga_median: k.median, harga_termurah: k.termurah?.harga ?? null,
      }));
      if (baris.length && punyaRiwayat) await supabase.from('harga_snapshot').upsert(baris, { onConflict: 'user_id,bahan,tanggal' });

      if (usang()) return; // ada pemuatan yang lebih baru, buang hasil ini
      tandaRef.current = tanda; kapanRef.current = Date.now();
      setErr(''); setKosong(false);
      setPaket({ kartu, produk, tanpaBahan, sumber, punyaRiwayat, galat: eLama?.message });
    } catch (e) {
      if (!usang() && !senyap) setErr((e as Error).message);
    }
    if (!usang()) setLoading(false);
  }, [router]);

  useEffect(() => { muat(); }, [muat]);

  // Realtime: pantau perubahan produk (dari perangkat mana pun) dan saat halaman dibuka kembali
  // (peramban ponsel sering memulihkan halaman lama tanpa menjalankan ulang kode pemuatan).
  useEffect(() => {
    let aktif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let kanal: ReturnType<typeof supabase.channel> | null = null;
    const jadwal = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void muat(false, true); }, 800); };
    const saatTampil = () => { if (document.visibilityState === 'visible') jadwal(); };

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!aktif || !user) return;
      kanal = supabase.channel(`harga-produk-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `user_id=eq.${user.id}` }, jadwal)
        .subscribe();
    });
    document.addEventListener('visibilitychange', saatTampil);
    window.addEventListener('pageshow', jadwal);
    window.addEventListener('online', jadwal);
    return () => {
      aktif = false;
      if (timer) clearTimeout(timer);
      if (kanal) void supabase.removeChannel(kanal);
      document.removeEventListener('visibilitychange', saatTampil);
      window.removeEventListener('pageshow', jadwal);
      window.removeEventListener('online', jadwal);
    };
  }, [muat]);

  // Kalimat saran: bahan dengan perubahan terbesar (minimal 3%)
  const saran = useMemo(() => {
    if (!paket) return null;
    const ada = paket.kartu.filter((k) => k.perubahan !== null && Math.abs(k.perubahan) >= 3)
      .sort((a, b) => Math.abs(b.perubahan!) - Math.abs(a.perubahan!))[0];
    if (!ada) return paket.kartu.some((k) => k.perubahan !== null) ? { naik: null as boolean | null, teks: 'Harga bahan Anda relatif stabil dibanding pantauan terakhir.' } : null;
    const naik = ada.perubahan! > 0;
    const pakai = daftarKata(ada.produk);
    return {
      naik,
      teks: naik
        ? `Harga ${ada.nama} naik ${persenFmt(ada.perubahan!)} dibanding ${tglPendek(ada.pembanding!)}. Bahan ini dipakai untuk ${pakai}. Pertimbangkan menyesuaikan porsi atau harga jual agar margin tetap aman.`
        : `Harga ${ada.nama} turun ${persenFmt(ada.perubahan!)} dibanding ${tglPendek(ada.pembanding!)}. Waktu yang pas untuk menambah stok ${pakai}.`,
    };
  }, [paket]);

  async function cari(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q'));
    setMencari(true); setErr('');
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`/api/harga?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } });
    const j = await r.json();
    setMencari(false);
    if (!r.ok) return setErr(j.error ?? 'Gagal mengambil data');
    setItems(j.items);
  }

  const tampil = useMemo(() => {
    const f = items.filter((i) => (i.rating ?? 0) >= minRating && i.toko.toLowerCase().includes(toko.toLowerCase()));
    return f.sort((a, b) =>
      urut === 'harga' ? (a.harga ?? Infinity) - (b.harga ?? Infinity)
      : urut === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0)
      : (b.ulasan ?? 0) - (a.ulasan ?? 0));
  }, [items, urut, minRating, toko]);

  return (
    <div className="wrap">
      <div className="header-app"><h1>Cek <span>Harga</span></h1><p>Pantauan bahan sesuai dagangan Anda</p></div>

      {loading && (
        <div className="glass-card"><p className="muted" style={{ margin: 0, textAlign: 'center' }}>Membaca dagangan Anda dan mengecek harga bahan…</p></div>
      )}
      {err && <p className="err">{err}</p>}

      {kosong && (
        <div className="glass-card">
          <b>Belum ada produk</b>
          <p className="muted" style={{ margin: 0 }}>Tambahkan produk dagangan di halaman Kasir atau Inventaris, nanti bahan bakunya otomatis dipantau di sini.</p>
          <Link href="/kasir" className="btn-soft" style={{ textAlign: 'center' }}>Ke Kasir</Link>
        </div>
      )}

      {paket && (
        <>
          <Rise>
            <div className="glass-card">
              <p style={{ margin: 0, fontSize: '.9rem', lineHeight: 1.55 }}>
                Karena Anda berjualan <b>{daftarKata(paket.produk)}</b>, berikut pantauan harga bahan pokok Anda hari ini.
              </p>
              {saran && (
                <div className={`badge ${saran.naik === null ? 'flat' : saran.naik ? 'bad' : 'ok'}`} style={{ borderRadius: 14, padding: '10px 12px', lineHeight: 1.5, fontSize: '.78rem' }}>
                  {saran.teks}
                </div>
              )}
              {paket.tanpaBahan.length > 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  Produk terdeteksi, tetapi bahan bakunya belum bisa ditentukan: <b>{daftarKata(paket.tanpaBahan)}</b>. Coba tekan Perbarui, atau cari bahannya lewat “Cari bahan lain”.
                </p>
              )}
              {paket.kartu.length > 0 && !paket.kartu.some((k) => k.perubahan !== null) && (
                <p className="muted" style={{ margin: 0 }}>
                  {paket.punyaRiwayat
                    ? 'Perubahan harga (naik/turun) mulai tampil besok, setelah ada harga hari ini sebagai pembanding.'
                    : `Tabel riwayat harga belum bisa dibaca${paket.galat ? ` (${paket.galat})` : ''}. Pastikan migration_v4.sql sudah dijalankan di proyek Supabase yang sama dengan aplikasi ini.`}
                </p>
              )}
            </div>
          </Rise>

          {paket.kartu.map((k, i) => (
            <Rise key={k.nama} delay={i * 0.05}>
              <div className="glass-card">
                <div className="row">
                  <b>{k.nama}</b>
                  {k.perubahan === null
                    ? <span className="badge flat">Baru dipantau</span>
                    : Math.abs(k.perubahan) < 0.1
                      ? <span className="badge flat">Stabil</span>
                      : <span className={`badge ${k.perubahan > 0 ? 'bad' : 'ok'}`}>{k.perubahan > 0 ? '▲ naik' : '▼ turun'} {persenFmt(k.perubahan)}</span>}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {k.median ? rupiah(k.median) : 'Belum tersedia'}
                </div>
                <div className="muted">Harga umum di toko online · untuk {daftarKata(k.produk)}</div>
                {k.termurah && (
                  <a className="trx" href={k.termurah.link ?? '#'} target="_blank" rel="noreferrer" style={{ borderLeftColor: '#10b981' }}>
                    <div className="grow">
                      <b>Termurah: {k.termurah.toko}</b>
                      <div className="muted">{k.termurah.judul.slice(0, 60)}</div>
                    </div>
                    <div className="amt">{k.termurah.harga ? rupiah(k.termurah.harga) : '-'}</div>
                  </a>
                )}
              </div>
            </Rise>
          ))}

          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ flex: 1 }}>{paket.sumber === 'gemini' ? 'Bahan dipetakan oleh Gemini' : 'Bahan dari daftar bawaan'}</span>
            <Press className="btn-soft" disabled={loading} onClick={() => muat(true)}>🔄 Perbarui</Press>
          </div>
        </>
      )}

      <details className="glass-card">
        <summary style={{ fontWeight: 800, cursor: 'pointer' }}>🔍 Cari bahan lain</summary>
        <form onSubmit={cari} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input name="q" placeholder="Mis. tepung terigu 1 kg, minyak goreng 2 liter" required />
          <button className="btn-main" disabled={mencari}>{mencari ? 'Mencari…' : 'CARI'}</button>
        </form>
        {items.length > 0 && (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <select value={urut} onChange={(e) => setUrut(e.target.value as 'harga' | 'rating' | 'ulasan')}>
              <option value="harga">Termurah</option>
              <option value="rating">Rating tertinggi</option>
              <option value="ulasan">Ulasan terbanyak</option>
            </select>
            <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value={0}>Semua rating</option>
              <option value={4}>Rating ≥ 4</option>
              <option value={4.5}>Rating ≥ 4,5</option>
            </select>
            <input placeholder="Filter toko (mis. tokopedia)" value={toko} onChange={(e) => setToko(e.target.value)} />
            {tampil.map((i, n) => (
              <a key={n} className="trx" href={i.link ?? '#'} target="_blank" rel="noreferrer" style={{ borderLeftColor: '#2563eb' }}>
                <div className="grow">
                  <b>{i.judul}</b>
                  <div className="muted">{i.toko} · ⭐ {i.rating ?? '-'} ({i.ulasan ?? 0} ulasan)</div>
                </div>
                <div className="amt">{i.harga ? rupiah(i.harga) : '-'}</div>
              </a>
            ))}
          </div>
        )}
      </details>
      <BottomNav />
    </div>
  );
}
