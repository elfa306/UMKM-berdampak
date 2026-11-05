'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Boxes, Factory, Plus, RefreshCw, Scissors, ShieldCheck, Timer, Trash2, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';

type Mode = 'demo' | 'production';
type Product = { id: string; sku?: string | null; name: string; itemType: string; unit: string; salePrice: number; unitCost: number; stock: number; tracksStock: boolean };
type RecipeItem = { productId: string; name: string; qty: number; unit: string };
type Recipe = { id: string; name: string; outputProductId: string; outputProductName: string; outputQty: number; outputUnit: string; note?: string | null; items: RecipeItem[] };
type Batch = { id: string; batchNo: string; recipeId: string; productName: string; outputQty: number; materialCost: number; laborCost: number; overheadCost: number; totalCost: number; unitCost: number; status: string; completedAt: string; items: Array<{ name: string; qty: number; unit: string; unitCost: number; subtotal: number }> };
type Snapshot = { products: Product[]; recipes: Recipe[]; batches: Batch[] };
const EMPTY: Snapshot = { products: [], recipes: [], batches: [] };
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const number = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(n);

export default function ManufacturingManager({ mode, businessName }: { mode: Mode; businessName?: string }) {
  const isDemo = mode === 'demo';
  const endpoint = isDemo ? '/api/demo/produksi' : '/api/produksi';
  const backHref = isDemo ? '/demo/ruang' : '/lainnya';
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'recipes' | 'run' | 'history'>('recipes');
  const [recipeForm, setRecipeForm] = useState({ name: '', outputProductId: '', outputQty: '30', note: '' });
  const [ingredients, setIngredients] = useState([{ productId: '', qty: '10' }, { productId: '', qty: '2' }]);
  const [runForm, setRunForm] = useState({ recipeId: '', batchCount: '1', laborCost: '30000', overheadCost: '20000', note: '' });

  const reload = useCallback(async () => {
    let headers: HeadersInit = {};
    let ep = endpoint;
    if (!isDemo) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      } else {
        ep = '/api/demo/produksi';
      }
    }
    const response = await fetch(ep, { headers, credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Data produksi gagal dimuat.');
    setSnapshot(result as Snapshot);
  }, [endpoint, isDemo]);

  useEffect(() => { let active = true; reload().catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Data produksi gagal dimuat.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [reload]);

  const materials = useMemo(() => snapshot.products.filter((p) => ['raw_material', 'work_in_progress'].includes(p.itemType) && p.tracksStock), [snapshot.products]);
  const finished = useMemo(() => snapshot.products.filter((p) => p.itemType === 'finished_good'), [snapshot.products]);
  const recipeMap = useMemo(() => new Map(snapshot.recipes.map((r) => [r.id, r])), [snapshot.recipes]);
  const selectedOutput = finished.find((p) => p.id === recipeForm.outputProductId);

  async function post(payload: Record<string, unknown>) {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    let ep = endpoint;
    if (!isDemo) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      } else {
        ep = '/api/demo/produksi';
      }
    }
    const response = await fetch(ep, { method: 'POST', headers, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Permintaan produksi gagal.');
    return result;
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!recipeForm.outputProductId) throw new Error('Pilih produk jadi yang dihasilkan.');
      const items = ingredients.filter((i) => i.productId).map((i) => ({ productId: i.productId, qty: Number(i.qty) }));
      if (!items.length) throw new Error('Tambahkan minimal satu bahan baku.');
      if (items.some((i) => !Number.isFinite(i.qty) || i.qty <= 0)) throw new Error('Kuantitas bahan harus lebih dari nol.');
      await post({ action: 'recipe', name: recipeForm.name, outputProductId: recipeForm.outputProductId, outputQty: Number(recipeForm.outputQty), note: recipeForm.note, items });
      setRecipeForm({ name: '', outputProductId: '', outputQty: '30', note: '' });
      setIngredients([{ productId: '', qty: '10' }, { productId: '', qty: '2' }]);
      await reload(); setNotice('Resep produksi berhasil disimpan.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Resep gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function completeBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!runForm.recipeId) throw new Error('Pilih resep yang akan diproduksi.');
      const batchCount = Number(runForm.batchCount); const laborCost = Number(runForm.laborCost || 0); const overheadCost = Number(runForm.overheadCost || 0);
      if (!Number.isFinite(batchCount) || batchCount <= 0 || !Number.isFinite(laborCost) || laborCost < 0 || !Number.isFinite(overheadCost) || overheadCost < 0) throw new Error('Jumlah batch dan biaya belum valid.');
      const result = await post({ action: 'complete', recipeId: runForm.recipeId, batchCount, laborCost, overheadCost, note: runForm.note, requestId: crypto.randomUUID() });
      const batch = result.result?.batch;
      setRunForm({ recipeId: '', batchCount: '1', laborCost: '30000', overheadCost: '20000', note: '' });
      await reload(); setNotice(`Produksi selesai. Hasil ${number(Number(batch?.output_qty ?? result.result?.output_qty ?? 0))} unit dengan HPP ${IDR.format(Number(batch?.unit_cost ?? result.result?.unit_cost ?? 0))} per unit.`); setTab('history');
    } catch (e) { setError(e instanceof Error ? e.message : 'Produksi gagal diselesaikan.'); }
    finally { setBusy(false); }
  }

  return (
    <main className={`min-h-screen px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7 ${isDemo ? 'bg-slate-50' : 'bg-[#f6f8f7]'}`}>
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft size={16}/>{isDemo ? 'Dashboard demo' : 'Menu lainnya'}</Link>
          <span className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold ${isDemo ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{isDemo ? 'DEMO MODE' : 'PRODUKSI USAHA'}</span>
        </header>
        <section className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-lg sm:p-7">
          <div className="flex items-start gap-3"><span className="rounded-2xl bg-white/10 p-3"><Factory size={25}/></span><div><p className="text-xs font-bold tracking-wide text-emerald-200">MANUFACTURING MANAGEMENT</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Produksi & HPP</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{businessName ? `${businessName} · ` : ''}Ubah bahan baku menjadi barang jadi, catat biaya tenaga kerja dan overhead, lalu hitung harga pokok produksi per unit.</p></div></div>
          <div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-slate-300">Bahan tersedia</p><p className="mt-1 text-xl font-black">{materials.length}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-slate-300">Resep</p><p className="mt-1 text-xl font-black">{snapshot.recipes.length}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-slate-300">Batch selesai</p><p className="mt-1 text-xl font-black">{snapshot.batches.length}</p></div></div>
        </section>

        {error && <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {([{ id: 'recipes', label: 'Resep / BOM', icon: Scissors }, { id: 'run', label: 'Jalankan produksi', icon: Factory }, { id: 'history', label: 'Riwayat batch', icon: Timer }] as const).map((t) => {
            const Icon = t.icon; return <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-extrabold sm:text-sm ${tab === t.id ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={15}/><span>{t.label}</span></button>;
          })}
        </div>

        {loading ? <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">Memuat data produksi…</div> : null}

        {!loading && tab === 'recipes' && <section className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <form onSubmit={saveRecipe} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><Plus className="text-emerald-700" size={18}/><h2 className="font-black">Buat resep produksi (BOM)</h2></div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Tentukan kebutuhan bahan untuk satu kali batch. Contoh: 10 kg singkong dan 2 liter minyak menghasilkan 30 bungkus keripik.</p>
            <label className="mt-4 block text-xs font-bold text-slate-700">Nama resep<input required minLength={2} maxLength={120} value={recipeForm.name} onChange={(e) => setRecipeForm((v) => ({ ...v, name: e.target.value }))} placeholder="Keripik singkong balado" className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"/></label>
            <label className="mt-3 block text-xs font-bold text-slate-700">Produk jadi<select required value={recipeForm.outputProductId} onChange={(e) => setRecipeForm((v) => ({ ...v, outputProductId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Pilih produk bertipe Barang Jadi</option>{finished.map((p) => <option key={p.id} value={p.id}>{p.name} · stok {number(p.stock)} {p.unit}</option>)}</select></label>
            <label className="mt-3 block text-xs font-bold text-slate-700">Hasil per batch ({selectedOutput?.unit ?? 'unit'})<input required type="number" min="0.001" step="0.001" value={recipeForm.outputQty} onChange={(e) => setRecipeForm((v) => ({ ...v, outputQty: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
            <div className="mt-4 flex items-center justify-between"><b className="text-sm">Bahan baku / WIP</b><button type="button" onClick={() => setIngredients((old) => [...old, { productId: '', qty: '1' }])} className="text-xs font-extrabold text-emerald-700">+ Tambah bahan</button></div>
            <div className="mt-2 space-y-2">{ingredients.map((line, index) => <div key={index} className="grid grid-cols-[1fr_100px_36px] gap-2"><select required value={line.productId} onChange={(e) => setIngredients((old) => old.map((v, i) => i === index ? { ...v, productId: e.target.value } : v))} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 text-xs"><option value="">Pilih bahan</option>{materials.map((p) => <option key={p.id} value={p.id}>{p.name} · {number(p.stock)} {p.unit}</option>)}</select><input aria-label={`Jumlah bahan ${index + 1}`} type="number" required min="0.001" step="0.001" value={line.qty} onChange={(e) => setIngredients((old) => old.map((v, i) => i === index ? { ...v, qty: e.target.value } : v))} className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"/><button type="button" disabled={ingredients.length <= 1} onClick={() => setIngredients((old) => old.filter((_, i) => i !== index))} className="grid place-items-center rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 size={15}/></button></div>)}</div>
            <label className="mt-3 block text-xs font-bold text-slate-700">Catatan (opsional)<input value={recipeForm.note} onChange={(e) => setRecipeForm((v) => ({ ...v, note: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
            <button disabled={busy || !finished.length || !materials.length} className="mt-5 w-full rounded-xl bg-emerald-700 p-3.5 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? 'Menyimpan…' : 'Simpan resep produksi'}</button>
            {(!finished.length || !materials.length) && <p className="mt-2 text-[11px] text-amber-700">Tambahkan minimal satu produk bertipe Barang Jadi dan satu bahan baku yang stoknya dilacak melalui Inventaris.</p>}
          </form>
          <div className="space-y-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Resep tersimpan</h2>{snapshot.recipes.length ? <div className="mt-3 space-y-3">{snapshot.recipes.map((r) => <article key={r.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="flex justify-between gap-2"><div><b className="text-sm">{r.name}</b><p className="mt-1 text-xs text-slate-500">Hasil: {number(r.outputQty)} {r.outputUnit} {r.outputProductName}</p></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700">BOM</span></div><div className="mt-3 space-y-1">{r.items.map((i) => <p key={i.productId} className="text-xs text-slate-600">• {number(i.qty)} {i.unit} {i.name}</p>)}</div></article>)}</div> : <p className="mt-3 text-sm text-slate-500">Belum ada resep. Buat resep pertama di formulir sebelah.</p>}</div>
            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-900"><ShieldCheck size={17} className="mb-1"/>Bahan baku hanya dikurangi ketika batch diselesaikan. Kuantitas dan stok divalidasi ulang oleh database dalam satu transaksi.</div>
          </div>
        </section>}

        {!loading && tab === 'run' && <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <form onSubmit={completeBatch} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><Factory size={19} className="text-emerald-700"/><h2 className="font-black">Selesaikan batch produksi</h2></div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Sistem mengambil harga pokok bahan baku saat produksi, menghitung biaya tenaga kerja dan overhead, lalu memperbarui stok barang jadi.</p>
            <label className="mt-4 block text-xs font-bold">Resep<select required value={runForm.recipeId} onChange={(e) => setRunForm((v) => ({ ...v, recipeId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Pilih resep</option>{snapshot.recipes.map((r) => <option key={r.id} value={r.id}>{r.name} · {number(r.outputQty)} {r.outputUnit}/batch</option>)}</select></label>
            <label className="mt-3 block text-xs font-bold">Jumlah batch<input required type="number" min="0.001" step="0.001" value={runForm.batchCount} onChange={(e) => setRunForm((v) => ({ ...v, batchCount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
            <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs font-bold">Biaya tenaga kerja (Rp)<input type="number" min="0" step="1" value={runForm.laborCost} onChange={(e) => setRunForm((v) => ({ ...v, laborCost: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label><label className="text-xs font-bold">Biaya overhead (Rp)<input type="number" min="0" step="1" value={runForm.overheadCost} onChange={(e) => setRunForm((v) => ({ ...v, overheadCost: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label></div>
            <label className="mt-3 block text-xs font-bold">Catatan batch<input value={runForm.note} onChange={(e) => setRunForm((v) => ({ ...v, note: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
            <button disabled={busy || !snapshot.recipes.length} className="mt-5 w-full rounded-xl bg-emerald-700 p-3.5 text-sm font-extrabold text-white disabled:opacity-50">{busy ? 'Memproses produksi…' : 'Selesaikan produksi'}</button>
          </form>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Stok bahan saat ini</h2><p className="mt-1 text-xs text-slate-500">Stok diperiksa ulang sebelum batch diselesaikan.</p><div className="mt-3 space-y-2">{materials.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><b className="text-sm">{p.name}</b><p className="text-[11px] text-slate-500">HPP {IDR.format(p.unitCost)} / {p.unit}</p></div><b className="text-sm tabular-nums">{number(p.stock)} {p.unit}</b></div>)}{!materials.length && <p className="text-sm text-slate-500">Belum ada bahan baku yang melacak stok.</p>}</div></div>
        </section>}

        {!loading && tab === 'history' && <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Riwayat produksi</h2><p className="mt-1 text-xs text-slate-500">HPP batch mencakup bahan baku, tenaga kerja langsung, dan overhead.</p>{snapshot.batches.length ? <div className="mt-4 space-y-3">{snapshot.batches.map((b) => <article key={b.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-sm">{b.batchNo}</b><p className="mt-1 text-xs text-slate-500">{b.productName} · {number(b.outputQty)} unit · {new Date(b.completedAt).toLocaleString('id-ID')}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Selesai</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ label: 'Bahan baku', value: b.materialCost }, { label: 'Tenaga kerja', value: b.laborCost }, { label: 'Overhead', value: b.overheadCost }, { label: 'Total biaya', value: b.totalCost }].map((m) => <div key={m.label} className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10px] text-slate-500">{m.label}</p><p className="mt-1 text-xs font-extrabold">{IDR.format(m.value)}</p></div>)}</div><div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 p-3"><span className="text-xs font-bold text-emerald-900">HPP per {b.productName}</span><b className="text-sm text-emerald-800">{IDR.format(b.unitCost)}</b></div><details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-600">Lihat rincian bahan</summary><div className="mt-2 space-y-1">{b.items.map((i) => <div key={`${b.id}-${i.name}`} className="flex justify-between gap-2 text-xs text-slate-600"><span>{i.name} · {number(i.qty)} {i.unit}</span><b>{IDR.format(i.subtotal)}</b></div>)}</div></details></article>)}</div> : <p className="mt-4 text-sm text-slate-500">Belum ada batch produksi. Buat resep dan jalankan produksi untuk mulai mencatat riwayat.</p>}</section>}

        <div className="mt-5 flex flex-wrap gap-2"><Link href={isDemo ? '/demo/inventaris' : '/inventaris'} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-extrabold text-slate-700"><Boxes size={15}/> Kelola bahan & stok</Link><Link href={isDemo ? '/demo/akuntansi' : '/akuntansi'} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-extrabold text-slate-700"><Wallet size={15}/> Lihat akuntansi</Link><button onClick={() => reload().catch((e) => setError(e.message))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-extrabold text-slate-700"><RefreshCw size={15}/> Muat ulang</button></div>
        <p className="mt-5 text-[11px] leading-5 text-slate-500">Catatan: perhitungan menggunakan harga pokok rata-rata bergerak dari inventaris. HPP adalah estimasi berdasarkan biaya yang dicatat; alokasi biaya penyusutan, produk gagal, kapasitas normal, dan WIP yang kompleks memerlukan pencatatan tambahan.</p>
        <BottomNav />
      </div>
    </main>
  );
}
