'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Package, Plus, RefreshCw, Search, ShieldCheck, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';
import { Rise, Press } from '@/components/Motion';

type Product = { id: string; sku: string | null; nama: string; kategori: string; jenis_item: string; satuan: string; harga: number; harga_pokok: number; stok: number; stok_minimum: number; lacak_stok: boolean; aktif: boolean };
type Supplier = { id: string; nama: string; telepon: string | null; alamat: string | null; catatan: string | null; aktif: boolean };
type Purchase = { id: string; nomor_pembelian: string; supplier_id: string | null; total_biaya: number; catatan: string | null; diterima_pada: string };
type Movement = { id: string; product_id: string; movement_type: string; quantity_delta: number; unit_cost: number; total_cost: number; note: string | null; created_at: string };
type Tab = 'overview' | 'purchase' | 'movements' | 'products';
type PurchaseLine = { productId: string; qty: string; unitCost: string };

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const ITEM_LABEL: Record<string,string> = { merchandise:'Barang dagangan', raw_material:'Bahan baku', work_in_progress:'Barang dalam proses', finished_good:'Barang jadi', service:'Jasa' };
const MOVE_LABEL: Record<string,string> = { opening:'Stok awal', purchase:'Pembelian', sale:'Penjualan kasir', adjustment_in:'Penyesuaian masuk', adjustment_out:'Penyesuaian keluar', return_in:'Retur pelanggan', return_out:'Retur pemasok', waste:'Rusak / kedaluwarsa' };
const blankLine = (): PurchaseLine => ({ productId:'', qty:'1', unitCost:'0' });

export default function InventoryManager() {
  const router = useRouter();
  const [userId,setUserId] = useState('');
  const [products,setProducts] = useState<Product[]>([]);
  const [suppliers,setSuppliers] = useState<Supplier[]>([]);
  const [purchases,setPurchases] = useState<Purchase[]>([]);
  const [movements,setMovements] = useState<Movement[]>([]);
  const [tab,setTab] = useState<Tab>('overview');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [supplierForm,setSupplierForm] = useState({nama:'',telepon:'',alamat:'',catatan:''});
  const [showSupplier,setShowSupplier] = useState(false);
  const [productForm,setProductForm] = useState({sku:'',nama:'',kategori:'Umum',jenis_item:'merchandise',satuan:'pcs',harga:'',harga_pokok:'',stok:'0',stok_minimum:'0'});
  const [showProduct,setShowProduct] = useState(false);
  const [trackingProduct,setTrackingProduct] = useState<Product|null>(null);
  const [trackingForm,setTrackingForm] = useState({stok:'0',harga_pokok:'0',stok_minimum:'0'});
  const [supplierId,setSupplierId] = useState('');
  const [purchaseNote,setPurchaseNote] = useState('');
  const [purchaseLines,setPurchaseLines] = useState<PurchaseLine[]>([blankLine()]);
  const [adjustForm,setAdjustForm] = useState({productId:'',movementType:'adjustment_in',qty:'1',unitCost:'0',note:''});

  const reload = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) { router.replace('/login'); return; }
    setUserId(user.id);
    const [p,s,b,m] = await Promise.all([
      supabase.from('products').select('id,sku,nama,kategori,jenis_item,satuan,harga,harga_pokok,stok,stok_minimum,lacak_stok,aktif').eq('user_id',user.id).eq('aktif',true).order('nama'),
      supabase.from('suppliers').select('id,nama,telepon,alamat,catatan,aktif').eq('user_id',user.id).eq('aktif',true).order('nama'),
      supabase.from('stock_purchases').select('id,nomor_pembelian,supplier_id,total_biaya,catatan,diterima_pada').eq('user_id',user.id).order('diterima_pada',{ascending:false}).limit(30),
      supabase.from('inventory_movements').select('id,product_id,movement_type,quantity_delta,unit_cost,total_cost,note,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(60),
    ]);
    const failed = [p.error,s.error,b.error,m.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    setProducts((p.data??[]).map((x)=>({...x,harga:Number(x.harga),harga_pokok:Number(x.harga_pokok),stok:Number(x.stok),stok_minimum:Number(x.stok_minimum)})) as Product[]);
    setSuppliers((s.data??[]) as Supplier[]);
    setPurchases((b.data??[]).map((x)=>({...x,total_biaya:Number(x.total_biaya)})) as Purchase[]);
    setMovements((m.data??[]).map((x)=>({...x,quantity_delta:Number(x.quantity_delta),unit_cost:Number(x.unit_cost),total_cost:Number(x.total_cost)})) as Movement[]);
  },[router]);

  useEffect(()=>{let mounted=true; reload().catch((err)=>{if(mounted)setError(err instanceof Error?err.message:'Data inventaris gagal dimuat.');}).finally(()=>{if(mounted)setLoading(false);});return()=>{mounted=false;};},[reload]);

  const stockable = products.filter((p)=>p.jenis_item!=='service');
  const visible = useMemo(()=>products.filter((p)=>`${p.nama} ${p.sku??''} ${p.kategori}`.toLowerCase().includes(search.toLowerCase())),[products,search]);
  const lowStock = stockable.filter((p)=>p.lacak_stok&&p.stok_minimum>0&&p.stok<=p.stok_minimum);
  const tracked = stockable.filter((p)=>p.lacak_stok);
  const untracked = stockable.filter((p)=>!p.lacak_stok);
  const inventoryValue = tracked.reduce((sum,p)=>sum+p.stok*p.harga_pokok,0);
  const purchaseTotal = purchaseLines.reduce((sum,line)=>sum+Math.max(0,Number(line.qty)||0)*Math.max(0,Number(line.unitCost)||0),0);
  const productById = new Map(products.map((p)=>[p.id,p]));
  const supplierById = new Map(suppliers.map((s)=>[s.id,s.nama]));

  async function saveSupplier(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {error}=await supabase.from('suppliers').insert({user_id:userId,...supplierForm});if(error)throw error;setSupplierForm({nama:'',telepon:'',alamat:'',catatan:''});setShowSupplier(false);await reload();setNotice('Pemasok berhasil disimpan.');}catch(err){setError(err instanceof Error?err.message:'Pemasok gagal disimpan.');}finally{setBusy(false);}}

  async function saveProduct(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {data,error}=await supabase.rpc('create_inventory_product',{p_sku:productForm.sku||null,p_name:productForm.nama,p_category:productForm.kategori,p_item_type:productForm.jenis_item,p_unit:productForm.satuan,p_sale_price:Number(productForm.harga||0),p_unit_cost:Number(productForm.harga_pokok||0),p_stock:Number(productForm.stok||0),p_min_stock:Number(productForm.stok_minimum||0),p_track_stock:productForm.jenis_item!=='service'});if(error)throw error;setShowProduct(false);setProductForm({sku:'',nama:'',kategori:'Umum',jenis_item:'merchandise',satuan:'pcs',harga:'',harga_pokok:'',stok:'0',stok_minimum:'0'});await reload();setNotice('Produk berhasil ditambahkan.');}catch(err){setError(err instanceof Error?err.message:'Produk gagal disimpan.');}finally{setBusy(false);}}

  async function enableTracking(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!trackingProduct)return;setBusy(true);setError('');setNotice('');try{const initialStock=Number(trackingForm.stok);const unitCost=Number(trackingForm.harga_pokok);const minStock=Number(trackingForm.stok_minimum);if(!Number.isFinite(initialStock)||initialStock<0||!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(minStock)||minStock<0)throw new Error('Stok awal, HPP, dan stok minimum harus berupa angka valid.');const {error}=await supabase.rpc('enable_inventory_tracking',{p_product_id:trackingProduct.id,p_initial_stock:initialStock,p_unit_cost:unitCost,p_min_stock:minStock});if(error){if(error.message.includes('inventory_tracking_already_enabled'))throw new Error('Pelacakan stok produk ini sudah aktif.');if(error.message.includes('service_cannot_be_stocked'))throw new Error('Produk jasa tidak menggunakan stok fisik.');throw error;}const name=trackingProduct.nama;setTrackingProduct(null);await reload();setNotice(`Pelacakan stok ${name} berhasil diaktifkan. Saldo awal dicatat sebagai mutasi stok.`);}catch(err){setError(err instanceof Error?err.message:'Pelacakan stok gagal diaktifkan.');}finally{setBusy(false);}}

  async function receivePurchase(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const items=purchaseLines.filter(x=>x.productId).map(x=>({productId:x.productId,qty:Number(x.qty),unitCost:Number(x.unitCost)}));if(!items.length)throw new Error('Pilih minimal satu produk.');if(items.some(x=>x.qty<=0||!Number.isFinite(x.qty)||x.unitCost<0||!Number.isFinite(x.unitCost)))throw new Error('Kuantitas atau harga beli tidak valid.');const {data,error}=await supabase.rpc('receive_inventory_purchase',{p_supplier_id:supplierId||null,p_note:purchaseNote,p_idempotency_key:crypto.randomUUID(),p_items:items});if(error)throw error;setPurchaseLines([blankLine()]);setPurchaseNote('');setSupplierId('');await reload();setNotice('Penerimaan barang tersimpan dan stok diperbarui.');setTab('overview');}catch(err){setError(err instanceof Error?err.message:'Pembelian gagal disimpan.');}finally{setBusy(false);}}

  async function saveAdjustment(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {error}=await supabase.rpc('adjust_inventory_stock',{p_product_id:adjustForm.productId,p_movement_type:adjustForm.movementType,p_quantity:Number(adjustForm.qty),p_unit_cost:Number(adjustForm.unitCost||0),p_note:adjustForm.note,p_idempotency_key:crypto.randomUUID()});if(error)throw error;setAdjustForm(v=>({...v,qty:'1',note:''}));await reload();setNotice('Mutasi persediaan berhasil dicatat.');}catch(err){setError(err instanceof Error?err.message:'Mutasi stok gagal disimpan.');}finally{setBusy(false);}}

  return <div className="wrap" style={{paddingBottom:100}}>
    <div className="header-app"><h1>Manajemen <span>Inventaris</span></h1><p>Kelola produk, pemasok, dan pergerakan stok usaha.</p></div>
    {error&&<p className="err">{error}</p>}{notice&&<div className="glass-card" style={{color:'#047857',fontWeight:700}}>{notice}</div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[{label:'Produk lacak stok',value:tracked.length,icon:Boxes},{label:'Total kuantitas',value:tracked.reduce((s,p)=>s+p.stok,0).toLocaleString('id-ID'),icon:Package},{label:'Nilai persediaan',value:IDR.format(inventoryValue),icon:ShieldCheck},{label:'Stok rendah',value:lowStock.length,icon:AlertTriangle}].map((item)=>{const Icon=item.icon;return <div key={item.label} className="glass-card"><div className="flex items-center justify-between text-xs text-slate-500"><span>{item.label}</span><Icon size={16}/></div><p className="mt-2 text-lg font-black">{item.value}</p></div>;})}
    </div>
    <div className="glass-card" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:6,padding:8}}>
      {([['overview','Ringkas'],['purchase','Barang masuk'],['movements','Mutasi'],['products','Produk']] as Array<[Tab,string]>).map(([key,label])=><button key={key} onClick={()=>{setTab(key);setError('');setNotice('');}} className={`rounded-xl px-2 py-3 text-xs font-bold ${tab===key?'bg-emerald-700 text-white':'bg-slate-100 text-slate-600'}`}>{label}</button>)}
    </div>
    {loading&&<div className="glass-card">Memuat inventaris…</div>}

    {!loading&&tab==='overview'&&<>
      <div className="glass-card"><div className="flex items-center justify-between"><span className="label">Stok minimum</span><AlertTriangle size={18}/></div>{lowStock.length?lowStock.map(p=><div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-3 text-sm"><b>{p.nama}</b><strong className="text-amber-700">{p.stok} / min. {p.stok_minimum} {p.satuan}</strong></div>):<p className="muted">Tidak ada produk yang berada di bawah batas minimum.</p>}</div>
      {untracked.length>0&&<div className="glass-card" style={{border:'1px solid #fcd34d',background:'#fffbeb'}}><b className="text-amber-900">{untracked.length} produk belum melacak stok</b><p className="mt-1 text-xs leading-5 text-amber-800">Produk lama tetap dapat dijual seperti biasa. Untuk mulai menghitung stoknya, buka tab Produk lalu pilih Aktifkan pelacakan stok dan masukkan jumlah fisik saat ini.</p><button onClick={()=>setTab('products')} className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">Atur pelacakan stok</button></div>}
      <div className="glass-card"><span className="label">Persediaan aktif</span>{tracked.slice(0,10).map(p=><div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-3"><div><b>{p.nama}</b><small className="block muted">{p.sku||'Tanpa SKU'} · {ITEM_LABEL[p.jenis_item]||p.jenis_item}</small></div><b>{p.stok} {p.satuan}</b></div>)}{!tracked.length&&<p className="muted">Belum ada produk yang melacak persediaan.</p>}</div>
      <div className="glass-card"><span className="label">Aksi cepat</span><div className="grid grid-cols-2 gap-2"><Press className="btn-soft" onClick={()=>setTab('purchase')}>＋ Barang masuk</Press><Press className="btn-soft" onClick={()=>setTab('movements')}>↕ Mutasi stok</Press><Press className="btn-soft" onClick={()=>setShowProduct(true)}>＋ Produk</Press><Press className="btn-soft" onClick={()=>setShowSupplier(true)}>＋ Pemasok</Press></div></div>
    </>}

    {!loading&&tab==='purchase'&&<>
      <form className="glass-card" onSubmit={receivePurchase}><span className="label">Penerimaan pembelian</span><label className="block text-xs font-bold">Pemasok<select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="">Tanpa pemasok</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.nama}</option>)}</select></label>
        {purchaseLines.map((line,index)=><div key={index} className="mt-3 rounded-xl bg-slate-50 p-3"><div className="flex justify-between text-xs font-bold"><span>Barang #{index+1}</span>{purchaseLines.length>1&&<button type="button" onClick={()=>setPurchaseLines(old=>old.filter((_,i)=>i!==index))}>Hapus</button>}</div><select value={line.productId} onChange={e=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,productId:e.target.value,unitCost:String(products.find(p=>p.id===e.target.value)?.harga_pokok??0)}:v))} required className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Pilih produk</option>{stockable.map(p=><option key={p.id} value={p.id}>{p.nama} ({p.satuan})</option>)}</select><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs">Jumlah<input type="number" min="0.001" step="0.001" value={line.qty} onChange={e=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,qty:e.target.value}:v))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"/></label><label className="text-xs">Harga beli/unit<input type="number" min="0" step="1" value={line.unitCost} onChange={e=>setPurchaseLines(old=>old.map((v,i)=>i===index?{...v,unitCost:e.target.value}:v))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"/></label></div></div>)}
        <button type="button" onClick={()=>setPurchaseLines(old=>[...old,blankLine()])} className="mt-3 text-xs font-bold text-emerald-700">＋ Tambah barang</button><input value={purchaseNote} onChange={e=>setPurchaseNote(e.target.value)} placeholder="Catatan / nomor nota" className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm"/><div className="mt-3 flex justify-between text-sm"><b>Total pembelian</b><b>{IDR.format(purchaseTotal)}</b></div><Press className="btn-main" disabled={busy||!stockable.length}>{busy?'Menyimpan…':'Simpan barang masuk'}</Press></form>
      <div className="glass-card"><div className="flex justify-between"><span className="label">Pemasok</span><button onClick={()=>setShowSupplier(true)} className="text-xs font-bold text-emerald-700">+ Tambah</button></div>{suppliers.map(s=><div key={s.id} className="border-b border-slate-100 py-2"><b>{s.nama}</b><small className="block muted">{s.telepon||'Tanpa telepon'}</small></div>)}</div>
    </>}

    {!loading&&tab==='movements'&&<>
      <form className="glass-card" onSubmit={saveAdjustment}><span className="label">Mutasi / penyesuaian stok</span><label className="block text-xs font-bold">Produk<select required value={adjustForm.productId} onChange={e=>setAdjustForm(v=>({...v,productId:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="">Pilih produk</option>{stockable.map(p=><option key={p.id} value={p.id}>{p.nama} · stok {p.stok} {p.satuan}</option>)}</select></label><label className="mt-3 block text-xs font-bold">Jenis mutasi<select value={adjustForm.movementType} onChange={e=>setAdjustForm(v=>({...v,movementType:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="adjustment_in">Penyesuaian masuk</option><option value="adjustment_out">Penyesuaian keluar</option><option value="return_in">Retur pelanggan masuk</option><option value="return_out">Retur ke pemasok</option><option value="waste">Rusak / kedaluwarsa</option></select></label><label className="mt-3 block text-xs font-bold">Jumlah<input type="number" min="0.001" step="0.001" value={adjustForm.qty} onChange={e=>setAdjustForm(v=>({...v,qty:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Harga pokok per unit (opsional)<input type="number" min="0" step="1" value={adjustForm.unitCost} onChange={e=>setAdjustForm(v=>({...v,unitCost:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Alasan<input required minLength={3} value={adjustForm.note} onChange={e=>setAdjustForm(v=>({...v,note:e.target.value}))} placeholder="Mis. barang rusak" className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><Press className="btn-main" disabled={busy||!stockable.length}>{busy?'Menyimpan…':'Simpan mutasi'}</Press></form>
      <div className="glass-card"><span className="label">Riwayat mutasi</span>{movements.map(m=><div key={m.id} className="flex justify-between gap-2 border-b border-slate-100 py-3 text-xs"><div><b>{productById.get(m.product_id)?.nama||'Produk tidak aktif'}</b><small className="block muted">{MOVE_LABEL[m.movement_type]||m.movement_type} · {m.note||'Tanpa catatan'}</small></div><b className={m.quantity_delta>0?'text-emerald-700':'text-amber-700'}>{m.quantity_delta>0?'+':''}{m.quantity_delta}</b></div>)}</div>
    </>}

    {!loading&&tab==='products'&&<>
      <div className="glass-card"><div className="flex justify-between gap-2"><span className="label">Produk dan bahan</span><button onClick={()=>setShowProduct(true)} className="text-xs font-bold text-emerald-700">+ Tambah</button></div><div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk / SKU" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3"/></div>{visible.map(p=><div key={p.id} className="border-b border-slate-100 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><b>{p.nama}</b><small className="block muted">{p.sku||'Tanpa SKU'} · {ITEM_LABEL[p.jenis_item]||p.jenis_item}</small></div><div className="text-right"><b>{p.lacak_stok?`${p.stok} ${p.satuan}`:'Tidak lacak stok'}</b><small className="block muted">Min. {p.stok_minimum}</small></div></div>{!p.lacak_stok&&p.jenis_item!=='service'&&<button type="button" onClick={()=>{setTrackingProduct(p);setTrackingForm({stok:'0',harga_pokok:String(p.harga_pokok||0),stok_minimum:'0'});}} className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">Aktifkan pelacakan stok</button>}</div>)}</div>
    </>}

    <div className="glass-card"><span className="label">Riwayat penerimaan terbaru</span>{purchases.slice(0,8).map(p=><div key={p.id} className="flex justify-between gap-2 border-b border-slate-100 py-2 text-xs"><div><b>{p.nomor_pembelian}</b><small className="block muted">{supplierById.get(p.supplier_id||'')||'Tanpa pemasok'}</small></div><b>{IDR.format(p.total_biaya)}</b></div>)}{!purchases.length&&<p className="muted">Belum ada penerimaan pembelian.</p>}</div>
    <div className="glass-card" style={{display:'flex',gap:8,alignItems:'flex-start',color:'#047857'}}><ShieldCheck size={17}/><small>Data inventaris dipisahkan berdasarkan akun Supabase. Barang masuk dan penyesuaian diproses melalui fungsi database yang memeriksa kepemilikan serta mencegah stok negatif.</small></div>
    <button onClick={()=>reload().catch(e=>setError(e.message))} className="btn-soft"><RefreshCw size={14}/> Muat ulang data</button>
    <BottomNav />

    {showSupplier&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={saveSupplier} className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex justify-between"><b>Tambah pemasok</b><button type="button" onClick={()=>setShowSupplier(false)}>✕</button></div>{(['nama','telepon','alamat','catatan'] as const).map(k=><label key={k} className="mt-3 block text-xs font-bold capitalize">{k}<input required={k==='nama'} value={supplierForm[k]} onChange={e=>setSupplierForm(v=>({...v,[k]:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>)}<button disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-700 p-3 text-sm font-bold text-white">Simpan pemasok</button></form></div>}
    {trackingProduct&&<div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={enableTracking} className="my-6 w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex justify-between gap-3"><b>Aktifkan stok: {trackingProduct.nama}</b><button type="button" onClick={()=>setTrackingProduct(null)}>✕</button></div><p className="mt-2 text-xs leading-5 text-slate-500">Masukkan jumlah fisik yang benar-benar tersedia saat ini. Sistem akan mencatatnya sebagai saldo awal, bukan sebagai penjualan atau pembelian baru.</p><label className="mt-3 block text-xs font-bold">Stok awal ({trackingProduct.satuan})<input required type="number" min="0" step="0.001" value={trackingForm.stok} onChange={e=>setTrackingForm(v=>({...v,stok:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">HPP / biaya per unit<input required type="number" min="0" step="1" value={trackingForm.harga_pokok} onChange={e=>setTrackingForm(v=>({...v,harga_pokok:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Batas stok minimum<input required type="number" min="0" step="0.001" value={trackingForm.stok_minimum} onChange={e=>setTrackingForm(v=>({...v,stok_minimum:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><div className="mt-4 flex gap-2"><button type="button" onClick={()=>setTrackingProduct(null)} className="flex-1 rounded-xl border border-slate-200 p-3 text-sm font-bold">Batal</button><button disabled={busy} className="flex-1 rounded-xl bg-emerald-700 p-3 text-sm font-bold text-white">{busy?'Menyimpan…':'Aktifkan stok'}</button></div></form></div>}

    {showProduct&&<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveProduct} className="my-6 w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl"><div className="flex justify-between"><b>Tambah produk inventaris</b><button type="button" onClick={()=>setShowProduct(false)}>✕</button></div><div className="mt-3 grid grid-cols-2 gap-2">{(['nama','sku','kategori','satuan','harga','harga_pokok','stok','stok_minimum'] as const).map(k=><label key={k} className="text-xs font-bold capitalize">{k.replace('_',' ')}<input required={k==='nama'} type={['harga','harga_pokok','stok','stok_minimum'].includes(k)?'number':'text'} min="0" step={['stok','stok_minimum'].includes(k)?'0.001':'1'} value={productForm[k]} onChange={e=>setProductForm(v=>({...v,[k]:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label>)}</div><label className="mt-3 block text-xs font-bold">Jenis<select value={productForm.jenis_item} onChange={e=>setProductForm(v=>({...v,jenis_item:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="merchandise">Barang dagangan</option><option value="raw_material">Bahan baku</option><option value="work_in_progress">Barang dalam proses</option><option value="finished_good">Barang jadi</option><option value="service">Jasa</option></select></label><p className="mt-2 text-[11px] text-slate-500">Bahan baku dan barang dalam proses boleh memiliki harga jual 0. Untuk jasa stok fisik akan dinonaktifkan.</p><button disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-700 p-3 text-sm font-bold text-white">Simpan produk</button></form></div>}
  </div>;
}
