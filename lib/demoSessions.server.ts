import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DEMO_SESSION_COOKIE = 'umkm_demo_session';
export const DEMO_SESSION_MAX_AGE_SECONDS = 4 * 60 * 60;

export type DemoBusinessType = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
export type DemoMode = 'eksplorasi' | 'guided';

export type DemoSession = {
  id: string;
  business_type: DemoBusinessType;
  demo_mode: DemoMode;
  business_name: string;
  status: 'active' | 'ended';
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  reset_at: string | null;
};

export type DemoProductSeed = {
  sku: string;
  nama: string;
  kategori: string;
  jenis_item: 'merchandise' | 'raw_material' | 'work_in_progress' | 'finished_good' | 'service';
  satuan: string;
  harga_jual: number;
  harga_pokok: number;
  stok: number;
  stok_minimum: number;
};

const BUSINESS_NAMES: Record<DemoBusinessType, string> = {
  retail: 'Warung Madura Demo',
  manufaktur: 'Pabrik Keripik Demo',
  jasa: 'Barbershop Demo',
  campuran: 'Kedai Kopi Demo',
};

export const DEMO_PRODUCT_SEEDS: Record<DemoBusinessType, DemoProductSeed[]> = {
  retail: [
    { sku: 'R-001', nama: 'Air mineral 600 ml', kategori: 'Minuman', jenis_item: 'merchandise', satuan: 'botol', harga_jual: 4000, harga_pokok: 2500, stok: 30, stok_minimum: 8 },
    { sku: 'R-002', nama: 'Mi instan', kategori: 'Makanan', jenis_item: 'merchandise', satuan: 'bungkus', harga_jual: 3500, harga_pokok: 2700, stok: 40, stok_minimum: 10 },
    { sku: 'R-003', nama: 'Kopi sachet', kategori: 'Minuman', jenis_item: 'merchandise', satuan: 'sachet', harga_jual: 2000, harga_pokok: 1300, stok: 50, stok_minimum: 12 },
    { sku: 'R-004', nama: 'Telur ayam', kategori: 'Sembako', jenis_item: 'merchandise', satuan: 'butir', harga_jual: 2500, harga_pokok: 2100, stok: 60, stok_minimum: 15 },
  ],
  manufaktur: [
    { sku: 'M-001', nama: 'Singkong', kategori: 'Bahan baku', jenis_item: 'raw_material', satuan: 'kg', harga_jual: 0, harga_pokok: 5000, stok: 25, stok_minimum: 5 },
    { sku: 'M-002', nama: 'Minyak goreng', kategori: 'Bahan baku', jenis_item: 'raw_material', satuan: 'liter', harga_jual: 0, harga_pokok: 16000, stok: 10, stok_minimum: 2 },
    { sku: 'M-003', nama: 'Bumbu balado', kategori: 'Bahan baku', jenis_item: 'raw_material', satuan: 'kg', harga_jual: 0, harga_pokok: 40000, stok: 3, stok_minimum: 1 },
    { sku: 'M-004', nama: 'Keripik singkong 100 g', kategori: 'Barang jadi', jenis_item: 'finished_good', satuan: 'bungkus', harga_jual: 10000, harga_pokok: 5000, stok: 20, stok_minimum: 5 },
  ],
  jasa: [
    { sku: 'J-001', nama: 'Potong rambut reguler', kategori: 'Layanan', jenis_item: 'service', satuan: 'layanan', harga_jual: 20000, harga_pokok: 5000, stok: 0, stok_minimum: 0 },
    { sku: 'J-002', nama: 'Cuci dan styling', kategori: 'Layanan', jenis_item: 'service', satuan: 'layanan', harga_jual: 30000, harga_pokok: 8000, stok: 0, stok_minimum: 0 },
    { sku: 'J-003', nama: 'Pomade 80 g', kategori: 'Produk tambahan', jenis_item: 'merchandise', satuan: 'pcs', harga_jual: 35000, harga_pokok: 24000, stok: 8, stok_minimum: 2 },
  ],
  campuran: [
    { sku: 'C-001', nama: 'Kopi susu gula aren', kategori: 'Produk racikan', jenis_item: 'finished_good', satuan: 'gelas', harga_jual: 18000, harga_pokok: 8000, stok: 0, stok_minimum: 0 },
    { sku: 'C-002', nama: 'Biji kopi', kategori: 'Bahan baku', jenis_item: 'raw_material', satuan: 'kg', harga_jual: 0, harga_pokok: 120000, stok: 5, stok_minimum: 1 },
    { sku: 'C-003', nama: 'Susu UHT', kategori: 'Bahan baku', jenis_item: 'raw_material', satuan: 'liter', harga_jual: 0, harga_pokok: 18000, stok: 12, stok_minimum: 3 },
    { sku: 'C-004', nama: 'Air mineral botol', kategori: 'Barang dagangan', jenis_item: 'merchandise', satuan: 'botol', harga_jual: 5000, harga_pokok: 3000, stok: 24, stok_minimum: 6 },
  ],
};

let adminClient: SupabaseClient | null = null;

export function getDemoAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Konfigurasi Supabase server belum lengkap. Tambahkan SUPABASE_SERVICE_ROLE_KEY di environment server.');
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return adminClient;
}

export function hashDemoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createDemoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function getDefaultBusinessName(type: DemoBusinessType): string {
  return BUSINESS_NAMES[type];
}

export function isDemoBusinessType(value: unknown): value is DemoBusinessType {
  return value === 'retail' || value === 'manufaktur' || value === 'jasa' || value === 'campuran';
}

export function isDemoMode(value: unknown): value is DemoMode {
  return value === 'eksplorasi' || value === 'guided';
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function hashClientIp(request: Request): string {
  const headers = new Headers(request.headers);
  const forwarded = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  const salt = process.env.DEMO_RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'local-demo-limit';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export async function getCurrentDemoSession(): Promise<DemoSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
  if (!token || token.length < 32 || token.length > 128) return null;

  const admin = getDemoAdminClient();
  const tokenHash = hashDemoToken(token);
  const { data, error } = await admin
    .from('demo_sessions')
    .select('id,business_type,demo_mode,business_name,status,created_at,last_seen_at,expires_at,reset_at')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`Gagal memeriksa sesi demonstrasi: ${error.message}`);
  if (!data) return null;

  const lastSeen = new Date(data.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60_000) {
    await admin.from('demo_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  }

  return data as DemoSession;
}

export async function createDemoSession(input: {
  businessType: DemoBusinessType;
  mode: DemoMode;
  businessName?: string;
}): Promise<{ session: DemoSession; token: string; productCount: number }> {
  const admin = getDemoAdminClient();
  const token = createDemoToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEMO_SESSION_MAX_AGE_SECONDS * 1000);
  const businessName = input.businessName?.trim().slice(0, 80) || getDefaultBusinessName(input.businessType);

  const { data: session, error: sessionError } = await admin
    .from('demo_sessions')
    .insert({
      token_hash: hashDemoToken(token),
      business_type: input.businessType,
      demo_mode: input.mode,
      business_name: businessName,
      status: 'active',
      expires_at: expiresAt.toISOString(),
    })
    .select('id,business_type,demo_mode,business_name,status,created_at,last_seen_at,expires_at,reset_at')
    .single();

  if (sessionError || !session) {
    throw new Error(`Gagal membuat sesi demonstrasi: ${sessionError?.message ?? 'Tidak ada data sesi.'}`);
  }

  const seeds = DEMO_PRODUCT_SEEDS[input.businessType].map((product) => ({
    session_id: session.id,
    ...product,
  }));
  const { data: insertedProducts, error: productsError } = await admin
    .from('demo_products')
    .insert(seeds)
    .select('id,sku,nama,stok,jenis_item,satuan,harga_jual,harga_pokok');

  if (productsError) {
    await admin.from('demo_sessions').delete().eq('id', session.id);
    throw new Error(`Sesi dibuat tetapi data awal gagal disiapkan: ${productsError.message}`);
  }

  const openingMovements = (insertedProducts ?? [])
    .filter((product) => Number(product.stok) > 0)
    .map((product) => ({
      session_id: session.id,
      product_id: product.id,
      movement_type: 'opening',
      quantity_delta: product.stok,
      note: 'Stok awal demonstrasi',
    }));

  if (openingMovements.length > 0) {
    const { error: movementsError } = await admin.from('demo_inventory_movements').insert(openingMovements);
    if (movementsError) {
      await admin.from('demo_sessions').delete().eq('id', session.id);
      throw new Error(`Sesi dibuat tetapi stok awal gagal dicatat: ${movementsError.message}`);
    }
  }

  try {
    await seedDemoProductionRecipe(session.id, input.businessType, insertedProducts ?? []);
    await seedDemoStarterSales(session.id, input.businessType, insertedProducts ?? []);
  } catch (seedError) {
    await admin.from('demo_sessions').delete().eq('id', session.id);
    throw seedError;
  }

  return { session: session as DemoSession, token, productCount: insertedProducts?.length ?? 0 };
}

type InsertedDemoProduct = {
  id: string;
  sku: string;
  nama: string;
  stok: number | string;
  jenis_item: DemoProductSeed['jenis_item'];
  satuan: string;
  harga_jual: number | string;
  harga_pokok: number | string;
};

async function seedDemoProductionRecipe(
  sessionId: string,
  businessType: DemoBusinessType,
  products: InsertedDemoProduct[],
): Promise<void> {
  const recipeConfig: Partial<Record<DemoBusinessType, { name: string; outputSku: string; outputQty: number; items: Array<{ sku: string; qty: number }> }>> = {
    manufaktur: {
      name: 'Keripik Singkong Original', outputSku: 'M-004', outputQty: 10,
      items: [{ sku: 'M-001', qty: 2 }, { sku: 'M-002', qty: 0.5 }, { sku: 'M-003', qty: 0.1 }],
    },
    campuran: {
      name: 'Kopi Susu Gula Aren', outputSku: 'C-001', outputQty: 1,
      items: [{ sku: 'C-002', qty: 0.02 }, { sku: 'C-003', qty: 0.2 }],
    },
  };
  const config = recipeConfig[businessType];
  if (!config) return;
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const output = bySku.get(config.outputSku);
  if (!output) throw new Error(`Produk hasil contoh ${config.outputSku} tidak ditemukan.`);
  const items = config.items.map((item) => {
    const product = bySku.get(item.sku);
    if (!product) throw new Error(`Bahan contoh ${item.sku} tidak ditemukan.`);
    return { productId: product.id, qty: item.qty };
  });
  const { error } = await getDemoAdminClient().rpc('create_demo_production_recipe', {
    p_session_id: sessionId,
    p_name: config.name,
    p_output_product_id: output.id,
    p_output_qty: config.outputQty,
    p_items: items,
    p_note: 'Resep awal untuk demonstrasi; pengguna dapat membuat resep lain.',
  });
  if (error) throw new Error(`Gagal menyiapkan resep produksi contoh: ${error.message}`);
}

async function seedDemoStarterSales(
  sessionId: string,
  businessType: DemoBusinessType,
  insertedProducts: InsertedDemoProduct[],
): Promise<void> {
  const admin = getDemoAdminClient();
  const templates: Record<DemoBusinessType, Array<{ daysAgo: number; lines: Array<{ sku: string; qty: number }> }>> = {
    retail: [
      { daysAgo: 6, lines: [{ sku: 'R-001', qty: 2 }, { sku: 'R-002', qty: 2 }] },
      { daysAgo: 5, lines: [{ sku: 'R-003', qty: 4 }, { sku: 'R-004', qty: 4 }] },
      { daysAgo: 4, lines: [{ sku: 'R-001', qty: 3 }, { sku: 'R-002', qty: 1 }] },
      { daysAgo: 2, lines: [{ sku: 'R-001', qty: 2 }, { sku: 'R-003', qty: 5 }] },
      { daysAgo: 1, lines: [{ sku: 'R-002', qty: 3 }, { sku: 'R-004', qty: 5 }] },
    ],
    manufaktur: [
      { daysAgo: 6, lines: [{ sku: 'M-004', qty: 2 }] },
      { daysAgo: 5, lines: [{ sku: 'M-004', qty: 3 }] },
      { daysAgo: 3, lines: [{ sku: 'M-004', qty: 2 }] },
      { daysAgo: 2, lines: [{ sku: 'M-004', qty: 1 }] },
      { daysAgo: 1, lines: [{ sku: 'M-004', qty: 2 }] },
    ],
    jasa: [
      { daysAgo: 6, lines: [{ sku: 'J-001', qty: 2 }] },
      { daysAgo: 5, lines: [{ sku: 'J-002', qty: 1 }, { sku: 'J-003', qty: 1 }] },
      { daysAgo: 3, lines: [{ sku: 'J-001', qty: 3 }] },
      { daysAgo: 2, lines: [{ sku: 'J-002', qty: 2 }] },
      { daysAgo: 1, lines: [{ sku: 'J-001', qty: 1 }, { sku: 'J-003', qty: 1 }] },
    ],
    campuran: [
      { daysAgo: 6, lines: [{ sku: 'C-004', qty: 2 }] },
      { daysAgo: 5, lines: [{ sku: 'C-004', qty: 3 }] },
      { daysAgo: 4, lines: [{ sku: 'C-004', qty: 2 }] },
      { daysAgo: 2, lines: [{ sku: 'C-004', qty: 4 }] },
      { daysAgo: 1, lines: [{ sku: 'C-004', qty: 2 }] },
    ],
  };

  const bySku = new Map(insertedProducts.map((product) => [product.sku, product]));
  const templatesForType = templates[businessType];
  const requiredStock = new Map<string, number>();
  for (const transaction of templatesForType) {
    for (const line of transaction.lines) {
      const product = bySku.get(line.sku);
      if (!product) throw new Error(`Produk contoh ${line.sku} tidak ditemukan.`);
      if (product.jenis_item !== 'service') {
        requiredStock.set(line.sku, (requiredStock.get(line.sku) ?? 0) + line.qty);
      }
    }
  }
  for (const [sku, qty] of requiredStock) {
    const product = bySku.get(sku)!;
    if (Number(product.stok) < qty) throw new Error(`Stok awal ${product.nama} tidak cukup untuk transaksi contoh.`);
  }

  const now = Date.now();
  const orderPayload = templatesForType.map((template, index) => {
    const lines = template.lines.map((line) => {
      const product = bySku.get(line.sku)!;
      const unitPrice = Number(product.harga_jual) || 0;
      const unitCost = Number(product.harga_pokok) || 0;
      return {
        product,
        qty: line.qty,
        unitPrice,
        unitCost,
        subtotal: unitPrice * line.qty,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const createdAt = new Date(now - template.daysAgo * 24 * 60 * 60 * 1000 - (index * 37 * 60 * 1000)).toISOString();
    return {
      session_id: sessionId,
      invoice_no: `CONTOH-${String(index + 1).padStart(3, '0')}`,
      status: 'paid',
      payment_method: 'Tunai (data contoh)',
      payment_source: 'cash_simulation',
      subtotal: total,
      discount: 0,
      total,
      metadata: { seeded: true, label: 'Transaksi contoh awal dashboard' },
      created_at: createdAt,
      paid_at: createdAt,
      is_seeded: true,
    };
  });

  const { data: insertedOrders, error: orderError } = await admin
    .from('demo_orders').insert(orderPayload).select('id,invoice_no');
  if (orderError || !insertedOrders) {
    throw new Error(`Gagal membuat transaksi contoh: ${orderError?.message ?? 'Tidak ada data transaksi.'}`);
  }

  const itemRows: Array<Record<string, unknown>> = [];
  const saleMovements: Array<Record<string, unknown>> = [];
  const stockReductions = new Map<string, number>();

  templatesForType.forEach((template, index) => {
    const order = insertedOrders[index];
    for (const line of template.lines) {
      const product = bySku.get(line.sku)!;
      const qty = line.qty;
      const unitPrice = Number(product.harga_jual) || 0;
      const unitCost = Number(product.harga_pokok) || 0;
      itemRows.push({
        session_id: sessionId,
        order_id: order.id,
        product_id: product.id,
        nama_snapshot: product.nama,
        satuan_snapshot: product.satuan,
        qty,
        harga_jual: unitPrice,
        harga_pokok: unitCost,
        subtotal: unitPrice * qty,
      });
      if (product.jenis_item !== 'service') {
        stockReductions.set(line.sku, (stockReductions.get(line.sku) ?? 0) + qty);
        saleMovements.push({
          session_id: sessionId,
          product_id: product.id,
          movement_type: 'sale',
          quantity_delta: -qty,
          reference_id: order.id,
          note: 'Pengurangan stok dari transaksi contoh awal',
          created_at: orderPayload[index].created_at,
        });
      }
    }
  });

  const { error: itemsError } = await admin.from('demo_order_items').insert(itemRows);
  if (itemsError) throw new Error(`Gagal menyimpan rincian transaksi contoh: ${itemsError.message}`);

  for (const [sku, quantity] of stockReductions) {
    const product = bySku.get(sku)!;
    const nextStock = Number(product.stok) - quantity;
    const { error } = await admin.from('demo_products').update({ stok: nextStock }).eq('id', product.id).eq('session_id', sessionId);
    if (error) throw new Error(`Gagal memperbarui stok contoh ${product.nama}: ${error.message}`);
  }

  if (saleMovements.length > 0) {
    const { error } = await admin.from('demo_inventory_movements').insert(saleMovements);
    if (error) throw new Error(`Gagal mencatat mutasi stok contoh: ${error.message}`);
  }

  // Tahap 10: posting jurnal untuk transaksi contoh setelah semua item dan mutasi stok selesai dibuat.
  // Fungsi SQL bersifat idempoten sehingga sesi yang di-retry tidak menggandakan jurnal.
  const { error: journalError } = await admin.rpc('post_demo_seeded_order_journals', { p_session_id: sessionId });
  if (journalError) throw new Error(`Transaksi contoh dibuat, tetapi jurnal pembukaan gagal disiapkan: ${journalError.message}`);
}

export async function getDemoProductCount(sessionId: string): Promise<number> {
  const { count, error } = await getDemoAdminClient()
    .from('demo_products')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw new Error(`Gagal membaca produk demo: ${error.message}`);
  return count ?? 0;
}
