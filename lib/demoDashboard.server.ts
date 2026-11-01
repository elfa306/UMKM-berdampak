import {
  getDemoAdminClient,
} from '@/lib/demoSessions.server';

export type DemoMissionEvent =
  | 'product_created'
  | 'sale_paid'
  | 'inventory_decreased'
  | 'purchase_received'
  | 'production_completed'
  | 'profit_loss_viewed'
  | 'financing_recommendation_viewed';

export type DemoMission = {
  eventType: DemoMissionEvent;
  title: string;
  description: string;
  module: string;
  availableFrom: string;
};

export const DEMO_GUIDED_MISSIONS: DemoMission[] = [
  {
    eventType: 'product_created',
    title: 'Tambahkan produk atau layanan',
    description: 'Buat satu produk baru lengkap dengan harga dan satuannya.',
    module: 'Katalog produk',
    availableFrom: 'Kasir · Tahap 5',
  },
  {
    eventType: 'sale_paid',
    title: 'Catat satu penjualan',
    description: 'Buat pesanan dan selesaikan pembayarannya dalam mode demo.',
    module: 'Kasir & POS',
    availableFrom: 'Kasir · Tahap 5',
  },
  {
    eventType: 'inventory_decreased',
    title: 'Amati stok setelah penjualan',
    description: 'Periksa bagaimana jumlah persediaan berubah setelah barang terjual.',
    module: 'Persediaan',
    availableFrom: 'Kasir · Tahap 5',
  },
  {
    eventType: 'purchase_received',
    title: 'Catat barang masuk',
    description: 'Catat pembelian atau penerimaan persediaan dari pemasok.',
    module: 'Pembelian & persediaan',
    availableFrom: 'Tahap 8',
  },
  {
    eventType: 'profit_loss_viewed',
    title: 'Buka laporan laba rugi',
    description: 'Lihat pendapatan, harga pokok penjualan, dan beban usaha.',
    module: 'Akuntansi',
    availableFrom: 'Tahap 10',
  },
  {
    eventType: 'financing_recommendation_viewed',
    title: 'Lihat rekomendasi pembiayaan',
    description: 'Pelajari analisis kesehatan usaha dan kebutuhan modal.',
    module: 'Analisis usaha',
    availableFrom: 'Tahap 10',
  },
];

export function getDemoGuidedMissions(businessType: 'retail' | 'manufaktur' | 'jasa' | 'campuran'): DemoMission[] {
  if (businessType !== 'manufaktur' && businessType !== 'campuran') return DEMO_GUIDED_MISSIONS;
  const productionMission: DemoMission = {
    eventType: 'production_completed',
    title: 'Selesaikan satu batch produksi',
    description: 'Gunakan resep untuk mengolah bahan baku menjadi barang jadi dan melihat HPP produksi.',
    module: 'Produksi & HPP',
    availableFrom: 'Tahap 9',
  };
  return [...DEMO_GUIDED_MISSIONS.slice(0, 4), productionMission, ...DEMO_GUIDED_MISSIONS.slice(4)];
}

export type DemoDailySales = {
  date: string;
  label: string;
  revenue: number;
  transactions: number;
};

export type DemoActivity = {
  id: string;
  title: string;
  description: string;
  amount: number | null;
  createdAt: string;
  kind: 'sale' | 'stock' | 'system';
  seeded: boolean;
};

export type DemoDashboardSnapshot = {
  revenue7d: number;
  grossProfit7d: number;
  unallocatedStaticRevenue7d: number;
  transactions7d: number;
  productCount: number;
  inventoryValue: number;
  lowStockCount: number;
  lowStockProducts: Array<{ id: string; name: string; stock: number; minimum: number; unit: string }>;
  dailySales: DemoDailySales[];
  recentActivities: DemoActivity[];
  bestSellingProducts: Array<{ name: string; quantity: number; revenue: number; unit: string }>;
  seededOrderCount: number;
  realDemoOrderCount: number;
};

export type DemoMissionProgress = {
  completedCount: number;
  totalCount: number;
  completedEvents: DemoMissionEvent[];
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jakartaDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function chartLabel(dateKey: string): string {
  // Parse at midday Jakarta time so the label is stable across server time zones.
  return new Date(`${dateKey}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
  });
}

function rupiahDate(date: string): string {
  return new Date(date).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export async function getDemoDashboardSnapshot(sessionId: string): Promise<DemoDashboardSnapshot> {
  const admin = getDemoAdminClient();
  const [productsResult, ordersResult, movementsResult] = await Promise.all([
    admin.from('demo_products')
      .select('id,sku,nama,kategori,jenis_item,satuan,harga_jual,harga_pokok,stok,stok_minimum,aktif')
      .eq('session_id', sessionId).eq('aktif', true).order('nama'),
    admin.from('demo_orders')
      .select('id,invoice_no,status,payment_method,payment_source,subtotal,discount,total,metadata,created_at,paid_at,is_seeded')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(500),
    admin.from('demo_inventory_movements')
      .select('id,product_id,movement_type,quantity_delta,note,created_at')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(8),
  ]);

  if (productsResult.error) throw new Error(`Gagal membaca produk demo: ${productsResult.error.message}`);
  if (ordersResult.error) throw new Error(`Gagal membaca transaksi demo: ${ordersResult.error.message}`);
  if (movementsResult.error) throw new Error(`Gagal membaca persediaan demo: ${movementsResult.error.message}`);

  const products = productsResult.data ?? [];
  const orders = ordersResult.data ?? [];
  const movements = movementsResult.data ?? [];
  const paidOrders = orders.filter((order) => order.status === 'paid');
  const paidOrderIds = paidOrders.map((order) => order.id);

  let orderItems: Array<{
    id: string;
    order_id: string;
    product_id: string | null;
    nama_snapshot: string;
    satuan_snapshot: string;
    qty: number | string;
    harga_jual: number | string;
    harga_pokok: number | string;
    subtotal: number | string;
    created_at: string;
  }> = [];

  if (paidOrderIds.length > 0) {
    const itemsResult = await admin.from('demo_order_items')
      .select('id,order_id,product_id,nama_snapshot,satuan_snapshot,qty,harga_jual,harga_pokok,subtotal,created_at')
      .eq('session_id', sessionId)
      .limit(2000);
    if (itemsResult.error) throw new Error(`Gagal membaca rincian transaksi demo: ${itemsResult.error.message}`);
    orderItems = itemsResult.data ?? [];
  }

  const now = new Date();
  const todayKey = jakartaDateKey(now);
  const todayParts = todayKey.split('-').map(Number);
  const dayMap = new Map<string, DemoDailySales>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2] - offset, 12));
    const key = jakartaDateKey(date);
    dayMap.set(key, { date: key, label: chartLabel(key), revenue: 0, transactions: 0 });
  }

  let revenue7d = 0;
  let transactions7d = 0;
  for (const order of paidOrders) {
    const key = jakartaDateKey(new Date(order.paid_at || order.created_at));
    const day = dayMap.get(key);
    if (!day) continue;
    const total = asNumber(order.total);
    day.revenue += total;
    day.transactions += 1;
    revenue7d += total;
    transactions7d += 1;
  }

  const sevenDayOrderIds = new Set(
    paidOrders.filter((order) => dayMap.has(jakartaDateKey(new Date(order.paid_at || order.created_at)))).map((order) => order.id),
  );
  const orderCost = new Map<string, number>();
  const productSales = new Map<string, { name: string; quantity: number; revenue: number; unit: string }>();
  for (const item of orderItems) {
    if (!sevenDayOrderIds.has(item.order_id)) continue;
    const qty = asNumber(item.qty);
    const cost = asNumber(item.harga_pokok) * qty;
    orderCost.set(item.order_id, (orderCost.get(item.order_id) ?? 0) + cost);
    const current = productSales.get(item.nama_snapshot) ?? {
      name: item.nama_snapshot,
      quantity: 0,
      revenue: 0,
      unit: item.satuan_snapshot,
    };
    current.quantity += qty;
    current.revenue += asNumber(item.subtotal);
    productSales.set(item.nama_snapshot, current);
  }

  let cost7d = 0;
  let detailedSalesRevenue7d = 0;
  let unallocatedStaticRevenue7d = 0;
  const paidOrderById = new Map(paidOrders.map((order) => [order.id, order]));
  for (const orderId of sevenDayOrderIds) {
    const order = paidOrderById.get(orderId);
    if (order?.metadata && typeof order.metadata === 'object' && (order.metadata as Record<string, unknown>).unallocated_static_qris === true) {
      unallocatedStaticRevenue7d += asNumber(order.total);
      continue;
    }
    cost7d += orderCost.get(orderId) ?? 0;
    // Only itemized sales contribute to estimated gross profit. Payments without SKU
    // details (e.g. static QRIS) remain revenue, but must not be treated as zero-HPP sales.
    const itemizedRevenue = orderItems
      .filter((item) => item.order_id === orderId)
      .reduce((sum, item) => sum + asNumber(item.subtotal), 0);
    detailedSalesRevenue7d += itemizedRevenue;
  }
  const grossProfit7d = detailedSalesRevenue7d - cost7d;

  const trackedProducts = products.filter((product) => product.jenis_item !== 'service');
  const lowStockProducts = trackedProducts
    .filter((product) => asNumber(product.stok_minimum) > 0 && asNumber(product.stok) <= asNumber(product.stok_minimum))
    .map((product) => ({
      id: product.id,
      name: product.nama,
      stock: asNumber(product.stok),
      minimum: asNumber(product.stok_minimum),
      unit: product.satuan,
    }))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5);
  const inventoryValue = trackedProducts.reduce(
    (sum, product) => sum + asNumber(product.stok) * asNumber(product.harga_pokok), 0,
  );

  const nameByProductId = new Map(products.map((product) => [product.id, product.nama]));
  const saleActivities: DemoActivity[] = paidOrders.slice(0, 8).map((order) => ({
    id: `order-${order.id}`,
    title: order.is_seeded ? `Contoh transaksi ${order.invoice_no}` : `Penjualan ${order.invoice_no}`,
    description: `${order.payment_method || 'Pembayaran'} · ${rupiahDate(order.paid_at || order.created_at)}`,
    amount: asNumber(order.total),
    createdAt: order.paid_at || order.created_at,
    kind: 'sale',
    seeded: Boolean(order.is_seeded),
  }));
  const stockActivities: DemoActivity[] = movements.slice(0, 8).map((movement) => {
    const qty = asNumber(movement.quantity_delta);
    const labelMap: Record<string, string> = {
      opening: 'Stok awal', sale: 'Barang terjual', restock: 'Persediaan masuk',
      adjustment: 'Penyesuaian stok', production_in: 'Hasil produksi masuk',
      production_out: 'Bahan dipakai produksi', waste: 'Barang rusak / terbuang',
    };
    return {
      id: `movement-${movement.id}`,
      title: labelMap[movement.movement_type] ?? 'Aktivitas persediaan',
      description: `${nameByProductId.get(movement.product_id) ?? 'Produk'} · ${movement.note || `${qty > 0 ? '+' : ''}${qty}`}`,
      amount: null,
      createdAt: movement.created_at,
      kind: 'stock',
      seeded: movement.movement_type === 'opening',
    };
  });

  const recentActivities = [...saleActivities, ...stockActivities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 7);

  const seededOrderCount = paidOrders.filter((order) => Boolean(order.is_seeded)).length;
  const realDemoOrderCount = paidOrders.filter((order) => !order.is_seeded).length;

  return {
    revenue7d,
    grossProfit7d,
    unallocatedStaticRevenue7d,
    transactions7d,
    productCount: products.length,
    inventoryValue,
    lowStockCount: trackedProducts.filter((product) => asNumber(product.stok_minimum) > 0 && asNumber(product.stok) <= asNumber(product.stok_minimum)).length,
    lowStockProducts,
    dailySales: [...dayMap.values()],
    recentActivities,
    bestSellingProducts: [...productSales.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    seededOrderCount,
    realDemoOrderCount,
  };
}

export async function getDemoMissionProgress(sessionId: string, missions: DemoMission[] = DEMO_GUIDED_MISSIONS): Promise<DemoMissionProgress> {
  const { data, error } = await getDemoAdminClient()
    .from('demo_events')
    .select('event_type')
    .eq('session_id', sessionId);
  if (error) throw new Error(`Gagal membaca progres misi demo: ${error.message}`);
  const known = new Set((data ?? []).map((row) => row.event_type as DemoMissionEvent));
  const completedEvents = missions
    .map((mission) => mission.eventType)
    .filter((eventType) => known.has(eventType));
  return {
    completedCount: completedEvents.length,
    totalCount: missions.length,
    completedEvents,
  };
}

export async function recordDemoEvent(input: {
  sessionId: string;
  eventType: DemoMissionEvent;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const key = input.idempotencyKey.trim().slice(0, 160);
  if (!key) throw new Error('Kunci aktivitas demonstrasi tidak valid.');
  const { error } = await getDemoAdminClient().from('demo_events').insert({
    session_id: input.sessionId,
    event_type: input.eventType,
    idempotency_key: key,
    metadata: input.metadata ?? {},
  });
  if (error && error.code !== '23505') {
    throw new Error(`Gagal mencatat progres demonstrasi: ${error.message}`);
  }
}

