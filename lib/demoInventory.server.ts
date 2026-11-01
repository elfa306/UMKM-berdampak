import { getDemoAdminClient } from '@/lib/demoSessions.server';

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getDemoInventorySnapshot(sessionId: string) {
  const admin = getDemoAdminClient();
  const [productsResult, suppliersResult, purchasesResult, movementsResult] = await Promise.all([
    admin.from('demo_products')
      .select('id,sku,nama,kategori,jenis_item,satuan,harga_jual,harga_pokok,stok,stok_minimum,aktif,created_at')
      .eq('session_id', sessionId).eq('aktif', true).order('kategori').order('nama'),
    admin.from('demo_suppliers')
      .select('id,nama,telepon,catatan,aktif,created_at')
      .eq('session_id', sessionId).eq('aktif', true).order('nama'),
    admin.from('demo_stock_purchases')
      .select('id,purchase_no,supplier_id,total_cost,note,received_at')
      .eq('session_id', sessionId).order('received_at', { ascending: false }).limit(25),
    admin.from('demo_inventory_movements')
      .select('id,product_id,movement_type,quantity_delta,note,created_at')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(60),
  ]);

  if (productsResult.error) throw new Error(`Gagal membaca produk demo: ${productsResult.error.message}`);
  if (suppliersResult.error) throw new Error(`Gagal membaca pemasok demo: ${suppliersResult.error.message}`);
  if (purchasesResult.error) throw new Error(`Gagal membaca pembelian demo: ${purchasesResult.error.message}`);
  if (movementsResult.error) throw new Error(`Gagal membaca mutasi demo: ${movementsResult.error.message}`);

  const products = (productsResult.data ?? []).map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.nama,
    category: row.kategori,
    itemType: row.jenis_item,
    unit: row.satuan,
    salePrice: n(row.harga_jual),
    unitCost: n(row.harga_pokok),
    stock: n(row.stok),
    minStock: n(row.stok_minimum),
    tracksStock: row.jenis_item !== 'service',
  }));
  const productById = new Map(products.map((product) => [product.id, product]));
  const suppliers = (suppliersResult.data ?? []).map((row) => ({
    id: row.id, name: row.nama, phone: row.telepon, note: row.catatan, createdAt: row.created_at,
  }));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const movements = (movementsResult.data ?? []).map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: productById.get(row.product_id)?.name ?? 'Produk dihapus',
    movementType: row.movement_type,
    quantityDelta: n(row.quantity_delta),
    note: row.note,
    createdAt: row.created_at,
  }));
  const purchases = (purchasesResult.data ?? []).map((row) => ({
    id: row.id,
    purchaseNo: row.purchase_no,
    supplierName: row.supplier_id ? supplierById.get(row.supplier_id)?.name ?? 'Pemasok tidak aktif' : 'Tanpa pemasok',
    totalCost: n(row.total_cost),
    note: row.note,
    receivedAt: row.received_at,
  }));
  const tracked = products.filter((product) => product.tracksStock);
  const lowStock = tracked.filter((product) => product.minStock > 0 && product.stock <= product.minStock);

  return {
    products,
    suppliers,
    purchases,
    movements,
    summary: {
      trackedProductCount: tracked.length,
      lowStockCount: lowStock.length,
      totalStockValue: tracked.reduce((sum, product) => sum + product.stock * product.unitCost, 0),
      totalUnits: tracked.reduce((sum, product) => sum + product.stock, 0),
      lowStockProducts: lowStock.slice(0, 8),
    },
  };
}
