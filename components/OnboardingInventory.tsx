'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus,Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
type Row={id:number;name:string;unit:string;buy:string;sale:string};
const blank=(id:number):Row=>({id,name:'',unit:'pcs',buy:'',sale:''});
const field='mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500';
export default function OnboardingInventory(){
 const router=useRouter();const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const [itemType,setItemType]=useState<'merchandise'|'finished_good'|'service'>('merchandise');const [rows,setRows]=useState<Row[]>([blank(1)]);const [nextId,setNextId]=useState(2);
 useEffect(()=>{let cancelled=false;(async()=>{
  const {data:{user},error:authError}=await supabase.auth.getUser();if(cancelled)return;if(authError||!user){router.replace('/login');return;}
  const {data:profile,error:profileError}=await supabase.from('business_profiles').select('jenis_usaha,onboarding_completed_at').eq('user_id',user.id).maybeSingle();
  if(cancelled)return;if(profileError){setError(profileError.message);setLoading(false);return;}if(!profile?.onboarding_completed_at){router.replace('/onboarding');return;}
  const {count,error:countError}=await supabase.from('products').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('aktif',true).in('jenis_item',['merchandise','finished_good','service']);
  if(cancelled)return;if(countError){setError(countError.message);setLoading(false);return;}if((count??0)>0){router.replace('/kasir');return;}
  setItemType(profile.jenis_usaha==='jasa'?'service':profile.jenis_usaha==='manufaktur'?'finished_good':'merchandise');setLoading(false);
 })().catch(e=>{if(!cancelled){setError(e instanceof Error?e.message:'Gagal memuat halaman.');setLoading(false);}});return()=>{cancelled=true;};},[router]);
 function change(id:number,patch:Partial<Row>){setRows(old=>old.map(r=>r.id===id?{...r,...patch}:r));}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(saving)return;setError('');const list=rows.filter(r=>r.name.trim()||r.buy||r.sale);
  if(!list.length){setError('Tambahkan minimal satu produk.');return;}
  for(let i=0;i<list.length;i++){const r=list[i],buy=Number(r.buy),sale=Number(r.sale);if(r.name.trim().length<2){setError(`Produk #${i+1}: nama minimal 2 karakter.`);return;}if(!Number.isSafeInteger(buy)||buy<0){setError(`Produk #${i+1}: harga beli harus 0 atau lebih.`);return;}if(!Number.isSafeInteger(sale)||sale<=0){setError(`Produk #${i+1}: harga jual harus lebih dari 0.`);return;}}
  setSaving(true);try{for(const r of list){const {error}=await supabase.rpc('create_inventory_product',{p_sku:null,p_name:r.name.trim(),p_category:'Umum',p_item_type:itemType,p_unit:r.unit.trim()||(itemType==='service'?'layanan':'pcs'),p_sale_price:Number(r.sale),p_unit_cost:Number(r.buy),p_stock:0,p_min_stock:0,p_track_stock:false});if(error)throw error;}router.replace('/kasir');router.refresh();}
  catch(e){setError(e instanceof Error?e.message:'Produk gagal disimpan.');}finally{setSaving(false);}
 }
 if(loading)return <main className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-xl text-center text-sm text-slate-500">{error||'Menyiapkan katalog produk...'}</div></main>;
 return <main className="min-h-screen bg-slate-50 px-4 py-6 pb-12"><div className="mx-auto grid max-w-2xl gap-5">
  <header><p className="m-0 text-xs font-bold uppercase tracking-[.16em] text-emerald-700">CAVA · PENGATURAN AWAL</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Daftarkan produk yang dijual</h1><p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">Masukkan nama menu atau produk beserta harga beli dan harga jual. Tidak perlu jumlah stok.</p></header>
  {error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
  <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
   <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-black text-slate-900">Katalog awal</h2><p className="mt-1 text-xs text-slate-500">Jenis: {itemType==='service'?'Jasa / layanan':itemType==='finished_good'?'Produk sendiri':'Barang dagangan'}</p></div><button type="button" onClick={()=>{setRows(old=>[...old,blank(nextId)]);setNextId(n=>n+1);}} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800"><Plus size={14}/> Tambah</button></div>
   <div className="mt-4 space-y-4">{rows.map((r,i)=><section key={r.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5">
    <div className="mb-3 flex items-center justify-between"><p className="text-xs font-extrabold text-slate-700">Produk #{i+1}</p>{rows.length>1&&<button type="button" onClick={()=>setRows(old=>old.filter(x=>x.id!==r.id))} aria-label={`Hapus produk ${i+1}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15}/></button>}</div>
    <label className="block text-xs font-bold text-slate-600">Nama produk / menu<input required minLength={2} maxLength={100} value={r.name} onChange={e=>change(r.id,{name:e.target.value})} placeholder="Contoh: Kopi Susu Aren" className={field}/></label>
    <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Satuan<input maxLength={20} value={r.unit} onChange={e=>change(r.id,{unit:e.target.value})} placeholder="pcs, cup, porsi" className={field}/></label><label className="text-xs font-bold text-slate-600">Harga beli / HPP (Rp)<input required type="number" min="0" step="1" value={r.buy} onChange={e=>change(r.id,{buy:e.target.value})} placeholder="8500" className={field}/></label></div>
    <label className="mt-3 block text-xs font-bold text-slate-600">Harga jual (Rp)<input required type="number" min="1" step="1" value={r.sale} onChange={e=>change(r.id,{sale:e.target.value})} placeholder="18000" className={field}/></label>
   </section>)}</div>
   <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-900">Harga beli menjadi acuan biaya produk. Pembelian sebenarnya dicatat melalui menu Pengeluaran. CAVA tidak mengelola stok atau sisa bahan.</div>
   <button type="submit" disabled={saving} className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-extrabold text-white disabled:opacity-50">{saving?'Menyimpan produk...':'Simpan dan buka kasir'}</button>
  </form>
 </div></main>;
}
