'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Boxes, Package, Plus, RefreshCw, Search, ShieldCheck, Truck, X } from 'lucide-react';

type Product = { id: string; sku: string | null; name: string; category: string; itemType: string; unit: string; salePrice: number; unitCost: number; stock: number; minStock: number; tracksStock: boolean };
type Supplier = { id: string; name: string; phone: string | null; note: string | null; createdAt: string };
type Purchase = { id: string; purchaseNo: string; supplierName: string; totalCost: number; note: string | null; receivedAt: string };
type Movement = { id: string; productId: string; productName: string; movementType: string; quantityDelta: number; note: string | null; createdAt: string };
type Snapshot = { products: Product[]; suppliers: Supplier[]; purchases: Purchase[]; movements: Movement[]; summary: { trackedProductCount: number; lowStockCount: number; totalStockValue: number; totalUnits: number; lowStockProducts: Product[] } };
type BusinessType = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
type Tab = 'overview' | 'purchase' | 'movements' | 'products';
type PurchaseLine = { productId: string; qty: string; unitCost: string };

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const ITEM_LABEL: Record<string, string> = { merchandise: 'Barang dagangan', raw_material: 'Bahan baku', work_in_progress: 'Barang dalam proses', finished_good: 'Barang jadi', service: 'Jasa' };
const MOVEMENT_LABEL: Record<string, string> = { opening: 'Stok awal', sale: 'Penjualan POS', restock: 'Barang masuk / retur', adjustment: 'Penyesuaian keluar', production_in: 'Hasil produksi masuk', production_out: 'Pemakaian produksi', waste: 'Barang rusak / terbuang' };
const EMPTY: Snapshot = { products: [], suppliers: [], purchases: [], movements: [], summary: { trackedProductCount: 0, lowStockCount: 0, totalStockValue: 0, totalUnits: 0, lowStockProducts: [] } };
const blankLine = (): PurchaseLine => ({ productId: '', qty: '1', unitCost: '0' });

export default function DemoInventory({ businessName, businessType, mode }: { businessName: string; businessType: BusinessType; mode: 'eksplorasi' | 'guided' }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showSupplier, setShowSupplier] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierNote, setSupplierNote] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([blankLine()]);
  const [purchaseNote, setPurchaseNote] = useState('');
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustType, setAdjustType] = useState('adjustment_in');
  const [adjustQty, setAdjustQty] = useState('1');
  const [adjustNote, setAdjustNote] = useState('');
  const [showProduct, setShowProduct] = useState(false);
  const initialItemType = businessType === 'manufaktur' ? 'raw_material' : businessType === 'jasa' ? 'service' : 'merchandise';
  const initialUnit = businessType === 'manufaktur' ? 'kg' : businessType === 'jasa' ? 'layanan' : 'pcs';
  const [productForm, setProductForm] = useState({ name: '', sku: '', category: businessType === 'manufaktur' ? 'Bahan baku' : businessType === 'jasa' ? 'Layanan' : 'Umum', itemType: initialItemType, unit: initialUnit, salePrice: '', unitCost: '', stock: '0', minStock: '0' });

  const reload = useCallback(async () => {
    const response = await fetch('/api/demo/inventory', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Persediaan gagal dimuat.');
    setSnapshot(data as Snapshot);
  }, []);

  useEffect(() => {
    let mounted = true;
    reload().catch((err) => { if (mounted) setError(err instanceof Error ? err.message : 'Persediaan gagal dimuat.'); })
      .finally(() => { if (mounted) setLoading(false); });
    const timer = window.setInterval(() => { if (!document.hidden) reload().catch(() => undefined); }, 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [reload]);

  const visibleProducts = useMemo(() => snapshot.products.filter((p) => `${p.name} ${p.sku ?? ''} ${p.category}`.toLowerCase().includes(search.toLowerCase())), [snapshot.products, search]);
  const stockableProducts = snapshot.products.filter((p) => p.itemType !== 'service');
  const purchaseTotal = purchaseLines.reduce((sum, line) => sum + Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(line.unitCost) || 0), 0);
  const lowStock = snapshot.products.filter((p) => p.tracksStock && p.minStock > 0 && p.stock <= p.minStock);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch('/api/demo/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Permintaan persediaan gagal.');
    return data;
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await post({ action: 'supplier', name: supplierName, phone: supplierPhone, note: supplierNote }); setSupplierName(''); setSupplierPhone(''); setSupplierNote(''); setShowSupplier(false); await reload(); setNotice('Pemasok berhasil ditambahkan.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Pemasok gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function receivePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const items = purchaseLines.filter((line) => line.productId).map((line) => ({ productId: line.productId, qty: Number(line.qty), unitCost: Number(line.unitCost) }));
      if (!items.length) throw new Error('Pilih minimal satu produk.');
      if (items.some((line) => !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0)) throw new Error('Kuantitas atau harga beli tidak valid.');
      await post({ action: 'purchase', supplierId: supplierId || null, note: purchaseNote, requestId: crypto.randomUUID(), items });
      setPurchaseLines([blankLine()]); setPurchaseNote(''); setSupplierId(''); await reload(); router.refresh(); setNotice('Penerimaan barang berhasil dicatat dan stok bertambah.'); setTab('overview');
    } catch (err) { setError(err instanceof Error ? err.message : 'Pembelian gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!adjustProductId) throw new Error('Pilih produk terlebih dahulu.');
      const qty = Number(adjustQty); if (!Number.isFinite(qty) || qty <= 0) throw new Error('Jumlah harus lebih dari nol.');
      await post({ action: 'adjust', productId: adjustProductId, movementType: adjustType, qty, note: adjustNote, requestId: crypto.randomUUID() });
      setAdjustQty('1'); setAdjustNote(''); await reload(); router.refresh(); setNotice('Mutasi persediaan berhasil dicatat.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Mutasi stok gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/demo/pos/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...productForm, salePrice: Number(productForm.salePrice || 0), unitCost: Number(productForm.unitCost || 0), stock: Number(productForm.stock || 0), minStock: Number(productForm.minStock || 0) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Produk gagal dibuat.');
      setShowProduct(false); setProductForm({ name: '', sku: '', category: businessType === 'manufaktur' ? 'Bahan baku' : businessType === 'jasa' ? 'Layanan' : 'Umum', itemType: initialItemType, unit: initialUnit, salePrice: '', unitCost: '', stock: '0', minStock: '0' });
      await reload(); setNotice('Produk berhasil ditambahkan ke inventaris.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Produk gagal dibuat.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3"><Link href="/demo/ruang" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft size={16}/> Dashboard demo</Link><span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold text-amber-800">DEMO MODE</span></header>
        <section className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-extrabold tracking-wide text-emerald-200">MANAJEMEN PERSEDIAAN</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">{businessName}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Catat barang masuk, kelola stok minimum, rekam barang rusak atau retur, dan pantau nilai persediaan.</p></div><div className="flex gap-2"><Link href="/demo/kasir" className="rounded-xl border border-white/20 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/10">Buka kasir</Link><button onClick={() => reload().catch((err) => setError(err.message))} className="rounded-xl border border-white/20 p-2.5 text-white hover:bg-white/10" aria-label="Muat ulang"><RefreshCw size={16}/></button></div></div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300"><span className="rounded-full bg-white/10 px-3 py-1.5">{businessType.toUpperCase()}</span><span className="rounded-full bg-white/10 px-3 py-1.5">{mode === 'guided' ? 'Guided Demo' : 'Eksplorasi Bebas'}</span><span className="rounded-full bg-white/10 px-3 py-1.5">Sesi terisolasi</span></div>
        </section>
        {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        {notice && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
        <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[
          { label: 'Produk lacak stok', value: snapshot.summary.trackedProductCount, icon: Boxes },
          { label: 'Total unit / kuantitas', value: snapshot.summary.totalUnits.toLocaleString('id-ID'), icon: Package },
          { label: 'Estimasi nilai stok', value: IDR.format(snapshot.summary.totalStockValue), icon: ClipboardListIcon },
          { label: 'Stok perlu diperiksa', value: snapshot.summary.lowStockCount, icon: AlertTriangle },
        ].map((item) => { const Icon = item.icon; return <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-slate-500">{item.label}</span><Icon size={17} className="text-emerald-700"/></div><p className="mt-3 break-words text-xl font-black tracking-tight">{item.value}</p></article>; })}</section>
        <nav className="mt-5 grid grid-cols-4 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">{([['overview','Ringkasan'],['purchase','Barang masuk'],['movements','Mutasi stok'],['products','Produk']] as Array<[Tab,string]>).map(([key,label]) => <button key={key} onClick={() => { setTab(key); setError(''); setNotice(''); }} className={`rounded-xl px-2 py-3 text-xs font-extrabold transition ${tab===key ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
        {loading && <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Memuat persediaan demo…</div>}

        {!loading && tab === 'overview' && <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-black">Daftar persediaan</h2><p className="mt-1 text-xs text-slate-500">Saldo terakhir per produk yang melacak stok.</p></div><button onClick={() => setTab('products')} className="text-xs font-extrabold text-emerald-700">Kelola produk</button></div>
            {snapshot.products.filter((p) => p.tracksStock).length ? <div className="mt-4 space-y-3">{snapshot.products.filter((p) => p.tracksStock).slice(0,12).map((p) => { const low=p.minStock>0&&p.stock<=p.minStock; const pct=p.minStock>0?Math.min(100,(p.stock/Math.max(p.minStock*3,p.stock,1))*100):Math.min(100,p.stock*4); return <div key={p.id} className="rounded-2xl border border-slate-100 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-extrabold">{p.name}</p><p className="mt-1 text-[11px] text-slate-500">{p.sku || 'Tanpa SKU'} · {ITEM_LABEL[p.itemType] || p.itemType}</p></div><div className="shrink-0 text-right"><p className={`text-sm font-black ${low?'text-amber-700':'text-slate-900'}`}>{p.stock.toLocaleString('id-ID')} {p.unit}</p><p className="text-[10px] text-slate-500">Min. {p.minStock} {p.unit}</p></div></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${low?'bg-amber-500':'bg-emerald-500'}`} style={{width:`${pct}%`}}/></div></div>; })}</div> : <p className="mt-4 rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">Belum ada produk yang melacak stok.</p>}
          </section>
          <section className="space-y-5"><div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-center gap-2 text-amber-900"><AlertTriangle size={18}/><h2 className="text-sm font-black">Stok minimum</h2></div>{lowStock.length ? <div className="mt-3 space-y-2">{lowStock.map((p)=><div key={p.id} className="flex justify-between gap-2 rounded-xl bg-white/70 p-3 text-xs"><span className="font-bold text-slate-700">{p.name}</span><strong className="text-amber-800">{p.stock} / {p.minStock} {p.unit}</strong></div>)}</div> : <p className="mt-2 text-xs leading-5 text-amber-900/80">Tidak ada produk di bawah batas minimum.</p>}</div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-black">Aksi cepat</h2><div className="mt-3 grid gap-2"><button onClick={()=>setTab('purchase')} className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-left text-xs font-extrabold text-emerald-800"><ArrowDownLeft size={17}/> Catat barang masuk</button><button onClick={()=>setTab('movements')} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-left text-xs font-extrabold text-slate-700"><ArrowUpRight size={17}/> Penyesuaian / barang keluar</button><button onClick={()=>setShowSupplier(true)} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-left text-xs font-extrabold text-slate-700"><Truck size={17}/> Tambah pemasok</button></div></div></section>
        </div>}

        {!loading && tab === 'purchase' && <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_.8fr]">
          <form onSubmit={receivePurchase} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-black">Penerimaan barang</h2><p className="mt-1 text-xs text-slate-500">Stok dan harga pokok rata-rata diperbarui secara atomik.</p></div><Truck className="text-emerald-700"/></div>
            <label className="mt-5 block text-xs font-bold text-slate-600">Pemasok<select value={supplierId} onChange={(e)=>setSupplierId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="">Tanpa pemasok</option>{snapshot.suppliers.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="mt-4 space-y-3">{purchaseLines.map((line,index)=><div key={index} className="rounded-2xl bg-slate-50 p-3"><div className="flex items-center justify-between"><p className="text-xs font-extrabold">Barang #{index+1}</p>{purchaseLines.length>1&&<button type="button" onClick={()=>setPurchaseLines(old=>old.filter((_,i)=>i!==index))} className="text-slate-400"><X size={16}/></button>}</div><select aria-label={`Barang ${index+1}`} value={line.productId} onChange={(e)=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,productId:e.target.value,unitCost:String(snapshot.products.find(p=>p.id===e.target.value)?.unitCost??0)}:v))} required className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="">Pilih produk / bahan</option>{stockableProducts.map(p=><option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[11px] font-bold text-slate-500">Jumlah<input type="number" min="0.001" step="0.001" value={line.qty} onChange={(e)=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,qty:e.target.value}:v))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"/></label><label className="text-[11px] font-bold text-slate-500">Harga beli / unit<input type="number" min="0" step="1" value={line.unitCost} onChange={(e)=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,unitCost:e.target.value}:v))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"/></label></div></div>)}</div>
            <button type="button" onClick={()=>setPurchaseLines(old=>[...old,blankLine()])} className="mt-3 inline-flex items-center gap-2 text-xs font-extrabold text-emerald-700"><Plus size={15}/> Tambah barang</button>
            <label className="mt-4 block text-xs font-bold text-slate-600">Catatan<input value={purchaseNote} onChange={(e)=>setPurchaseNote(e.target.value)} placeholder="Nomor nota atau catatan pembelian" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="text-xs font-bold text-slate-600">Total penerimaan</span><strong className="text-lg font-black">{IDR.format(purchaseTotal)}</strong></div><button disabled={busy||!stockableProducts.length} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-extrabold text-white disabled:opacity-50">{busy?'Menyimpan…':'Simpan penerimaan barang'}</button>
          </form>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-black">Pemasok</h2><p className="mt-1 text-xs text-slate-500">Daftar sumber pembelian.</p></div><button onClick={()=>setShowSupplier(true)} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Tambah</button></div>{snapshot.suppliers.length?<div className="mt-4 space-y-2">{snapshot.suppliers.map(s=><div key={s.id} className="rounded-xl border border-slate-100 p-3"><p className="text-sm font-extrabold">{s.name}</p><p className="mt-1 text-xs text-slate-500">{s.phone||'Tanpa nomor telepon'}</p></div>)}</div>:<p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">Belum ada pemasok. Pemasok bersifat opsional.</p>}</section>
        </div>}

        {!loading && tab === 'movements' && <div className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
          <form onSubmit={adjustStock} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-black">Mutasi / penyesuaian stok</h2><p className="mt-1 text-xs leading-5 text-slate-500">Catat barang rusak, retur, selisih stok, atau barang keluar manual.</p><label className="mt-4 block text-xs font-bold text-slate-600">Produk<select value={adjustProductId} onChange={(e)=>setAdjustProductId(e.target.value)} required className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="">Pilih produk</option>{stockableProducts.map(p=><option key={p.id} value={p.id}>{p.name} · stok {p.stock} {p.unit}</option>)}</select></label><label className="mt-3 block text-xs font-bold text-slate-600">Jenis mutasi<select value={adjustType} onChange={(e)=>setAdjustType(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="adjustment_in">Penyesuaian masuk (+)</option><option value="adjustment_out">Penyesuaian keluar (-)</option><option value="return_in">Retur pelanggan masuk (+)</option><option value="return_out">Retur ke pemasok (-)</option><option value="waste">Rusak / kedaluwarsa (-)</option></select></label><label className="mt-3 block text-xs font-bold text-slate-600">Jumlah<input type="number" min="0.001" step="0.001" value={adjustQty} onChange={(e)=>setAdjustQty(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="mt-3 block text-xs font-bold text-slate-600">Alasan / catatan<input value={adjustNote} onChange={(e)=>setAdjustNote(e.target.value)} required minLength={3} placeholder="Mis. 2 botol pecah" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><button disabled={busy||!stockableProducts.length} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-extrabold text-white disabled:opacity-50">{busy?'Menyimpan…':'Simpan mutasi stok'}</button><p className="mt-3 text-[11px] leading-5 text-slate-500">Stok tidak boleh negatif. Koreksi dicatat sebagai mutasi baru agar riwayat tetap lengkap.</p></form>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-base font-black">Riwayat mutasi</h2><div className="mt-4 space-y-2">{snapshot.movements.length?snapshot.movements.map(m=><div key={m.id} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${m.quantityDelta>0?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{m.quantityDelta>0?<ArrowDownLeft size={16}/>:<ArrowUpRight size={16}/>}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{m.productName}</p><p className="mt-1 text-[11px] text-slate-500">{MOVEMENT_LABEL[m.movementType]||m.movementType} · {m.note||'Tanpa catatan'}</p></div><div className="shrink-0 text-right"><p className={`text-xs font-black ${m.quantityDelta>0?'text-emerald-700':'text-amber-700'}`}>{m.quantityDelta>0?'+':''}{m.quantityDelta}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleDateString('id-ID')}</p></div></div>):<p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-500">Belum ada mutasi stok.</p>}</div></section>
        </div>}

        {!loading && tab === 'products' && <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-black">Produk dan bahan</h2><p className="mt-1 text-xs text-slate-500">Katalog stok, bahan baku, barang jadi, dan jasa.</p></div><button onClick={()=>setShowProduct(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-extrabold text-white"><Plus size={15}/> Tambah produk</button></div><div className="relative mt-4"><Search size={16} className="absolute left-3 top-3.5 text-slate-400"/><input aria-label="Cari produk" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Cari nama, SKU, atau kategori" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 text-sm"/></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="rounded-l-xl p-3">Produk</th><th className="p-3">Jenis</th><th className="p-3">Stok</th><th className="p-3">Minimum</th><th className="rounded-r-xl p-3">HPP/unit</th></tr></thead><tbody>{visibleProducts.map(p=><tr key={p.id} className="border-b border-slate-100"><td className="p-3"><p className="font-extrabold">{p.name}</p><p className="mt-1 text-[10px] text-slate-400">{p.sku||'Tanpa SKU'} · {p.category}</p></td><td className="p-3">{ITEM_LABEL[p.itemType]||p.itemType}</td><td className="p-3 font-bold">{p.tracksStock?`${p.stock} ${p.unit}`:'Tidak melacak stok'}</td><td className="p-3">{p.minStock} {p.unit}</td><td className="p-3">{IDR.format(p.unitCost)}</td></tr>)}</tbody></table></div>{!visibleProducts.length&&<p className="mt-4 text-center text-xs text-slate-500">Produk tidak ditemukan.</p>}</section>}

        {tab!=='overview'&&tab!=='purchase'&&tab!=='movements'&&tab!=='products' ? null : null}
        {snapshot.purchases.length > 0 && <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-xs font-black">Pembelian terakhir</h2><div className="mt-3 space-y-2">{snapshot.purchases.slice(0,4).map(p=><div key={p.id} className="flex justify-between gap-3 text-xs"><div><p className="font-bold">{p.purchaseNo}</p><p className="text-slate-500">{p.supplierName}</p></div><strong>{IDR.format(p.totalCost)}</strong></div>)}</div></section>}
        <p className="mt-5 flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-[11px] leading-5 text-emerald-900"><ShieldCheck size={16} className="mt-0.5 shrink-0"/>Data persediaan hanya milik sesi demonstrasi ini. Penerimaan, retur, dan penyesuaian stok disimpan di database demo, terpisah dari data usaha asli.</p>
      </div>

      {showSupplier && <Modal onClose={()=>setShowSupplier(false)} labelledBy="demo-pemasok-title" className="max-w-md rounded-3xl bg-white p-5 shadow-2xl"><form onSubmit={saveSupplier}><div className="flex items-center justify-between"><h2 id="demo-pemasok-title" className="text-base font-black">Tambah pemasok</h2><button type="button" onClick={()=>setShowSupplier(false)} aria-label="Tutup" className="rounded-lg p-2 text-slate-500"><X size={18}/></button></div><label className="mt-4 block text-xs font-bold text-slate-600">Nama pemasok<input data-autofocus required minLength={2} maxLength={100} value={supplierName} onChange={(e)=>setSupplierName(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="mt-3 block text-xs font-bold text-slate-600">Telepon (opsional)<input value={supplierPhone} onChange={(e)=>setSupplierPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="mt-3 block text-xs font-bold text-slate-600">Catatan<input value={supplierNote} onChange={(e)=>setSupplierNote(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><button disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white">{busy?'Menyimpan…':'Simpan pemasok'}</button></form></Modal>}

      {showProduct && <Modal onClose={()=>setShowProduct(false)} labelledBy="demo-produk-title" className="max-w-lg rounded-3xl bg-white p-5 shadow-2xl"><form onSubmit={createProduct}><div className="flex items-center justify-between"><h2 id="demo-produk-title" className="text-base font-black">Tambah produk / bahan</h2><button type="button" onClick={()=>setShowProduct(false)} aria-label="Tutup" className="rounded-lg p-2 text-slate-500"><X size={18}/></button></div><label className="mt-4 block text-xs font-bold text-slate-600">Nama<input data-autofocus required minLength={2} value={productForm.name} onChange={(e)=>setProductForm(v=>({...v,name:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">SKU<input value={productForm.sku} onChange={(e)=>setProductForm(v=>({...v,sku:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="text-xs font-bold text-slate-600">Kategori<input value={productForm.category} onChange={(e)=>setProductForm(v=>({...v,category:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label></div><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Jenis<select value={productForm.itemType} onChange={(e)=>setProductForm(v=>({...v,itemType:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="merchandise">Barang dagangan</option><option value="raw_material">Bahan baku</option><option value="work_in_progress">Barang dalam proses</option><option value="finished_good">Barang jadi</option><option value="service">Jasa</option></select></label><label className="text-xs font-bold text-slate-600">Satuan<input value={productForm.unit} onChange={(e)=>setProductForm(v=>({...v,unit:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label></div><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Harga jual<input type="number" min="0" step="1" value={productForm.salePrice} onChange={(e)=>setProductForm(v=>({...v,salePrice:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="text-xs font-bold text-slate-600">HPP / unit<input type="number" min="0" step="1" value={productForm.unitCost} onChange={(e)=>setProductForm(v=>({...v,unitCost:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label></div><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Stok awal<input type="number" min="0" step="0.001" value={productForm.stock} onChange={(e)=>setProductForm(v=>({...v,stock:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label><label className="text-xs font-bold text-slate-600">Stok minimum<input type="number" min="0" step="0.001" value={productForm.minStock} onChange={(e)=>setProductForm(v=>({...v,minStock:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Untuk bahan baku dan barang dalam proses, harga jual dapat 0. Untuk jasa, stok fisik harus 0.</p><button disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white">{busy?'Menyimpan…':'Simpan produk'}</button></form></Modal>}
    </main>
  );
}

function ClipboardListIcon({ size = 17, className = '' }: { size?: number; className?: string }) {
  return <Package size={size} className={className} />;
}
