'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Baris = { key: number; nama: string; satuan: string; harga: string; jumlah: string; tersimpan: boolean };

const barisBaru = (key: number): Baris => ({ key, nama: '', satuan: 'pcs', harga: '', jumlah: '', tersimpan: false });
const kosong = (b: Baris) => !b.nama.trim() && !b.harga && !b.jumlah;
const digit = (v: string) => v.replace(/\D/g, '');
const input = 'rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-500';

const PESAN_RPC: Record<string, string> = {
  invalid_product_name: 'Nama produk harus 2 sampai 100 karakter.',
  sale_price_required: 'Harga jual harus lebih dari 0.',
  invalid_product_amount: 'Harga atau jumlah tidak valid.',
  product_amount_too_large: 'Harga atau jumlah terlalu besar.',
};

/** Langkah terakhir onboarding: produk dan jumlah stok awal, langsung setelah profil usaha dan metode pembayaran dipilih. */
export default function OnboardingInventory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [punyaStok, setPunyaStok] = useState(true);
  const [jenisItem, setJenisItem] = useState<'merchandise' | 'finished_good' | 'service'>('merchandise');
  const [baris, setBaris] = useState<Baris[]>([barisBaru(1)]);
  const [urut, setUrut] = useState(2);

  useEffect(() => {
    let batal = false;
    (async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (batal) return;
      if (authError || !user) { router.replace('/login'); return; }

      const { data: profil, error: eProfil } = await supabase.from('business_profiles')
        .select('jenis_usaha,memiliki_persediaan,onboarding_completed_at').eq('user_id', user.id).maybeSingle();
      if (batal) return;
      if (eProfil) { setError(eProfil.message); setLoading(false); return; }
      if (!profil?.onboarding_completed_at) { router.replace('/onboarding'); return; }

      const { count } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('aktif', true);
      if (batal) return;
      if ((count ?? 0) > 0) { router.replace('/kasir'); return; }

      const stok = profil.memiliki_persediaan !== false;
      setPunyaStok(stok);
      setJenisItem(!stok ? 'service' : profil.jenis_usaha === 'manufaktur' ? 'finished_good' : 'merchandise');
      setLoading(false);
    })().catch((e) => { if (!batal) { setError((e as Error).message || 'Gagal memuat halaman.'); setLoading(false); } });
    return () => { batal = true; };
  }, [router]);

  function ubah(key: number, patch: Partial<Baris>) {
    setBaris((old) => old.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function validasi(b: Baris, no: number): string | null {
    if (b.nama.trim().length < 2) return `Produk #${no}: nama minimal 2 karakter.`;
    const harga = Number(b.harga);
    if (!Number.isSafeInteger(harga) || harga <= 0) return `Produk #${no}: harga jual harus lebih dari 0.`;
    if (punyaStok) {
      const jumlah = Number(b.jumlah);
      if (!b.jumlah || !Number.isFinite(jumlah) || jumlah <= 0) return `Produk #${no}: isi jumlah stok lebih dari 0.`;
      if (jumlah > 100000000) return `Produk #${no}: jumlah stok terlalu besar.`;
    }
    return null;
  }

  async function simpan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setError('');

    const isi = baris.map((b, i) => ({ b, no: i + 1 })).filter(({ b }) => b.tersimpan || !kosong(b));
    if (!isi.length) { setError('Isi minimal satu produk.'); return; }
    for (const { b, no } of isi) {
      if (b.tersimpan) continue;
      const pesan = validasi(b, no);
      if (pesan) { setError(pesan); return; }
    }

    setSaving(true);
    try {
      for (const { b, no } of isi) {
        if (b.tersimpan) continue;
        const { error: rpcError } = await supabase.rpc('create_inventory_product', {
          p_sku: null,
          p_name: b.nama.trim(),
          p_category: 'Umum',
          p_item_type: jenisItem,
          p_unit: b.satuan.trim() || 'pcs',
          p_sale_price: Number(b.harga),
          p_unit_cost: 0,
          p_stock: punyaStok ? Number(b.jumlah) : 0,
          p_min_stock: 0,
          p_track_stock: punyaStok,
        });
        if (rpcError) {
          const kode = Object.keys(PESAN_RPC).find((k) => rpcError.message.includes(k));
          throw new Error(`Produk #${no} (${b.nama.trim()}): ${kode ? PESAN_RPC[kode] : rpcError.message}`);
        }
        ubah(b.key, { tersimpan: true }); // produk yang sudah masuk tidak disimpan dua kali bila ada yang gagal
      }
      router.replace('/kasir');
    } catch (err) {
      setError((err as Error).message || 'Produk gagal disimpan.');
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-xl text-center text-sm text-slate-500">{error || 'Menyiapkan inventaris…'}</div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 pb-12">
      <div className="mx-auto grid max-w-2xl gap-5">
        <header>
          <p className="m-0 text-xs font-bold uppercase tracking-[.16em] text-emerald-700">UMKM BERDAMPAK</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Isi inventaris awal</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            {punyaStok
              ? 'Masukkan produk yang Anda jual beserta jumlah stok saat ini. Produk ini langsung muncul di Kasir, dan stoknya berkurang otomatis setiap ada penjualan.'
              : 'Masukkan layanan atau produk yang Anda jual beserta harganya. Semuanya langsung muncul di Kasir.'}
          </p>
        </header>

        <form onSubmit={simpan} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {baris.map((b, i) => (
            <fieldset key={b.key} disabled={b.tersimpan || saving} className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <legend className="flex items-center gap-2 px-1 text-xs font-bold text-slate-600">
                Produk #{i + 1}{b.tersimpan && <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={13} /> tersimpan</span>}
              </legend>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Nama produk
                <input value={b.nama} onChange={(e) => ubah(b.key, { nama: e.target.value })} maxLength={100} placeholder="Contoh: Bakwan" className={input} />
              </label>
              <div className={`grid gap-3 ${punyaStok ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Harga jual (Rp)
                  <input value={b.harga} onChange={(e) => ubah(b.key, { harga: digit(e.target.value) })} inputMode="numeric" placeholder="Contoh: 2000" className={input} />
                </label>
                {punyaStok && (
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Jumlah stok
                    <input value={b.jumlah} onChange={(e) => ubah(b.key, { jumlah: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="Contoh: 50" className={input} />
                  </label>
                )}
              </div>
              {punyaStok && (
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Satuan
                  <input value={b.satuan} onChange={(e) => ubah(b.key, { satuan: e.target.value })} maxLength={20} placeholder="pcs, porsi, bungkus, kg" className={input} />
                </label>
              )}
              {!b.tersimpan && baris.length > 1 && (
                <button type="button" onClick={() => setBaris((old) => old.filter((x) => x.key !== b.key))} className="inline-flex items-center gap-1 justify-self-start text-xs font-bold text-red-700">
                  <Trash2 size={13} /> Hapus baris ini
                </button>
              )}
            </fieldset>
          ))}

          <button type="button" disabled={saving || baris.length >= 20} onClick={() => { setBaris((old) => [...old, barisBaru(urut)]); setUrut((n) => n + 1); }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-300 px-4 py-3 text-sm font-bold text-emerald-800 disabled:opacity-50">
            <Plus size={16} /> Tambah produk lain
          </button>

          <div className="grid gap-2 border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
              <PackagePlus size={16} /> {saving ? 'Menyimpan…' : 'Simpan dan mulai berjualan'}
            </button>
            <button type="button" disabled={saving} onClick={() => router.replace('/kasir')} className="text-xs font-semibold text-slate-500 underline disabled:opacity-50">
              Lewati dulu, isi nanti lewat menu Inventaris
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
