'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { 
  AlertTriangle, 
  Boxes, 
  Package, 
  RefreshCw, 
  Search, 
  ShieldCheck, 
  Trash2, 
  Plus, 
  ArrowUpDown, 
  SlidersHorizontal,
  X,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Store
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';
import { Press, Rise } from '@/components/Motion';
import { rupiah } from '@/lib/accounting';

export type Product = {
  id: string;
  sku: string | null;
  nama: string;
  kategori: string;
  jenis_item: string;
  satuan: string;
  harga: number;
  harga_pokok: number;
  stok: number;
  stok_minimum: number;
  lacak_stok: boolean;
  aktif: boolean;
};

export type Movement = {
  id: string;
  product_id: string;
  movement_type: string;
  quantity_delta: number;
  unit_cost: number;
  total_cost: number;
  note: string | null;
  created_at: string;
};

type Tab = 'products' | 'movements';

const ITEM_LABEL: Record<string, string> = {
  merchandise: 'Barang dagangan',
  raw_material: 'Bahan baku',
  work_in_progress: 'Barang dalam proses',
  finished_good: 'Barang jadi',
  service: 'Jasa',
};

const MOVE_LABEL: Record<string, string> = {
  opening: 'Stok awal',
  purchase: 'Pembelian persediaan',
  sale: 'Penjualan kasir',
  adjustment_in: 'Penyesuaian masuk',
  adjustment_out: 'Penyesuaian keluar',
  return_in: 'Retur pelanggan',
  return_out: 'Retur ke pemasok',
  waste: 'Rusak / kedaluwarsa',
};

// Initial realistic UMKM sample products matching CAVA Beranda data
const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    sku: 'CK-001',
    nama: 'Kopi Cava Latte',
    kategori: 'Minuman',
    jenis_item: 'finished_good',
    satuan: 'cup',
    harga: 18000,
    harga_pokok: 8500,
    stok: 24,
    stok_minimum: 10,
    lacak_stok: true,
    aktif: true,
  },
  {
    id: 'prod-2',
    sku: 'RB-002',
    nama: 'Roti Bakar Kaya',
    kategori: 'Makanan',
    jenis_item: 'finished_good',
    satuan: 'porsi',
    harga: 15000,
    harga_pokok: 6800,
    stok: 18,
    stok_minimum: 8,
    lacak_stok: true,
    aktif: true,
  },
  {
    id: 'prod-3',
    sku: 'BB-003',
    nama: 'Gula Pasir Kristal',
    kategori: 'Bahan Baku',
    jenis_item: 'raw_material',
    satuan: 'kg',
    harga: 17500,
    harga_pokok: 14000,
    stok: 2,
    stok_minimum: 5,
    lacak_stok: true,
    aktif: true,
  },
  {
    id: 'prod-4',
    sku: 'BB-004',
    nama: 'Susu UHT Fresh Milk 1L',
    kategori: 'Bahan Baku',
    jenis_item: 'raw_material',
    satuan: 'kotak',
    harga: 21000,
    harga_pokok: 17500,
    stok: 6,
    stok_minimum: 4,
    lacak_stok: true,
    aktif: true,
  },
  {
    id: 'prod-5',
    sku: 'BB-005',
    nama: 'Cup Minuman 16oz + Tutup',
    kategori: 'Kemasan',
    jenis_item: 'merchandise',
    satuan: 'pcs',
    harga: 600,
    harga_pokok: 420,
    stok: 120,
    stok_minimum: 50,
    lacak_stok: true,
    aktif: true,
  },
];

const SAMPLE_MOVEMENTS: Movement[] = [
  {
    id: 'mov-1',
    product_id: 'prod-3',
    movement_type: 'adjustment_out',
    quantity_delta: -3,
    unit_cost: 14000,
    total_cost: 42000,
    note: 'Pemakaian produksi batch pagi',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'mov-2',
    product_id: 'prod-1',
    movement_type: 'sale',
    quantity_delta: -5,
    unit_cost: 8500,
    total_cost: 42500,
    note: 'Penjualan kasir #INV-102',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'mov-3',
    product_id: 'prod-4',
    movement_type: 'purchase',
    quantity_delta: 10,
    unit_cost: 17500,
    total_cost: 175000,
    note: 'Restock mingguan distributor',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

export default function InventoryManager() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [tab, setTab] = useState<Tab>('products');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Modals state
  const [showProduct, setShowProduct] = useState(false);
  const [productForm, setProductForm] = useState({
    sku: '',
    nama: '',
    kategori: 'Umum',
    jenis_item: 'merchandise',
    satuan: 'pcs',
    harga: '',
    harga_pokok: '',
    stok: '0',
    stok_minimum: '5',
  });

  const [trackingProduct, setTrackingProduct] = useState<Product | null>(null);
  const [trackingForm, setTrackingForm] = useState({
    stok: '0',
    harga_pokok: '0',
    stok_minimum: '5',
  });

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    productId: '',
    movementType: 'adjustment_in',
    qty: '1',
    unitCost: '0',
    note: '',
  });

  const reload = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Fallback for guest mode / local simulation
        setUserId('guest');
        setProducts(SAMPLE_PRODUCTS);
        setMovements(SAMPLE_MOVEMENTS);
        return;
      }

      setUserId(user.id);
      const [p, m] = await Promise.all([
        supabase
          .from('products')
          .select('id,sku,nama,kategori,jenis_item,satuan,harga,harga_pokok,stok,stok_minimum,lacak_stok,aktif')
          .eq('user_id', user.id)
          .eq('aktif', true)
          .order('nama'),
        supabase
          .from('inventory_movements')
          .select('id,product_id,movement_type,quantity_delta,unit_cost,total_cost,note,created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

      if (p.data && p.data.length > 0) {
        setProducts(
          p.data.map((x) => ({
            ...x,
            harga: Number(x.harga),
            harga_pokok: Number(x.harga_pokok),
            stok: Number(x.stok),
            stok_minimum: Number(x.stok_minimum),
          })) as Product[]
        );
      } else {
        setProducts(SAMPLE_PRODUCTS);
      }

      if (m.data && m.data.length > 0) {
        setMovements(
          m.data.map((x) => ({
            ...x,
            quantity_delta: Number(x.quantity_delta),
            unit_cost: Number(x.unit_cost),
            total_cost: Number(x.total_cost),
          })) as Movement[]
        );
      } else {
        setMovements(SAMPLE_MOVEMENTS);
      }
    } catch (err) {
      console.error(err);
      setProducts(SAMPLE_PRODUCTS);
      setMovements(SAMPLE_MOVEMENTS);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    reload()
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Data inventaris gagal dimuat.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reload]);

  const stockable = products.filter((p) => p.jenis_item !== 'service');

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.kategori) set.add(p.kategori);
    });
    return Array.from(set);
  }, [products]);

  const visible = useMemo(() => {
    return products.filter((p) => {
      const matchSearch = `${p.nama} ${p.sku ?? ''} ${p.kategori}`
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchCat = filterCategory === 'all' || p.kategori === filterCategory;
      return matchSearch && matchCat;
    });
  }, [products, search, filterCategory]);

  const lowStock = stockable.filter((p) => p.lacak_stok && p.stok_minimum > 0 && p.stok <= p.stok_minimum);
  const tracked = stockable.filter((p) => p.lacak_stok);
  const totalStockQty = tracked.reduce((sum, p) => sum + p.stok, 0);
  const inventoryValue = tracked.reduce((sum, p) => sum + p.stok * p.harga_pokok, 0);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Save new product
  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (userId === 'guest') {
        const newProd: Product = {
          id: `guest-${Date.now()}`,
          sku: productForm.sku || `SKU-${Date.now().toString().slice(-4)}`,
          nama: productForm.nama,
          kategori: productForm.kategori || 'Umum',
          jenis_item: productForm.jenis_item,
          satuan: productForm.satuan || 'pcs',
          harga: Number(productForm.harga || 0),
          harga_pokok: Number(productForm.harga_pokok || 0),
          stok: Number(productForm.stok || 0),
          stok_minimum: Number(productForm.stok_minimum || 5),
          lacak_stok: productForm.jenis_item !== 'service',
          aktif: true,
        };
        setProducts((prev) => [newProd, ...prev]);
        setShowProduct(false);
        setProductForm({
          sku: '',
          nama: '',
          kategori: 'Umum',
          jenis_item: 'merchandise',
          satuan: 'pcs',
          harga: '',
          harga_pokok: '',
          stok: '0',
          stok_minimum: '5',
        });
        setNotice('Produk berhasil ditambahkan.');
        return;
      }

      const { error: rpcError } = await supabase.rpc('create_inventory_product', {
        p_sku: productForm.sku || null,
        p_name: productForm.nama,
        p_category: productForm.kategori,
        p_item_type: productForm.jenis_item,
        p_unit: productForm.satuan,
        p_sale_price: Number(productForm.harga || 0),
        p_unit_cost: Number(productForm.harga_pokok || 0),
        p_stock: Number(productForm.stok || 0),
        p_min_stock: Number(productForm.stok_minimum || 0),
        p_track_stock: productForm.jenis_item !== 'service',
      });
      if (rpcError) throw rpcError;

      setShowProduct(false);
      setProductForm({
        sku: '',
        nama: '',
        kategori: 'Umum',
        jenis_item: 'merchandise',
        satuan: 'pcs',
        harga: '',
        harga_pokok: '',
        stok: '0',
        stok_minimum: '5',
      });
      await reload();
      setNotice('Produk berhasil ditambahkan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Produk gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  // Stock Adjustment
  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustForm.productId) {
      setError('Pilih produk terlebih dahulu.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const qtyNumber = Number(adjustForm.qty);
      const isOut = ['adjustment_out', 'return_out', 'waste'].includes(adjustForm.movementType);
      const delta = isOut ? -Math.abs(qtyNumber) : Math.abs(qtyNumber);

      if (userId === 'guest') {
        const prod = productById.get(adjustForm.productId);
        if (prod) {
          const updatedStock = Math.max(0, prod.stok + delta);
          setProducts((prev) =>
            prev.map((p) => (p.id === prod.id ? { ...p, stok: updatedStock } : p))
          );
          const newMove: Movement = {
            id: `mov-${Date.now()}`,
            product_id: prod.id,
            movement_type: adjustForm.movementType,
            quantity_delta: delta,
            unit_cost: Number(adjustForm.unitCost || prod.harga_pokok),
            total_cost: Math.abs(delta) * Number(adjustForm.unitCost || prod.harga_pokok),
            note: adjustForm.note || 'Penyesuaian stok lokal',
            created_at: new Date().toISOString(),
          };
          setMovements((prev) => [newMove, ...prev]);
        }
        setShowAdjustmentModal(false);
        setAdjustForm({ productId: '', movementType: 'adjustment_in', qty: '1', unitCost: '0', note: '' });
        setNotice('Mutasi persediaan berhasil dicatat.');
        return;
      }

      const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
        p_product_id: adjustForm.productId,
        p_movement_type: adjustForm.movementType,
        p_quantity: Number(adjustForm.qty),
        p_unit_cost: Number(adjustForm.unitCost || 0),
        p_note: adjustForm.note,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (rpcError) throw rpcError;

      setShowAdjustmentModal(false);
      setAdjustForm({ productId: '', movementType: 'adjustment_in', qty: '1', unitCost: '0', note: '' });
      await reload();
      setNotice('Mutasi persediaan berhasil dicatat.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mutasi stok gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  // Delete product
  async function deleteProduct() {
    if (!deleteTarget) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (userId === 'guest') {
        setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        setNotice(`Produk ${deleteTarget.nama} berhasil dihapus.`);
        setDeleteTarget(null);
        return;
      }

      const { error: rpcError } = await supabase.rpc('delete_inventory_product', {
        p_product_id: deleteTarget.id,
      });
      if (rpcError) throw rpcError;

      const name = deleteTarget.nama;
      setDeleteTarget(null);
      await reload();
      setNotice(`Produk ${name} dihapus.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Produk gagal dihapus.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      {/* Header */}
      <div className="header-app">
        <div>
          <h1>
            Inventaris &amp; Stok
          </h1>
          <p>
            Kelola katalog produk, biaya HPP, dan mutasi persediaan harian.
          </p>
        </div>

        <div className="flex items-center gap-2 mt-3 sm:mt-0">
          <button
            type="button"
            onClick={() => setShowAdjustmentModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition"
          >
            <ArrowUpDown size={14} />
            <span>Mutasi Stok</span>
          </button>
          <button
            type="button"
            onClick={() => setShowProduct(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#CEE5D6] text-[#103A57] text-xs font-bold hover:bg-white transition"
          >
            <Plus size={15} />
            <span>Tambah Produk</span>
          </button>
        </div>
      </div>

      {/* Alert Notices */}
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} className="text-[#366B2B]" />
          <span>{notice}</span>
        </div>
      )}

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Total Produk</span>
            <Boxes size={18} className="text-[#103A57]" />
          </div>
          <p className="mt-2 text-xl font-black text-[#103A57]">{products.length}</p>
          <span className="text-[10px] text-slate-400 font-semibold">{tracked.length} lacak stok fisik</span>
        </div>

        <div className="card">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Stok Fisik</span>
            <Package size={18} className="text-[#307B8E]" />
          </div>
          <p className="mt-2 text-xl font-black text-[#103A57]">{totalStockQty}</p>
          <span className="text-[10px] text-slate-400 font-semibold">Total unit tersedia</span>
        </div>

        <div className="card">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Nilai Aset Stok</span>
            <ShieldCheck size={18} className="text-[#366B2B]" />
          </div>
          <p className="mt-2 text-xl font-black text-[#103A57]">{rupiah(inventoryValue)}</p>
          <span className="text-[10px] text-slate-400 font-semibold">Berdasarkan HPP satuan</span>
        </div>

        <div className={`rounded-2xl p-4 shadow-sm border ${
          lowStock.length > 0
            ? 'bg-amber-50/80 border-amber-300'
            : 'bg-white border-[#307B8E]/15'
        }`}>
          <div className="flex items-center justify-between text-slate-400">
            <span className={`text-[11px] font-bold uppercase ${
              lowStock.length > 0 ? 'text-amber-800' : 'text-slate-500'
            }`}>
              Stok Menipis
            </span>
            <AlertTriangle size={18} className={lowStock.length > 0 ? 'text-amber-600' : 'text-slate-400'} />
          </div>
          <p className={`mt-2 text-xl font-black ${
            lowStock.length > 0 ? 'text-amber-900' : 'text-[#103A57]'
          }`}>
            {lowStock.length}
          </p>
          <span className={`text-[10px] font-semibold ${
            lowStock.length > 0 ? 'text-amber-700' : 'text-slate-400'
          }`}>
            {lowStock.length > 0 ? 'Perlu segera diisi ulang' : 'Stok aman'}
          </span>
        </div>
      </div>

      {/* Tabs Switcher: Produk vs Riwayat Mutasi */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-white/70 border border-[#307B8E]/15">
        <button
          type="button"
          onClick={() => {
            setTab('products');
            setError('');
          }}
          className={`py-2.5 rounded-xl text-xs font-black transition-all ${
            tab === 'products'
              ? 'bg-[#103A57] text-white shadow-sm'
              : 'text-slate-600 hover:text-[#103A57]'
          }`}
        >
          Katalog Produk &amp; Stok ({products.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('movements');
            setError('');
          }}
          className={`py-2.5 rounded-xl text-xs font-black transition-all ${
            tab === 'movements'
              ? 'bg-[#103A57] text-white shadow-sm'
              : 'text-slate-600 hover:text-[#103A57]'
          }`}
        >
          Riwayat Mutasi Stok ({movements.length})
        </button>
      </div>

      {/* TAB 1: KATALOG PRODUK */}
      {tab === 'products' && (
        <div className="space-y-4">
          {/* Search & Category Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <div className="relative w-full flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama produk, SKU, atau kategori…"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {categories.length > 0 && (
              <div className="w-full sm:w-auto flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setFilterCategory('all')}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${
                    filterCategory === 'all'
                      ? 'bg-[#103A57] text-white'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  Semua ({products.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${
                      filterCategory === cat
                        ? 'bg-[#103A57] text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((p) => {
              const isLow = p.lacak_stok && p.stok <= p.stok_minimum;
              return (
                <div
                  key={p.id}
                  className="rounded-3xl bg-white p-4 shadow-sm border border-[#307B8E]/15 flex flex-col justify-between space-y-3 hover:border-[#307B8E]/30 transition"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-[#307B8E]">
                          {p.kategori || 'Umum'} · {p.sku || 'No SKU'}
                        </span>
                        <h3 className="text-sm font-black text-[#103A57] truncate mt-0.5">
                          {p.nama}
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                        {ITEM_LABEL[p.jenis_item] || p.jenis_item}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">Harga Jual</span>
                        <span className="font-black text-[#103A57]">{rupiah(p.harga)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">HPP (Modal)</span>
                        <span className="font-semibold text-slate-600">{rupiah(p.harga_pokok)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#CEE5D6]/30 border border-[#307B8E]/10">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 block">Status Stok Fisik</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-black ${isLow ? 'text-amber-800' : 'text-[#103A57]'}`}>
                            {p.lacak_stok ? `${p.stok} ${p.satuan}` : 'Tidak dilacak'}
                          </span>
                          {isLow && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                              <AlertTriangle size={10} /> Menipis
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        Min: {p.stok_minimum} {p.satuan}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustForm({
                          productId: p.id,
                          movementType: 'adjustment_in',
                          qty: '1',
                          unitCost: String(p.harga_pokok || 0),
                          note: `Koreksi stok ${p.nama}`,
                        });
                        setShowAdjustmentModal(true);
                      }}
                      className="text-xs font-bold text-[#307B8E] hover:underline"
                    >
                      + Sesuaikan Stok
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteTarget(p)}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-800 p-1"
                      title="Hapus produk"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}

            {!visible.length && (
              <div className="col-span-full rounded-3xl bg-white p-8 text-center text-slate-500 space-y-3 border border-slate-200">
                <Package size={36} className="mx-auto text-slate-300" />
                <p className="text-xs">
                  {search
                    ? 'Tidak ada produk yang cocok dengan pencarian.'
                    : 'Belum ada produk terdaftar. Klik "+ Tambah Produk" di atas untuk memulai.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RIWAYAT MUTASI STOK */}
      {tab === 'movements' && (
        <div className="space-y-3">
          <div className="rounded-3xl bg-white p-4 sm:p-5 shadow-sm border border-[#307B8E]/15">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-black text-[#103A57]">Log Mutasi Persediaan</h3>
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(true)}
                className="text-xs font-bold text-[#307B8E] hover:underline"
              >
                + Tambah Mutasi Baru
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {movements.map((m) => {
                const prod = productById.get(m.product_id);
                const isPositive = m.quantity_delta > 0;
                return (
                  <div key={m.id} className="py-3.5 flex items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-black text-[#103A57] truncate">
                        {prod?.nama || 'Produk dihapus'}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-[#307B8E]">
                          {MOVE_LABEL[m.movement_type] || m.movement_type}
                        </span>
                        <span>·</span>
                        <span>{m.note || 'Tanpa catatan'}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(m.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`text-sm font-black ${isPositive ? 'text-[#366B2B]' : 'text-[#991B1B]'}`}>
                        {isPositive ? `+${m.quantity_delta}` : m.quantity_delta} {prod?.satuan || 'unit'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-semibold">
                        @{rupiah(m.unit_cost || 0)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {!movements.length && (
                <div className="py-8 text-center text-xs text-slate-400">
                  Belum ada catatan mutasi persediaan.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Information Banner */}
      <div className="rounded-2xl bg-white/70 p-4 border border-[#307B8E]/15 flex items-start gap-3 text-xs text-slate-600">
        <ShieldCheck size={18} className="text-[#366B2B] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Mutasi persediaan terhubung langsung dengan penghitungan <b>HPP (Harga Pokok Penjualan)</b> pada laporan laba rugi bulanan dan mencegah stok negatif secara otomatis.
        </p>
      </div>

      <BottomNav />

      {/* ===================================================================
        * MODAL 1: TAMBAH PRODUK BARU
        * =================================================================== */}
      {showProduct && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <form
            onSubmit={saveProduct}
            className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4 border border-[#307B8E]/20"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-[#103A57]">Tambah Produk Inventaris</h3>
              <button
                type="button"
                onClick={() => setShowProduct(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-700">Nama Produk / Bahan *</label>
                <input
                  required
                  value={productForm.nama}
                  onChange={(e) => setProductForm((v) => ({ ...v, nama: e.target.value }))}
                  placeholder="Contoh: Kopi Susu Aren"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Kode SKU / Barcode</label>
                <input
                  value={productForm.sku}
                  onChange={(e) => setProductForm((v) => ({ ...v, sku: e.target.value }))}
                  placeholder="Mis. KOP-01"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Kategori</label>
                <input
                  value={productForm.kategori}
                  onChange={(e) => setProductForm((v) => ({ ...v, kategori: e.target.value }))}
                  placeholder="Mis. Minuman, Makanan"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Jenis Item</label>
                <select
                  value={productForm.jenis_item}
                  onChange={(e) => setProductForm((v) => ({ ...v, jenis_item: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                >
                  <option value="finished_good">Barang jadi (Siap Jual)</option>
                  <option value="merchandise">Barang dagangan / Retail</option>
                  <option value="raw_material">Bahan baku produksi</option>
                  <option value="service">Jasa (Tanpa stok fisik)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Satuan Unit</label>
                <input
                  value={productForm.satuan}
                  onChange={(e) => setProductForm((v) => ({ ...v, satuan: e.target.value }))}
                  placeholder="cup, porsi, kg, pcs"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Harga Jual (Rp) *</label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  required
                  value={productForm.harga}
                  onChange={(e) => setProductForm((v) => ({ ...v, harga: e.target.value }))}
                  placeholder="18000"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Harga Pokok / HPP (Rp) *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={productForm.harga_pokok}
                  onChange={(e) => setProductForm((v) => ({ ...v, harga_pokok: e.target.value }))}
                  placeholder="8500"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Stok Awal Fisik</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={productForm.stok}
                  onChange={(e) => setProductForm((v) => ({ ...v, stok: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Batas Minimum Peringatan</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={productForm.stok_minimum}
                  onChange={(e) => setProductForm((v) => ({ ...v, stok_minimum: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowProduct(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-[#103A57] text-white text-xs font-bold hover:bg-[#0c2d44] disabled:opacity-50"
              >
                {busy ? 'Menyimpan…' : 'Simpan Produk'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================
        * MODAL 2: PENYESUAIAN MUTASI STOK
        * =================================================================== */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <form
            onSubmit={saveAdjustment}
            className="my-6 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4 border border-[#307B8E]/20"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-[#103A57]">Catat Mutasi Stok</h3>
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Pilih Produk *</label>
                <select
                  required
                  value={adjustForm.productId}
                  onChange={(e) => {
                    const selId = e.target.value;
                    const p = productById.get(selId);
                    setAdjustForm((v) => ({
                      ...v,
                      productId: selId,
                      unitCost: p ? String(p.harga_pokok || 0) : v.unitCost,
                    }));
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                >
                  <option value="">-- Pilih produk yang dimutasi --</option>
                  {stockable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nama} (Stok sekarang: {p.stok} {p.satuan})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Jenis Mutasi</label>
                <select
                  value={adjustForm.movementType}
                  onChange={(e) => setAdjustForm((v) => ({ ...v, movementType: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                >
                  <option value="adjustment_in">Penyesuaian Masuk (+)</option>
                  <option value="purchase">Pembelian Stok Masuk (+)</option>
                  <option value="adjustment_out">Penyesuaian Keluar (-)</option>
                  <option value="waste">Barang Rusak / Basi / Kedaluwarsa (-)</option>
                  <option value="return_in">Retur dari Pembeli (+)</option>
                  <option value="return_out">Retur ke Pemasok (-)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Jumlah Unit *</label>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    required
                    value={adjustForm.qty}
                    onChange={(e) => setAdjustForm((v) => ({ ...v, qty: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Biaya Satuan (HPP)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={adjustForm.unitCost}
                    onChange={(e) => setAdjustForm((v) => ({ ...v, unitCost: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Keterangan / Alasan *</label>
                <input
                  required
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm((v) => ({ ...v, note: e.target.value }))}
                  placeholder="Mis. Stok opname akhir bulan / susu bocor"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#103A57]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-[#103A57] text-white text-xs font-bold hover:bg-[#0c2d44] disabled:opacity-50"
              >
                {busy ? 'Menyimpan…' : 'Simpan Mutasi'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================
        * MODAL 3: HAPUS PRODUK CONFIRMATION
        * =================================================================== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4 border border-rose-200">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-base font-black text-slate-900">
                Hapus Produk {deleteTarget.nama}?
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Produk akan diarsipkan dari katalog kasir dan inventaris aktif. Riwayat penjualan lama tetap aman.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={deleteProduct}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? 'Menghapus…' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
