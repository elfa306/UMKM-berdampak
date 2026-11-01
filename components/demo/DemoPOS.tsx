'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, CirclePlus, ClipboardList, CreditCard, Minus, Package,
  Plus, Search, ShoppingBag, ShoppingCart, Trash2, X,
} from 'lucide-react';
import type { DemoPOSOrder, DemoPOSProduct } from '@/lib/demoPos.server';
import DemoQRCode from '@/components/demo/DemoQRCode';
import DemoStaticQrisPanel from '@/components/demo/DemoStaticQrisPanel';

type BusinessType = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
type Props = {
  businessName: string;
  businessType: BusinessType;
  mode: 'eksplorasi' | 'guided';
  initialSnapshot: { products: DemoPOSProduct[]; recentOrders: DemoPOSOrder[] };
};
type CartLine = { product: DemoPOSProduct; qty: number };
type PendingOrder = { id: string; invoiceNo: string; total: number; paymentMethod: string; method: 'cash' | 'qris'; qrContent?: string | null; qrUrl?: string | null; qrPayloadMissing?: boolean; expiresAt?: string | null; paymentStatus?: 'pending' | 'expired' | 'failed'; items: Array<{ name: string; qty: number; unit: string; unitPrice: number; subtotal: number }> };
type NewProductForm = {
  name: string; sku: string; category: string; itemType: 'merchandise' | 'finished_good' | 'service';
  unit: string; salePrice: string; unitCost: string; stock: string; minStock: string;
};

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const initialForm = (businessType: BusinessType): NewProductForm => ({
  name: '', sku: '', category: businessType === 'manufaktur' ? 'Barang jadi' : 'Umum',
  itemType: businessType === 'manufaktur' ? 'finished_good' : businessType === 'jasa' ? 'service' : 'merchandise',
  unit: businessType === 'jasa' ? 'layanan' : 'pcs', salePrice: '', unitCost: '', stock: businessType === 'jasa' ? '0' : '10', minStock: businessType === 'jasa' ? '0' : '2',
});

function formatDate(value: string): string {
  return new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
}

export default function DemoPOS({ businessName, businessType, mode, initialSnapshot }: Props) {
  const router = useRouter();
  const [products, setProducts] = useState(initialSnapshot.products);
  const [recentOrders, setRecentOrders] = useState(initialSnapshot.recentOrders);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qris'>('cash');
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [receipt, setReceipt] = useState<{ invoiceNo: string; total: number; paymentMethod: string } | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [showProductForm, setShowProductForm] = useState(false);
  const [form, setForm] = useState<NewProductForm>(() => initialForm(businessType));
  const [busy, setBusy] = useState<'order' | 'settle' | 'cancel' | 'product' | 'simulate' | 'status' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const categories = useMemo(() => ['Semua', ...Array.from(new Set(products.map((product) => product.category))).sort()], [products]);
  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesSearch = `${product.name} ${product.sku ?? ''}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'Semua' || product.category === category;
    return matchesSearch && matchesCategory;
  }), [products, search, category]);
  const cartLines: CartLine[] = useMemo(() => Object.entries(cart)
    .map(([id, qty]) => {
      const product = products.find((item) => item.id === id);
      return product ? { product, qty } : null;
    })
    .filter((line): line is CartLine => line !== null), [cart, products]);
  const total = cartLines.reduce((sum, line) => sum + Math.round(line.product.salePrice * line.qty), 0);
  const totalItems = cartLines.reduce((sum, line) => sum + line.qty, 0);

  async function reloadPOS() {
    const response = await fetch('/api/demo/pos', { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Data kasir gagal diperbarui.');
    setProducts(result.products as DemoPOSProduct[]);
    setRecentOrders(result.recentOrders as DemoPOSOrder[]);
  }

  function addToCart(product: DemoPOSProduct) {
    setError('');
    setNotice('');
    const currentQty = cart[product.id] ?? 0;
    if (product.tracksStock && currentQty + 1 > product.stock) {
      setError(`Stok ${product.name} hanya tersisa ${product.stock} ${product.unit}.`);
      return;
    }
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
  }

  function changeQty(product: DemoPOSProduct, delta: number) {
    setCart((current) => {
      const nextQty = (current[product.id] ?? 0) + delta;
      if (nextQty <= 0) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      if (product.tracksStock && nextQty > product.stock) {
        setError(`Stok ${product.name} tidak mencukupi.`);
        return current;
      }
      return { ...current, [product.id]: nextQty };
    });
  }

  async function createOrder() {
    if (!cartLines.length || pendingOrder) return;
    setBusy('order');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/demo/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ paymentMethod, items: cartLines.map((line) => ({ productId: line.product.id, qty: line.qty })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pesanan gagal dibuat.');
      setPendingOrder({
        id: result.order.id,
        invoiceNo: result.order.invoice_no,
        total: Number(result.order.total),
        paymentMethod: result.order.payment_method,
        method: paymentMethod,
        qrContent: result.paymentGateway?.qrContent ?? null,
        qrUrl: result.paymentGateway?.qrUrl ?? null,
        qrPayloadMissing: result.paymentGateway?.qrPayloadMissing ?? false,
        expiresAt: result.paymentGateway?.expiredAt ?? null,
        paymentStatus: 'pending',
        items: (result.items ?? []).map((item: { name: string; qty: number; unit: string; unitPrice: number; subtotal: number }) => ({
          name: item.name, qty: Number(item.qty), unit: item.unit, unitPrice: Number(item.unitPrice), subtotal: Number(item.subtotal),
        })),
      });
      setCart({});
      await reloadPOS();
      setNotice(paymentMethod === 'qris'
        ? result.paymentGateway?.qrPayloadMissing
          ? 'Belibayar menerima invoice, tetapi belum mengembalikan gambar/data QR. Invoice tetap pending; simulator Sandbox masih dapat digunakan untuk menguji webhook.'
          : 'QRIS Sandbox berhasil dibuat. Gunakan simulator untuk menguji pembayaran; stok menunggu webhook PAID.'
        : 'Invoice berhasil dibuat. Stok belum berkurang sampai pembayaran dikonfirmasi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pesanan gagal dibuat.');
    } finally {
      setBusy(null);
    }
  }

  async function settleOrder(action: 'paid' | 'cancel') {
    if (!pendingOrder) return;
    const isCancel = action === 'cancel';
    if (!isCancel && pendingOrder.method !== 'cash') {
      setError('Pembayaran QRIS hanya dapat dinyatakan berhasil setelah webhook Belibayar terverifikasi.');
      return;
    }
    if (isCancel && !window.confirm(pendingOrder.paymentStatus === 'expired' || pendingOrder.paymentStatus === 'failed' ? 'Tutup panel invoice ini?' : 'Batalkan invoice yang masih menunggu pembayaran?')) return;
    if (!isCancel && pendingOrder.method === 'cash' && !window.confirm('Pastikan uang tunai sudah diterima dari pelanggan. Konfirmasi pembayaran?')) return;
    if (isCancel && (pendingOrder.paymentStatus === 'expired' || pendingOrder.paymentStatus === 'failed')) {
      setPendingOrder(null);
      setNotice('Panel invoice ditutup. Status transaksi tetap tersimpan di riwayat.');
      return;
    }
    setBusy(isCancel ? 'cancel' : 'settle');
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/demo/pos/orders/${pendingOrder.id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Status pesanan gagal diperbarui.');
      if (action === 'paid') {
        setReceipt({ invoiceNo: pendingOrder.invoiceNo, total: pendingOrder.total, paymentMethod: pendingOrder.paymentMethod });
        setNotice('Pembayaran demonstrasi berhasil. Dashboard dan stok sudah diperbarui.');
      } else {
        setNotice('Invoice berhasil dibatalkan. Stok tidak berubah.');
      }
      setPendingOrder(null);
      await reloadPOS();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status pesanan gagal diperbarui.');
    } finally {
      setBusy(null);
    }
  }

  async function checkQrisStatus(showNotice = true) {
    if (!pendingOrder || pendingOrder.method !== 'qris') return;
    setBusy('status');
    setError('');
    try {
      const response = await fetch(`/api/demo/pos/orders/${pendingOrder.id}/status`, { credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Status pembayaran gagal diperiksa.');
      const orderStatus = result.order?.status as string | undefined;
      const paymentStatus = result.payment?.status as string | undefined;
      if (orderStatus === 'paid' && paymentStatus === 'paid') {
        setReceipt({ invoiceNo: pendingOrder.invoiceNo, total: pendingOrder.total, paymentMethod: pendingOrder.paymentMethod });
        setPendingOrder(null);
        setNotice('Webhook Belibayar terverifikasi. Pembayaran tercatat dan stok telah diperbarui.');
        await reloadPOS();
        router.refresh();
      } else if (orderStatus === 'expired' || paymentStatus === 'expired') {
        setPendingOrder((current) => current ? { ...current, paymentStatus: 'expired' } : current);
        if (showNotice) setNotice('QRIS telah kedaluwarsa. Buat invoice baru untuk mencoba kembali.');
        await reloadPOS();
      } else if (orderStatus === 'cancelled' || paymentStatus === 'failed') {
        setPendingOrder((current) => current ? { ...current, paymentStatus: 'failed' } : current);
        if (showNotice) setNotice('Pembayaran tidak berhasil atau invoice dibatalkan.');
        await reloadPOS();
      } else if (showNotice) {
        setNotice('Belum ada webhook PAID yang diterima. Pembayaran masih menunggu konfirmasi Belibayar.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status pembayaran gagal diperiksa.');
    } finally {
      setBusy(null);
    }
  }

  async function simulateQris(action: 'success' | 'expire') {
    if (!pendingOrder || pendingOrder.method !== 'qris' || pendingOrder.paymentStatus !== 'pending') return;
    setBusy('simulate');
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/demo/pos/orders/${pendingOrder.id}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Simulasi pembayaran gagal dikirim.');
      setNotice(action === 'success' ? 'Simulasi dikirim ke Belibayar. Menunggu webhook PAID...' : 'Simulasi kedaluwarsa dikirim. Menunggu webhook...');
      // Webhook dikirim oleh Belibayar; browser hanya memeriksa status, tidak melunasi order.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/demo/pos/orders/${pendingOrder.id}/status`, { credentials: 'same-origin', cache: 'no-store' });
        const statusResult = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusResult.error || 'Status pembayaran gagal diperiksa.');
        const orderStatus = statusResult.order?.status as string | undefined;
        const paymentStatus = statusResult.payment?.status as string | undefined;
        if (orderStatus === 'paid' && paymentStatus === 'paid') {
          setReceipt({ invoiceNo: pendingOrder.invoiceNo, total: pendingOrder.total, paymentMethod: pendingOrder.paymentMethod });
          setPendingOrder(null);
          setNotice('Pembayaran Sandbox berhasil diverifikasi melalui webhook. Stok dan dashboard diperbarui.');
          await reloadPOS();
          router.refresh();
          return;
        }
        if (orderStatus === 'expired' || paymentStatus === 'expired') {
          setPendingOrder((current) => current ? { ...current, paymentStatus: 'expired' } : current);
          setNotice('QRIS kedaluwarsa. Stok tidak berubah; buat invoice baru untuk mencoba lagi.');
          await reloadPOS();
          router.refresh();
          return;
        }
        if (orderStatus === 'cancelled' || paymentStatus === 'failed') {
          setPendingOrder((current) => current ? { ...current, paymentStatus: 'failed' } : current);
          setNotice('Pembayaran dibatalkan. Stok tidak berubah.');
          await reloadPOS();
          router.refresh();
          return;
        }
      }
      setNotice('Simulasi diterima. Webhook belum terlihat dalam 20 detik; gunakan tombol Periksa Status.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulasi pembayaran gagal.');
    } finally {
      setBusy(null);
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('product');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/demo/pos/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          ...form,
          salePrice: Number(form.salePrice),
          unitCost: Number(form.unitCost),
          stock: Number(form.stock),
          minStock: Number(form.minStock),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Produk gagal disimpan.');
      setShowProductForm(false);
      setForm(initialForm(businessType));
      await reloadPOS();
      router.refresh();
      setNotice('Produk berhasil ditambahkan ke katalog demo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Produk gagal disimpan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-5 text-slate-900 sm:px-6 sm:pt-7">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/demo/ruang" className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-700 hover:text-emerald-700"><ArrowLeft size={17} /> Kembali ke dashboard</Link>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-amber-800">DEMO MODE · KASIR</span>
        </header>

        <section className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl sm:p-7">
          <div>
            <p className="text-xs font-bold text-emerald-200">POINT OF SALE</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">Kasir {businessName}</h1>
            <p className="mt-2 text-sm text-slate-300">{mode === 'guided' ? 'Guided Demo' : 'Eksplorasi Bebas'} · Katalog dan transaksi hanya untuk sesi ini.</p>
          </div>
          <Link href="/demo/ruang" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/15">Lihat dashboard</Link>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)]">
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">Katalog produk</h2>
                <p className="mt-1 text-xs text-slate-500">Pilih produk atau layanan untuk dimasukkan ke keranjang.</p>
              </div>
              <button type="button" onClick={() => { setForm(initialForm(businessType)); setShowProductForm(true); }} disabled={!!pendingOrder} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"><CirclePlus size={16} /> Tambah produk</button>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari produk atau SKU..." className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500">
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            {visibleProducts.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleProducts.map((product) => {
                  const outOfStock = product.tracksStock && product.stock <= 0;
                  const inCart = cart[product.id] ?? 0;
                  return (
                    <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{product.category}</span>
                          <h3 className="mt-3 truncate text-sm font-black text-slate-900">{product.name}</h3>
                          <p className="mt-1 text-[11px] text-slate-500">{product.sku || 'Tanpa SKU'} · {product.unit}</p>
                        </div>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Package size={19} /></span>
                      </div>
                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-base font-black text-emerald-700">{rupiah.format(product.salePrice)}</p>
                          <p className={`mt-1 text-[10px] font-semibold ${outOfStock ? 'text-red-600' : 'text-slate-500'}`}>{product.tracksStock ? `Stok ${product.stock} ${product.unit}` : 'Layanan · tanpa stok fisik'}</p>
                        </div>
                        <button type="button" onClick={() => addToCart(product)} disabled={outOfStock || !!pendingOrder} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={14} /> Tambah</button>
                      </div>
                      {inCart > 0 && <p className="mt-2 text-[10px] font-bold text-emerald-700">{inCart} dalam keranjang</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Produk tidak ditemukan. Coba kata kunci lain atau tambahkan produk baru.</div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Keranjang</h2>
                  <p className="mt-1 text-xs text-slate-500">{totalItems} item dipilih</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShoppingCart size={19} /></span>
              </div>
              {cartLines.length ? (
                <div className="mt-4 space-y-3">
                  {cartLines.map(({ product, qty }) => (
                    <div key={product.id} className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-extrabold text-slate-800">{product.name}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{rupiah.format(product.salePrice)} × {qty}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => changeQty(product, -1)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Kurangi ${product.name}`}><Minus size={13} /></button>
                        <span className="w-6 text-center text-xs font-black tabular-nums">{qty}</span>
                        <button type="button" onClick={() => changeQty(product, 1)} disabled={product.tracksStock && qty >= product.stock} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label={`Tambah ${product.name}`}><Plus size={13} /></button>
                        <button type="button" onClick={() => setCart((current) => { const next = { ...current }; delete next[product.id]; return next; })} className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-red-500 hover:bg-red-50" aria-label={`Hapus ${product.name}`}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-bold text-slate-600">Total</span>
                    <span className="text-xl font-black text-slate-900">{rupiah.format(total)}</span>
                  </div>
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-extrabold text-slate-700">Metode pembayaran</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setPaymentMethod('cash')} className={`rounded-xl border p-3 text-left ${paymentMethod === 'cash' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                        <span className="flex items-center gap-2 text-xs font-extrabold"><CreditCard size={15} /> Tunai</span>
                        <span className="mt-1 block text-[10px] text-slate-500">Konfirmasi diterima</span>
                      </button>
                      <button type="button" onClick={() => setPaymentMethod('qris')} className={`rounded-xl border p-3 text-left ${paymentMethod === 'qris' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                        <span className="flex items-center gap-2 text-xs font-extrabold"><ShoppingBag size={15} /> QRIS demo</span>
                        <span className="mt-1 block text-[10px] text-slate-500">QRIS Dinamis · Belibayar Sandbox</span>
                      </button>
                    </div>
                    {paymentMethod === 'qris' && <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[10px] leading-5 text-amber-800">QRIS dinamis dibuat dari total invoice. Karena ini Sandbox, barcode tidak dapat dibayar dari aplikasi bank/e-wallet sungguhan; gunakan simulator pembayaran di bawah.</p>}
                  </div>
                  <button type="button" onClick={createOrder} disabled={!!busy || !!pendingOrder || total <= 0} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-50">
                    {busy === 'order' ? 'Membuat invoice...' : 'Buat invoice'}
                  </button>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-8 text-center">
                  <ShoppingCart size={25} className="mx-auto text-slate-300" />
                  <p className="mt-2 text-xs font-bold text-slate-700">Keranjang masih kosong</p>
                  <p className="mt-1 text-[11px] text-slate-500">Tambahkan produk dari katalog untuk memulai transaksi.</p>
                </div>
              )}
            </section>

            {pendingOrder && (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-amber-800"><ClipboardList size={18} /><h2 className="text-sm font-black">Invoice menunggu pembayaran</h2></div>
                <p className="mt-3 text-xs text-amber-900">{pendingOrder.invoiceNo}</p>
                <div className="mt-3 space-y-2 rounded-2xl border border-amber-200 bg-white/70 p-3">
                  {pendingOrder.items.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0"><p className="font-extrabold text-slate-800">{item.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{item.qty} {item.unit} × {rupiah.format(item.unitPrice)}</p></div>
                      <span className="shrink-0 font-bold text-slate-800">{rupiah.format(item.subtotal)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-amber-200 pt-2">
                    <span className="text-xs font-bold text-slate-600">Total invoice</span>
                    <span className="text-lg font-black text-slate-900">{rupiah.format(pendingOrder.total)}</span>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-600">{pendingOrder.paymentMethod}</p>
                {pendingOrder.method === 'qris' && (
                  <div className="mt-4 space-y-3 rounded-2xl border border-amber-200 bg-white p-3">
                    {pendingOrder.qrContent || pendingOrder.qrUrl ? (
                      <DemoQRCode value={pendingOrder.qrContent} imageUrl={pendingOrder.qrUrl} label="QRIS Dinamis Belibayar Sandbox" />
                    ) : <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{pendingOrder.qrPayloadMissing ? 'Belibayar sudah menerima transaksi, tetapi belum menyertakan data QR pada respons Charge maupun Inquiry Status. Invoice dipertahankan agar webhook tetap bisa dicocokkan. Untuk demonstrasi, gunakan simulator Sandbox di bawah. Jangan lakukan pembayaran sungguhan karena QR belum tersedia.' : 'Data QRIS tidak tersedia. Periksa respons Belibayar.'}</p>}
                    {pendingOrder.expiresAt && <p className="text-center text-[10px] text-slate-500">Berlaku sampai {formatDate(pendingOrder.expiresAt)}</p>}
                    <p className="rounded-xl bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">QRIS Sandbox hanya untuk pengujian dan tidak dapat dibayar memakai aplikasi bank/e-wallet sungguhan. Gunakan simulator di bawah. Stok belum berubah sampai webhook PAID terverifikasi.</p>
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-5 text-amber-900">{pendingOrder.method === 'cash' ? 'Konfirmasi hanya setelah uang tunai benar-benar diterima.' : pendingOrder.paymentStatus === 'expired' ? 'QRIS kedaluwarsa. Buat invoice baru untuk mengulang transaksi.' : pendingOrder.paymentStatus === 'failed' ? 'Pembayaran gagal atau dibatalkan.' : 'Stok belum dikurangi. Sistem menunggu webhook pembayaran dari Belibayar.'}</p>
                {pendingOrder.method === 'cash' ? (
                  <button type="button" onClick={() => settleOrder('paid')} disabled={!!busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">{busy === 'settle' ? 'Memproses...' : 'Konfirmasi tunai diterima'}</button>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => simulateQris('success')} disabled={!!busy || pendingOrder.paymentStatus !== 'pending'} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">{busy === 'simulate' ? 'Mengirim simulasi...' : 'Simulasikan berhasil'}</button>
                    <button type="button" onClick={() => simulateQris('expire')} disabled={!!busy || pendingOrder.paymentStatus !== 'pending'} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-3 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">Simulasikan kedaluwarsa</button>
                    <button type="button" onClick={() => checkQrisStatus()} disabled={!!busy} className="sm:col-span-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === 'status' ? 'Memeriksa...' : 'Periksa status pembayaran'}</button>
                  </div>
                )}
                <button type="button" onClick={() => settleOrder('cancel')} disabled={!!busy} className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">{pendingOrder.paymentStatus === 'expired' || pendingOrder.paymentStatus === 'failed' ? 'Tutup invoice' : 'Batalkan invoice'}</button>
              </section>
            )}

            {receipt && (
              <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 size={19} /><h2 className="text-sm font-black">Transaksi demo berhasil</h2></div>
                <p className="mt-3 text-xs text-emerald-900">{receipt.invoiceNo}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{rupiah.format(receipt.total)}</p>
                <p className="mt-1 text-[11px] text-slate-600">{receipt.paymentMethod}</p>
                <p className="mt-3 text-[11px] leading-5 text-emerald-900">Transaksi sudah masuk ke ringkasan dashboard. Ini adalah pembayaran demonstrasi, bukan pembayaran uang sungguhan.</p>
                <Link href="/demo/ruang" className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold text-white hover:bg-emerald-800">Lihat dashboard</Link>
              </section>
            )}

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black">Riwayat kasir terbaru</h2>
              <div className="mt-3 space-y-3">
                {recentOrders.length ? recentOrders.slice(0, 7).map((order) => (
                  <div key={order.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-slate-800">{order.invoiceNo}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{formatDate(order.createdAt)} · {order.paymentMethod || 'Belum dipilih'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-black text-slate-900">{rupiah.format(order.total)}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-extrabold ${order.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : order.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{order.status.toUpperCase()}</span>
                    </div>
                  </div>
                )) : <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">Belum ada invoice.</p>}
              </div>
            </section>

            <DemoStaticQrisPanel />
          </aside>
        </div>

        {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{error}</p>}

        {showProductForm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="new-product-title">
            <form onSubmit={createProduct} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div><h2 id="new-product-title" className="text-lg font-black">Tambah produk / layanan</h2><p className="mt-1 text-xs text-slate-500">Produk akan tersimpan hanya pada sesi demo ini.</p></div>
                <button type="button" onClick={() => setShowProductForm(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><X size={17} /></button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-slate-700 sm:col-span-2">Nama produk / layanan<input required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm((v) => ({ ...v, name: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="Contoh: Teh manis" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">SKU (opsional)<input maxLength={32} value={form.sku} onChange={(event) => setForm((v) => ({ ...v, sku: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="SKU-001" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">Kategori<input maxLength={40} value={form.category} onChange={(event) => setForm((v) => ({ ...v, category: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="Minuman" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">Jenis<select value={form.itemType} onChange={(event) => setForm((v) => ({ ...v, itemType: event.target.value as NewProductForm['itemType'], stock: event.target.value === 'service' ? '0' : v.stock, minStock: event.target.value === 'service' ? '0' : v.minStock }))} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500"><option value="merchandise">Barang dagangan</option><option value="finished_good">Barang jadi</option><option value="service">Layanan</option></select></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">Satuan<input required maxLength={20} value={form.unit} onChange={(event) => setForm((v) => ({ ...v, unit: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="pcs" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">Harga jual (Rp)<input required type="number" min="1" step="1" value={form.salePrice} onChange={(event) => setForm((v) => ({ ...v, salePrice: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="10000" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">Harga pokok per unit (Rp)<input required type="number" min="0" step="1" value={form.unitCost} onChange={(event) => setForm((v) => ({ ...v, unitCost: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" placeholder="6000" /></label>
                {form.itemType !== 'service' && <>
                  <label className="grid gap-1 text-xs font-bold text-slate-700">Stok awal<input required type="number" min="0" step="0.001" value={form.stock} onChange={(event) => setForm((v) => ({ ...v, stock: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" /></label>
                  <label className="grid gap-1 text-xs font-bold text-slate-700">Batas stok minimum<input required type="number" min="0" step="0.001" value={form.minStock} onChange={(event) => setForm((v) => ({ ...v, minStock: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-500" /></label>
                </>}
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setShowProductForm(false)} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">Batal</button>
                <button type="submit" disabled={busy === 'product'} className="rounded-xl bg-emerald-700 px-5 py-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">{busy === 'product' ? 'Menyimpan...' : 'Simpan produk'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
