import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000_000;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });

  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Format produk tidak valid.' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const itemType = body.itemType;
    const unit = typeof body.unit === 'string' ? body.unit.trim() : 'pcs';
    const category = typeof body.category === 'string' ? body.category.trim() : 'Umum';
    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const salePrice = body.salePrice;
    const unitCost = body.unitCost;
    const stock = body.stock;
    const minStock = body.minStock;

    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: 'Nama produk harus berisi 2–80 karakter.' }, { status: 400 });
    if (!['merchandise', 'raw_material', 'work_in_progress', 'finished_good', 'service'].includes(String(itemType))) return NextResponse.json({ error: 'Jenis produk tidak valid.' }, { status: 400 });
    if (!validMoney(salePrice) || !validMoney(unitCost)) return NextResponse.json({ error: 'Harga jual dan harga pokok harus berupa angka positif yang valid.' }, { status: 400 });
    const parsedStock = Number(stock ?? 0);
    const parsedMinStock = Number(minStock ?? 0);
    if (!Number.isFinite(parsedStock) || parsedStock < 0 || parsedStock > 100_000_000 || !Number.isFinite(parsedMinStock) || parsedMinStock < 0 || parsedMinStock > 100_000_000) {
      return NextResponse.json({ error: 'Jumlah stok tidak valid.' }, { status: 400 });
    }
    if (['merchandise', 'finished_good', 'service'].includes(String(itemType)) && salePrice <= 0) return NextResponse.json({ error: 'Harga jual harus lebih dari nol untuk produk yang dijual.' }, { status: 400 });
    if (itemType === 'service' && parsedStock !== 0) return NextResponse.json({ error: 'Layanan tidak menggunakan stok fisik.' }, { status: 400 });

    const { data, error } = await getDemoAdminClient().rpc('create_demo_pos_product', {
      p_session_id: session.id,
      p_sku: sku || null,
      p_name: name,
      p_category: category || 'Umum',
      p_item_type: itemType,
      p_unit: unit || 'pcs',
      p_sale_price: salePrice,
      p_unit_cost: unitCost,
      p_stock: parsedStock,
      p_min_stock: parsedMinStock,
    });
    if (error) {
      console.error('Create demo product RPC error:', error.message);
      if (error.message.includes('duplicate key')) return NextResponse.json({ error: 'SKU tersebut sudah digunakan. Gunakan SKU lain.' }, { status: 409 });
      if (error.message.includes('demo_session_expired')) return NextResponse.json({ error: 'Sesi demonstrasi sudah kedaluwarsa.' }, { status: 401 });
      return NextResponse.json({ error: 'Produk gagal disimpan. Periksa kembali nama, jenis, stok, dan harga.' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, product: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Create demo product error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat menyimpan produk.' }, { status: 500 });
  }
}
