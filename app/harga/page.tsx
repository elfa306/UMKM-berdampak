'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/accounting';
import BottomNav from '@/components/BottomNav';

type Item = {
  judul: string; harga: number | null; toko: string;
  rating: number | null; ulasan: number | null; link: string | null; gambar: string | null;
};

export default function Harga() {
  const [items, setItems] = useState<Item[]>([]);
  const [urut, setUrut] = useState<'harga' | 'rating' | 'ulasan'>('harga');
  const [minRating, setMinRating] = useState(0);
  const [toko, setToko] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function cari(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q'));
    setLoading(true); setErr('');
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`/api/harga?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    });
    const j = await r.json();
    setLoading(false);
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
      <div className="header-app"><h1>Harga <span>Bahan Baku</span></h1><p>Bandingkan harga e-commerce</p></div>
      <form className="glass-card" onSubmit={cari}>
        <input name="q" placeholder="Mis. tepung terigu 1 kg, minyak goreng 2 liter" required />
        <button className="btn-main" disabled={loading}>{loading ? 'Mencari…' : 'CARI'}</button>
      </form>

      {items.length > 0 && (
        <div className="glass-card">
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
        </div>
      )}
      {err && <p className="err">{err}</p>}

      {tampil.map((i, n) => (
        <a key={n} className="trx" href={i.link ?? '#'} target="_blank" rel="noreferrer" style={{ borderLeftColor: '#2563eb' }}>
          <div className="grow">
            <b>{i.judul}</b>
            <div className="muted">{i.toko} · ⭐ {i.rating ?? '-'} ({i.ulasan ?? 0} ulasan)</div>
          </div>
          <div className="amt">{i.harga ? rupiah(i.harga) : '-'}</div>
        </a>
      ))}
      <BottomNav />
    </div>
  );
}
