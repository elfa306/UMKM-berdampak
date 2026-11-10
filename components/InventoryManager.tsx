'use client';
import { useCallback,useEffect,useMemo,useState,type FormEvent } from 'react';
import { CheckCircle2,Pencil,Package,Plus,Search,Trash2,X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';
import { rupiah } from '@/lib/accounting';

type Product={id:string;sku:string|null;nama:string;kategori:string;jenis_item:'merchandise'|'finished_good'|'service';satuan:string;harga:number;harga_pokok:number;aktif:boolean};
type Form={nama:string;sku:string;kategori:string;jenis_item:Product['jenis_item'];satuan:string;harga:string;harga_pokok:string};
const EMPTY:Form={nama:'',sku:'',kategori:'Umum',jenis_item:'merchandise',satuan:'pcs',harga:'',harga_pokok:''};
const SAMPLE:Product[]=[
{id:'sample-1',sku:'KOP-01',nama:'Kopi Cava Latte',kategori:'Minuman',jenis_item:'finished_good',satuan:'cup',harga:18000,harga_pokok:8500,aktif:true},
{id:'sample-2',sku:'ROT-01',nama:'Roti Bakar Kaya',kategori:'Makanan',jenis_item:'finished_good',satuan:'porsi',harga:15000,harga_pokok:6800,aktif:true},
];
const KIND:Record<Product['jenis_item'],string>={merchandise:'Barang dagangan',finished_good:'Produk sendiri',service:'Jasa / layanan'};

export default function InventoryManager(){
 const [userId,setUserId]=useState(''),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('Semua');
 const [showForm,setShowForm]=useState(false),[editing,setEditing]=useState<Product|null>(null),[deleting,setDeleting]=useState<Product|null>(null),[form,setForm]=useState<Form>(EMPTY);
 const reload=useCallback(async()=>{
  const {data:{user},error:authError}=await supabase.auth.getUser();if(authError)throw authError;
  if(!user){setUserId('guest');setProducts(SAMPLE);return;}
  setUserId(user.id);
  const {data,error}=await supabase.from('products').select('id,sku,nama,kategori,jenis_item,satuan,harga,harga_pokok,aktif')
   .eq('user_id',user.id).eq('aktif',true).in('jenis_item',['merchandise','finished_good','service']).order('nama');
  if(error)throw error;
  setProducts((data??[]).map(p=>({...p,jenis_item:p.jenis_item as Product['jenis_item'],harga:Number(p.harga??0),harga_pokok:Number(p.harga_pokok??0)})));
 },[]);
 useEffect(()=>{let live=true;reload().catch(e=>{if(live)setError(e instanceof Error?e.message:'Katalog gagal dimuat.');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[reload]);
 const categories=useMemo(()=>['Semua',...Array.from(new Set(products.map(p=>p.kategori||'Umum'))).sort()],[products]);
 const visible=useMemo(()=>products.filter(p=>{const q=search.trim().toLowerCase();return(!q||`${p.nama} ${p.sku??''} ${p.kategori}`.toLowerCase().includes(q))&&(category==='Semua'||(p.kategori||'Umum')===category);}),[products,search,category]);
 const averageGap=products.length?products.reduce((s,p)=>s+p.harga-p.harga_pokok,0)/products.length:0;
 function openCreate(){setEditing(null);setForm(EMPTY);setError('');setNotice('');setShowForm(true);}
 function openEdit(p:Product){setEditing(p);setForm({nama:p.nama,sku:p.sku??'',kategori:p.kategori||'Umum',jenis_item:p.jenis_item,satuan:p.satuan||'pcs',harga:String(p.harga),harga_pokok:String(p.harga_pokok)});setError('');setNotice('');setShowForm(true);}
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;const sale=Number(form.harga),cost=Number(form.harga_pokok);
  if(form.nama.trim().length<2)return setError('Nama produk minimal 2 karakter.');
  if(!Number.isSafeInteger(sale)||sale<=0)return setError('Harga jual harus lebih dari Rp0.');
  if(!Number.isSafeInteger(cost)||cost<0)return setError('Harga beli harus berupa angka Rp0 atau lebih.');
  setBusy(true);setError('');setNotice('');
  try{
   const values={nama:form.nama.trim(),sku:form.sku.trim()||null,kategori:form.kategori.trim()||'Umum',jenis_item:form.jenis_item,satuan:form.satuan.trim()||'pcs',harga:sale,harga_pokok:cost};
   if(userId==='guest')setProducts(old=>editing?old.map(p=>p.id===editing.id?{...p,...values}:p):[{id:`guest-${Date.now()}`,...values,aktif:true},...old]);
   else if(editing){
    const {error}=await supabase.rpc('update_inventory_catalog_product',{p_product_id:editing.id,p_name:values.nama,p_sku:values.sku,p_category:values.kategori,p_item_type:values.jenis_item,p_unit:values.satuan,p_sale_price:values.harga,p_unit_cost:values.harga_pokok});
    if(error)throw error;await reload();
   }else{
    const {error}=await supabase.rpc('create_inventory_product',{p_sku:values.sku,p_name:values.nama,p_category:values.kategori,p_item_type:values.jenis_item,p_unit:values.satuan,p_sale_price:values.harga,p_unit_cost:values.harga_pokok,p_stock:0,p_min_stock:0,p_track_stock:false});
    if(error)throw error;await reload();
   }
   setShowForm(false);setEditing(null);setForm(EMPTY);setNotice(editing?'Produk berhasil diperbarui.':'Produk berhasil ditambahkan ke katalog.');
  }catch(e){setError(e instanceof Error?e.message:'Produk gagal disimpan.');}finally{setBusy(false);}
 }
 async function remove(){
  if(!deleting||busy)return;setBusy(true);setError('');
  try{
   if(userId==='guest')setProducts(old=>old.filter(p=>p.id!==deleting.id));
   else{const {error}=await supabase.rpc('delete_inventory_product',{p_product_id:deleting.id});if(error)throw error;await reload();}
   setNotice(`${deleting.nama} dihapus dari katalog aktif.`);setDeleting(null);
  }catch(e){setError(e instanceof Error?e.message:'Produk gagal dihapus.');}finally{setBusy(false);}
 }
 return <div className="wrap">
  <div className="header-app"><div><h1>Katalog Produk</h1><p>Daftar menu atau produk beserta harga beli dan harga jual.</p></div><button type="button" onClick={openCreate} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#CEE5D6] px-4 py-2.5 text-xs font-extrabold text-[#103A57] sm:mt-0"><Plus size={15}/> Tambah Produk</button></div>
  {error&&<div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">{error}</div>}
  {notice&&<div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800"><CheckCircle2 size={16}/>{notice}</div>}
  <div className="grid grid-cols-2 gap-3">
   <div className="card"><p className="text-[11px] font-bold uppercase text-slate-500">Produk terdaftar</p><p className="mt-2 text-2xl font-black text-[#103A57]">{products.length}</p><p className="mt-1 text-[10px] text-slate-400">Menu dan layanan aktif</p></div>
   <div className="card"><p className="text-[11px] font-bold uppercase text-slate-500">Rata-rata selisih harga</p><p className="mt-2 text-xl font-black text-[#103A57]">{rupiah(averageGap)}</p><p className="mt-1 text-[10px] text-slate-400">Harga jual dikurangi harga beli per produk</p></div>
  </div>
  <div className="rounded-2xl border border-[#307B8E]/15 bg-white/80 p-4 text-xs leading-5 text-slate-600">Harga beli/HPP menjadi acuan biaya dan estimasi selisih harga. Pembelian sebenarnya tetap dicatat melalui <b>Catat Transaksi → Pengeluaran</b>. CAVA tidak menghitung jumlah stok atau sisa bahan.</div>
  <div className="relative"><Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama produk, SKU, atau kategori..." className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-[#103A57]"/></div>
  {categories.length>1&&<div className="flex gap-2 overflow-x-auto pb-1">{categories.map(c=><button key={c} type="button" onClick={()=>setCategory(c)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[11px] font-bold ${category===c?'bg-[#103A57] text-white':'border border-slate-200 bg-white text-slate-600'}`}>{c}</button>)}</div>}
  {loading?<div className="card py-12 text-center text-sm text-slate-500">Memuat katalog...</div>:visible.length?<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
   {visible.map(p=>{const gap=p.harga-p.harga_pokok;return <article key={p.id} className="flex flex-col justify-between rounded-3xl border border-[#307B8E]/15 bg-white p-4 shadow-sm">
    <div><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-[#307B8E]">{p.kategori||'Umum'}{p.sku?` · ${p.sku}`:''}</p><h2 className="mt-1 truncate text-sm font-black text-[#103A57]">{p.nama}</h2></div><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{KIND[p.jenis_item]}</span></div>
     <p className="mt-1 text-[10px] text-slate-400">Satuan: {p.satuan||'unit'}</p>
     <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3"><div><p className="text-[10px] text-slate-400">Harga beli / HPP</p><p className="mt-1 text-sm font-bold text-slate-700">{rupiah(p.harga_pokok)}</p></div><div><p className="text-[10px] text-slate-400">Harga jual</p><p className="mt-1 text-sm font-black text-[#103A57]">{rupiah(p.harga)}</p></div></div>
     <div className={`mt-3 rounded-xl px-3 py-2.5 ${gap>=0?'bg-emerald-50 text-emerald-800':'bg-rose-50 text-rose-700'}`}><p className="text-[10px] font-semibold">Selisih harga per unit (estimasi)</p><p className="mt-0.5 text-sm font-black">{rupiah(gap)}</p></div>
    </div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3"><button type="button" onClick={()=>openEdit(p)} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#307B8E]"><Pencil size={14}/> Ubah</button><button type="button" onClick={()=>setDeleting(p)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600"><Trash2 size={14}/> Hapus</button></div>
   </article>})}
  </div>:<div className="rounded-3xl border border-dashed border-slate-300 bg-white p-9 text-center"><Package size={34} className="mx-auto text-slate-300"/><h2 className="mt-3 text-sm font-black text-[#103A57]">{search?'Produk tidak ditemukan':'Belum ada produk di katalog'}</h2><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{search?'Coba kata kunci lain.':'Tambahkan menu beserta harga beli dan harga jualnya.'}</p>{!search&&<button type="button" onClick={openCreate} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#103A57] px-4 py-2.5 text-xs font-bold text-white"><Plus size={14}/> Tambah Produk</button>}</div>}
  <BottomNav/>
  {showForm&&<div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"><form onSubmit={save} className="my-6 w-full max-w-lg space-y-4 rounded-3xl border border-[#307B8E]/20 bg-white p-6 shadow-2xl">
   <div className="flex items-center justify-between border-b border-slate-100 pb-3"><h2 className="text-base font-extrabold text-[#103A57]">{editing?'Ubah Produk':'Tambah Produk'}</h2><button type="button" onClick={()=>setShowForm(false)} className="rounded-lg p-1 text-slate-400"><X size={18}/></button></div>
   <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
    <label className="space-y-1 sm:col-span-2"><span className="font-bold text-slate-700">Nama produk / menu *</span><input required minLength={2} maxLength={100} value={form.nama} onChange={e=>setForm(v=>({...v,nama:e.target.value}))} placeholder="Contoh: Kopi Susu Aren" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">Kategori</span><input maxLength={40} value={form.kategori} onChange={e=>setForm(v=>({...v,kategori:e.target.value}))} placeholder="Makanan, Minuman" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">SKU (opsional)</span><input maxLength={32} value={form.sku} onChange={e=>setForm(v=>({...v,sku:e.target.value}))} placeholder="KOP-01" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">Jenis produk</span><select value={form.jenis_item} onChange={e=>setForm(v=>({...v,jenis_item:e.target.value as ProductForm['jenis_item']}))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"><option value="merchandise">Barang dagangan</option><option value="finished_good">Produk sendiri</option><option value="service">Jasa / layanan</option></select></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">Satuan</span><input maxLength={20} value={form.satuan} onChange={e=>setForm(v=>({...v,satuan:e.target.value}))} placeholder="pcs, cup, porsi" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">Harga beli / HPP per unit (Rp) *</span><input required type="number" min="0" step="1" value={form.harga_pokok} onChange={e=>setForm(v=>({...v,harga_pokok:e.target.value}))} placeholder="8500" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
    <label className="space-y-1"><span className="font-bold text-slate-700">Harga jual per unit (Rp) *</span><input required type="number" min="1" step="1" value={form.harga} onChange={e=>setForm(v=>({...v,harga:e.target.value}))} placeholder="18000" className="w-full rounded-xl border border-slate-200 px-3 py-3 outline-none focus:ring-2 focus:ring-[#103A57]"/></label>
   </div>
   <div className="flex gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={()=>setShowForm(false)} className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-bold text-slate-600">Batal</button><button type="submit" disabled={busy} className="flex-1 rounded-xl bg-[#103A57] py-3 text-xs font-bold text-white disabled:opacity-50">{busy?'Menyimpan...':editing?'Simpan Perubahan':'Simpan Produk'}</button></div>
  </form></div>}
  {deleting&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4"><div className="w-full max-w-sm space-y-4 rounded-3xl border border-rose-200 bg-white p-6 shadow-2xl"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700"><Trash2 size={23}/></div><div className="text-center"><h2 className="text-base font-black">Hapus {deleting.nama}?</h2><p className="mt-1 text-xs leading-5 text-slate-500">Produk diarsipkan dari katalog aktif. Riwayat transaksi lama tetap tersimpan.</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>setDeleting(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600">Batal</button><button type="button" disabled={busy} onClick={remove} className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busy?'Menghapus...':'Ya, Hapus'}</button></div></div></div>}
 </div>;
}
