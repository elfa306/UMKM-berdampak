import { getDemoAdminClient } from '@/lib/demoSessions.server';

export type DemoSaleableItemType = 'merchandise' | 'finished_good' | 'service';

export type DemoPOSProduct = {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  itemType: DemoSaleableItemType;
  unit: string;
  salePrice: number;
  unitCost: number;
  stock: number;
  minStock: number;
  tracksStock: boolean;
};

export type DemoPOSOrder = {
  id: string;
  invoiceNo: string;
  status: 'draft' | 'pending' | 'paid' | 'expired' | 'cancelled';
  paymentMethod: string | null;
  total: number;
  createdAt: string;
  paidAt: string | null;
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getDemoPOSSnapshot(sessionId: string): Promise<{
  products: DemoPOSProduct[];
  recentOrders: DemoPOSOrder[];
}> {
  const admin = getDemoAdminClient();
  const [productsResult, ordersResult] = await Promise.all([
    admin.from('demo_products')
      .select('id,sku,nama,kategori,jenis_item,satuan,harga_jual,harga_pokok,stok,stok_minimum')
      .eq('session_id', sessionId)
      .eq('aktif', true)
      .in('jenis_item', ['merchandise', 'finished_good', 'service'])
      .order('kategori')
      .order('nama'),
    admin.from('demo_orders')
      .select('id,invoice_no,status,payment_method,total,created_at,paid_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  if (productsResult.error) throw new Error(`Gagal membaca katalog demo: ${productsResult.error.message}`);
  if (ordersResult.error) throw new Error(`Gagal membaca riwayat kasir demo: ${ordersResult.error.message}`);

  const products = (productsResult.data ?? []).map((product): DemoPOSProduct => ({
    id: product.id,
    sku: product.sku,
    name: product.nama,
    category: product.kategori,
    itemType: product.jenis_item as DemoSaleableItemType,
    unit: product.satuan,
    salePrice: numberValue(product.harga_jual),
    unitCost: numberValue(product.harga_pokok),
    stock: numberValue(product.stok),
    minStock: numberValue(product.stok_minimum),
    tracksStock: product.jenis_item !== 'service',
  }));

  const recentOrders = (ordersResult.data ?? []).map((order): DemoPOSOrder => ({
    id: order.id,
    invoiceNo: order.invoice_no,
    status: order.status,
    paymentMethod: order.payment_method,
    total: numberValue(order.total),
    createdAt: order.created_at,
    paidAt: order.paid_at,
  }));

  return { products, recentOrders };
}
