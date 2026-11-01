'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Boxes, Package, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';
import { Press } from '@/components/Motion';

type Product = { id: string; sku: string | null; nama: string; kategori: string; jenis_item: string; satuan: string; harga: number; harga_pokok: number; stok: number; stok_minimum: number; lacak_stok: boolean; aktif: boolean };
type Movement = { id: string; product_id: string; movement_type: string; quantity_delta: number; unit_cost: number; total_cost: number; note: string | null; created_at: string };
type Tab = 'movements' | 'products';

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const ITEM_LABEL: Record<string,string> = { merchandise:'Barang dagangan', raw_material:'Bahan baku', work_in_progress:'Barang dalam proses', finished_good:'Barang jadi', service:'Jasa' };
const MOVE_LABEL: Record<string,string> = { opening:'Stok awal', purchase:'Pembelian', sale:'Penjualan kasir', adjustment_in:'Penyesuaian masuk', adjustment_out:'Penyesuaian keluar', return_in:'Retur pelanggan', return_out:'Retur pemasok', waste:'Rusak / kedaluwarsa' };

export default function InventoryManager() {
  const router = useRouter();
  const [userId,setUserId] = useState('');
  const [products,setProducts] = useState<Product[]>([]);
  const [movements,setMovements] = useState<Movement[]>([]);
  const [tab,setTab] = useState<Tab>('movements');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [productForm,setProductForm] = useState({sku:'',nama:'',kategori:'Umum',jenis_item:'merchandise',satuan:'pcs',harga:'',harga_pokok:'',stok:'0',stok_minimum:'0'});
  const [showProduct,setShowProduct] = useState(false);
  const [trackingProduct,setTrackingProduct] = useState<Product|null>(null);
  const [trackingForm,setTrackingForm] = useState({stok:'0',harga_pokok:'0',stok_minimum:'0'});
  const [deleteTarget,setDeleteTarget] = useState<Product|null>(null);
  const [adjustForm,setAdjustForm] = useState({productId:'',movementType:'adjustment_in',qty:'1',unitCost:'0',note:''});

  const reload = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) { router.replace('/login'); return; }
    setUserId(user.id);
    const [p,m] = await Promise.all([
      supabase.from('products').select('id,sku,nama,kategori,jenis_item,satuan,harga,harga_pokok,stok,stok_minimum,lacak_stok,aktif').eq('user_id',user.id).eq('aktif',true).order('nama'),
      supabase.from('inventory_movements').select('id,product_id,movement_type,quantity_delta,unit_cost,total_cost,note,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(60),
    ]);
    const failed = [p.error,m.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    setProducts((p.data??[]).map((x)=>({...x,harga:Number(x.harga),harga_pokok:Number(x.harga_pokok),stok:Number(x.stok),stok_minimum:Number(x.stok_minimum)})) as Product[]);
    setMovements((m.data??[]).map((x)=>({...x,quantity_delta:Number(x.quantity_delta),unit_cost:Number(x.unit_cost),total_cost:Number(x.total_cost)})) as Movement[]);
  },[router]);

  useEffect(()=>{let mounted=true; reload().catch((err)=>{if(mounted)setError(err instanceof Error?err.message:'Data inventaris gagal dimuat.');}).finally(()=>{if(mounted)setLoading(false);});return()=>{mounted=false;};},[reload]);

  const stockable = products.filter((p)=>p.jenis_item!=='service');
  const visible = useMemo(()=>products.filter((p)=>`${p.nama} ${p.sku??''} ${p.kategori}`.toLowerCase().includes(search.toLowerCase())),[products,search]);
  const lowStock = stockable.filter((p)=>p.lacak_stok&&p.stok_minimum>0&&p.stok<=p.stok_minimum);
  const tracked = stockable.filter((p)=>p.lacak_stok);
  const inventoryValue = tracked.reduce((sum,p)=>sum+p.stok*p.harga_pokok,0);
  const productById = new Map(products.map((p)=>[p.id,p]));

  async function saveProduct(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {data,error}=await supabase.rpc('create_inventory_product',{p_sku:productForm.sku||null,p_name:productForm.nama,p_category:productForm.kategori,p_item_type:productForm.jenis_item,p_unit:productForm.satuan,p_sale_price:Number(productForm.harga||0),p_unit_cost:Number(productForm.harga_pokok||0),p_stock:Number(productForm.stok||0),p_min_stock:Number(productForm.stok_minimum||0),p_track_stock:productForm.jenis_item!=='service'});if(error)throw error;setShowProduct(false);setProductForm({sku:'',nama:'',kategori:'Umum',jenis_item:'merchandise',satuan:'pcs',harga:'',harga_pokok:'',stok:'0',stok_minimum:'0'});await reload();setNotice('Produk berhasil ditambahkan.');}catch(err){setError(err instanceof Error?err.message:'Produk gagal disimpan.');}finally{setBusy(false);}}

  async function enableTracking(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!trackingProduct)return;setBusy(true);setError('');setNotice('');try{const initialStock=Number(trackingForm.stok);const unitCost=Number(trackingForm.harga_pokok);const minStock=Number(trackingForm.stok_minimum);if(!Number.isFinite(initialStock)||initialStock<0||!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(minStock)||minStock<0)throw new Error('Stok awal, HPP, dan stok minimum harus berupa angka valid.');const {error}=await supabase.rpc('enable_inventory_tracking',{p_product_id:trackingProduct.id,p_initial_stock:initialStock,p_unit_cost:unitCost,p_min_stock:minStock});if(error){if(error.message.includes('inventory_tracking_already_enabled'))throw new Error('Pelacakan stok produk ini sudah aktif.');if(error.message.includes('service_cannot_be_stocked'))throw new Error('Produk jasa tidak menggunakan stok fisik.');throw error;}const name=trackingProduct.nama;setTrackingProduct(null);await reload();setNotice(`Pelacakan stok ${name} berhasil diaktifkan. Saldo awal dicatat sebagai mutasi stok.`);}catch(err){setError(err instanceof Error?err.message:'Pelacakan stok gagal diaktifkan.');}finally{setBusy(false);}}

  async function deleteProduct(){if(!deleteTarget)return;setBusy(true);setError('');setNotice('');try{const {error}=await supabase.rpc('delete_inventory_product',{p_product_id:deleteTarget.id});if(error){if(error.message.includes('product_not_found'))throw new Error('Produk tidak ditemukan atau sudah dihapus.');if(/delete_inventory_product/.test(error.message)&&/not exist|schema cache|Could not find/i.test(error.message))throw new Error('Fitur hapus produk belum aktif. Jalankan file supabase/migration_v16_hapus_produk.sql di Supabase SQL Editor.');throw error;}const name=deleteTarget.nama;setDeleteTarget(null);setAdjustForm(v=>v.productId===deleteTarget.id?{...v,productId:''}:v);await reload();setNotice(`Produk ${name} dihapus. Riwayat transaksi dan mutasi lama tetap tersimpan.`);}catch(err){setError(err instanceof Error?err.message:'Produk gagal dihapus.');}finally{setBusy(false);}}

  async function saveAdjustment(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {error}=await supabase.rpc('adjust_inventory_stock',{p_product_id:adjustForm.productId,p_movement_type:adjustForm.movementType,p_quantity:Number(adjustForm.qty),p_unit_cost:Number(adjustForm.unitCost||0),p_note:adjustForm.note,p_idempotency_key:crypto.randomUUID()});if(error)throw error;setAdjustForm(v=>({...v,qty:'1',note:''}));await reload();setNotice('Mutasi persediaan berhasil dicatat.');}catch(err){setError(err instanceof Error?err.message:'Mutasi stok gagal disimpan.');}finally{setBusy(false);}}

  return <div className="wrap" style={{paddingBottom:100}}>
    <div className="header-app"><h1>Manajemen <span>Inventaris</span></h1><p>Kelola produk dan mutasi stok usaha.</p></div>
    {error&&<p className="err">{error}</p>}{notice&&<div className="glass-card" style={{color:'#047857',fontWeight:700}}>{notice}</div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[{label:'Produk lacak stok',value:tracked.length,icon:Boxes},{label:'Total kuantitas',value:tracked.reduce((s,p)=>s+p.stok,0).toLocaleString('id-ID'),icon:Package},{label:'Nilai persediaan',value:IDR.format(inventoryValue),icon:ShieldCheck},{label:'Stok rendah',value:lowStock.length,icon:AlertTriangle}].map((item)=>{const Icon=item.icon;return <div key={item.label} className="glass-card"><div className="flex items-center justify-between text-xs text-slate-500"><span>{item.label}</span><Icon size={16}/></div><p className="mt-2 text-lg font-black">{item.value}</p></div>;})}
    </div>
    <div className="glass-card" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:6,padding:8}}>
      {([['movements','Mutasi'],['products','Produk']] as Array<[Tab,string]>).map(([key,label])=><button key={key} onClick={()=>{setTab(key);setError('');setNotice('');}} className={`rounded-xl px-2 py-3 text-xs font-bold ${tab===key?'bg-emerald-700 text-white':'bg-slate-100 text-slate-600'}`}>{label}</button>)}
    </div>
    {loading&&<div className="glass-card">Memuat inventaris…</div>}

    {!loading&&tab==='movements'&&<>
      <form className="glass-card" onSubmit={saveAdjustment}><span className="label">Mutasi / penyesuaian stok</span><label className="block text-xs font-bold">Produk<select required value={adjustForm.productId} onChange={e=>setAdjustForm(v=>({...v,productId:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="">Pilih produk</option>{stockable.map(p=><option key={p.id} value={p.id}>{p.nama} · stok {p.stok} {p.satuan}</option>)}</select></label><label className="mt-3 block text-xs font-bold">Jenis mutasi<select value={adjustForm.movementType} onChange={e=>setAdjustForm(v=>({...v,movementType:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="adjustment_in">Penyesuaian masuk</option><option value="adjustment_out">Penyesuaian keluar</option><option value="return_in">Retur pelanggan masuk</option><option value="return_out">Retur ke pemasok</option><option value="waste">Rusak / kedaluwarsa</option></select></label><label className="mt-3 block text-xs font-bold">Jumlah<input type="number" min="0.001" step="0.001" value={adjustForm.qty} onChange={e=>setAdjustForm(v=>({...v,qty:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Harga pokok per unit (opsional)<input type="number" min="0" step="1" value={adjustForm.unitCost} onChange={e=>setAdjustForm(v=>({...v,unitCost:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Alasan<input required minLength={3} value={adjustForm.note} onChange={e=>setAdjustForm(v=>({...v,note:e.target.value}))} placeholder="Mis. barang rusak" className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><Press className="btn-main" disabled={busy||!stockable.length}>{busy?'Menyimpan…':'Simpan mutasi'}</Press></form>
      <div className="glass-card"><span className="label">Riwayat mutasi</span>{movements.map(m=><div key={m.id} className="flex justify-between gap-2 border-b border-slate-100 py-3 text-xs"><div><b>{productById.get(m.product_id)?.nama||'Produk tidak aktif'}</b><small className="block muted">{MOVE_LABEL[m.movement_type]||m.movement_type} · {m.note||'Tanpa catatan'}</small></div><b className={m.quantity_delta>0?'text-emerald-700':'text-amber-700'}>{m.quantity_delta>0?'+':''}{m.quantity_delta}</b></div>)}</div>
    </>}

    {!loading&&tab==='products'&&<>
      <div className="glass-card"><div className="flex justify-between gap-2"><span className="label">Produk dan bahan</span><button onClick={()=>setShowProduct(true)} className="text-xs font-bold text-emerald-700">+ Tambah</button></div><div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk / SKU" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3"/></div>{visible.map(p=><div key={p.id} className="border-b border-slate-100 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><b>{p.nama}</b><small className="block muted">{p.sku||'Tanpa SKU'} · {ITEM_LABEL[p.jenis_item]||p.jenis_item}</small></div><div className="text-right"><b>{p.lacak_stok?`${p.stok} ${p.satuan}`:'Tidak lacak stok'}</b><small className="block muted">Min. {p.stok_minimum}</small></div></div><div className="mt-2 flex flex-wrap gap-2">{!p.lacak_stok&&p.jenis_item!=='service'&&<button type="button" onClick={()=>{setTrackingProduct(p);setTrackingForm({stok:'0',harga_pokok:String(p.harga_pokok||0),stok_minimum:'0'});}} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">Aktifkan pelacakan stok</button>}<button type="button" onClick={()=>{setError('');setNotice('');setDeleteTarget(p);}} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700"><Trash2 size={13}/> Hapus produk</button></div></div>)}{!visible.length&&<p className="muted">{products.length?'Tidak ada produk yang cocok dengan pencarian.':'Belum ada produk. Tekan + Tambah untuk memulai.'}</p>}</div>
    </>}

    <div className="glass-card" style={{display:'flex',gap:8,alignItems:'flex-start',color:'#047857'}}><ShieldCheck size={17}/><small>Data inventaris dipisahkan berdasarkan akun Supabase. Penyesuaian stok diproses melalui fungsi database yang memeriksa kepemilikan serta mencegah stok negatif.</small></div>
    <button onClick={()=>reload().catch(e=>setError(e.message))} className="btn-soft"><RefreshCw size={14}/> Muat ulang data</button>
    <BottomNav />

    {trackingProduct&&<div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={enableTracking} className="my-6 w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex justify-between gap-3"><b>Aktifkan stok: {trackingProduct.nama}</b><button type="button" onClick={()=>setTrackingProduct(null)}>✕</button></div><p className="mt-2 text-xs leading-5 text-slate-500">Masukkan jumlah fisik yang benar-benar tersedia saat ini. Sistem akan mencatatnya sebagai saldo awal, bukan sebagai penjualan atau pembelian baru.</p><label className="mt-3 block text-xs font-bold">Stok awal ({trackingProduct.satuan})<input required type="number" min="0" step="0.001" value={trackingForm.stok} onChange={e=>setTrackingForm(v=>({...v,stok:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">HPP / biaya per unit<input required type="number" min="0" step="1" value={trackingForm.harga_pokok} onChange={e=>setTrackingForm(v=>({...v,harga_pokok:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><label className="mt-3 block text-xs font-bold">Batas stok minimum<input required type="number" min="0" step="0.001" value={trackingForm.stok_minimum} onChange={e=>setTrackingForm(v=>({...v,stok_minimum:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label><div className="mt-4 flex gap-2"><button type="button" onClick={()=>setTrackingProduct(null)} className="flex-1 rounded-xl border border-slate-200 p-3 text-sm font-bold">Batal</button><button disabled={busy} className="flex-1 rounded-xl bg-emerald-700 p-3 text-sm font-bold text-white">{busy?'Menyimpan…':'Aktifkan stok'}</button></div></form></div>}

    {showProduct&&<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveProduct} className="my-6 w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl"><div className="flex justify-between"><b>Tambah produk inventaris</b><button type="button" onClick={()=>setShowProduct(false)}>✕</button></div><div className="mt-3 grid grid-cols-2 gap-2">{(['nama','sku','kategori','satuan','harga','harga_pokok','stok','stok_minimum'] as const).map(k=><label key={k} className="text-xs font-bold capitalize">{k.replace('_',' ')}<input required={k==='nama'} type={['harga','harga_pokok','stok','stok_minimum'].includes(k)?'number':'text'} min="0" step={['stok','stok_minimum'].includes(k)?'0.001':'1'} value={productForm[k]} onChange={e=>setProductForm(v=>({...v,[k]:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 p-3"/></label>)}</div><label className="mt-3 block text-xs font-bold">Jenis<select value={productForm.jenis_item} onChange={e=>setProductForm(v=>({...v,jenis_item:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="merchandise">Barang dagangan</option><option value="raw_material">Bahan baku</option><option value="work_in_progress">Barang dalam proses</option><option value="finished_good">Barang jadi</option><option value="service">Jasa</option></select></label><p className="mt-2 text-[11px] text-slate-500">Bahan baku dan barang dalam proses boleh memiliki harga jual 0. Untuk jasa stok fisik akan dinonaktifkan.</p><button disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-700 p-3 text-sm font-bold text-white">Simpan produk</button></form></div>}
    {deleteTarget&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><b>Hapus produk {deleteTarget.nama}?</b><p className="mt-2 text-xs leading-5 text-slate-600">Produk akan hilang dari Kasir, Inventaris, dan Cek Harga. Riwayat transaksi dan mutasi stok yang sudah tercatat tidak berubah.</p><div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={()=>setDeleteTarget(null)} className="flex-1 rounded-xl border border-slate-200 p-3 text-sm font-bold">Batal</button><button type="button" disabled={busy} onClick={deleteProduct} className="flex-1 rounded-xl bg-red-600 p-3 text-sm font-bold text-white">{busy?'Menghapus…':'Ya, hapus'}</button></div></div></div>}
  </div>;
}
