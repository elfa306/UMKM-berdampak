import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin } from '@/lib/ownerApi.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000_000_000;

export async function GET(request: Request) {
  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Sesi login tidak ditemukan.' }, { status: 401 });
    const uid = ctx.user.id;
    const [products, recipes, batches] = await Promise.all([
      ctx.admin.from('products').select('id,sku,nama,jenis_item,satuan,harga,harga_pokok,stok,stok_minimum,lacak_stok,aktif').eq('user_id', uid).eq('aktif', true).order('nama'),
      ctx.admin.from('production_recipes').select('id,nama,output_product_id,output_qty,output_unit,catatan,created_at').eq('user_id', uid).eq('aktif', true).order('created_at', { ascending: false }),
      ctx.admin.from('production_batches').select('id,batch_no,recipe_id,output_product_id,output_qty,material_cost,direct_labor_cost,overhead_cost,total_cost,unit_cost,status,completed_at').eq('user_id', uid).order('completed_at', { ascending: false }).limit(30),
    ]);
    if (products.error) throw products.error;
    if (recipes.error) throw recipes.error;
    if (batches.error) throw batches.error;
    const recipeIds = (recipes.data ?? []).map((r) => r.id);
    const [recipeItems, batchItems] = await Promise.all([
      recipeIds.length ? ctx.admin.from('production_recipe_items').select('id,recipe_id,input_product_id,qty_per_batch').eq('user_id', uid).in('recipe_id', recipeIds) : Promise.resolve({ data: [], error: null }),
      (batches.data ?? []).length ? ctx.admin.from('production_batch_items').select('id,batch_id,input_product_id,nama_snapshot,satuan_snapshot,qty_used,unit_cost,subtotal').eq('user_id', uid).in('batch_id', (batches.data ?? []).map((b) => b.id)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (recipeItems.error) throw recipeItems.error;
    if (batchItems.error) throw batchItems.error;
    const productMap = new Map((products.data ?? []).map((p) => [p.id, p]));
    return NextResponse.json({
      products: (products.data ?? []).map((p) => ({ id: p.id, sku: p.sku, name: p.nama, itemType: p.jenis_item, unit: p.satuan, salePrice: Number(p.harga), unitCost: Number(p.harga_pokok), stock: Number(p.stok), tracksStock: p.lacak_stok })),
      recipes: (recipes.data ?? []).map((r) => ({ id: r.id, name: r.nama, outputProductId: r.output_product_id, outputProductName: productMap.get(r.output_product_id)?.nama ?? 'Produk tidak ditemukan', outputQty: Number(r.output_qty), outputUnit: r.output_unit, note: r.catatan, items: (recipeItems.data ?? []).filter((i) => i.recipe_id === r.id).map((i) => ({ productId: i.input_product_id, name: productMap.get(i.input_product_id)?.nama ?? 'Bahan tidak ditemukan', qty: Number(i.qty_per_batch), unit: productMap.get(i.input_product_id)?.satuan ?? 'unit' })) })),
      batches: (batches.data ?? []).map((b) => ({ id: b.id, batchNo: b.batch_no, recipeId: b.recipe_id, productName: productMap.get(b.output_product_id)?.nama ?? 'Produk jadi', outputQty: Number(b.output_qty), materialCost: Number(b.material_cost), laborCost: Number(b.direct_labor_cost), overheadCost: Number(b.overhead_cost), totalCost: Number(b.total_cost), unitCost: Number(b.unit_cost), status: b.status, completedAt: b.completed_at, items: (batchItems.data ?? []).filter((i) => i.batch_id === b.id).map((i) => ({ name: i.nama_snapshot, qty: Number(i.qty_used), unit: i.satuan_snapshot, unitCost: Number(i.unit_cost), subtotal: Number(i.subtotal) })) })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get production snapshot error:', error);
    return NextResponse.json({ error: 'Data produksi gagal dimuat.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSafeSameOrigin(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Sesi login tidak ditemukan.' }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Format permintaan tidak valid.' }, { status: 400 });

    if (body.action === 'recipe') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const outputProductId = typeof body.outputProductId === 'string' ? body.outputProductId : '';
      const outputQty = Number(body.outputQty);
      if (name.length < 2 || name.length > 120 || !UUID.test(outputProductId) || !Number.isFinite(outputQty) || outputQty <= 0 || outputQty > 1_000_000) return NextResponse.json({ error: 'Nama resep, produk jadi, atau jumlah hasil belum valid.' }, { status: 400 });
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return NextResponse.json({ error: 'Resep harus memiliki 1–30 bahan baku.' }, { status: 400 });
      const items: Array<{ productId: string; qty: number }> = [];
      for (const raw of body.items) {
        if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Bahan resep tidak valid.' }, { status: 400 });
        const row = raw as Record<string, unknown>;
        const productId = typeof row.productId === 'string' ? row.productId : '';
        const qty = Number(row.qty);
        if (!UUID.test(productId) || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return NextResponse.json({ error: 'Produk bahan atau kuantitas resep tidak valid.' }, { status: 400 });
        items.push({ productId, qty });
      }
      const { data, error } = await ctx.userClient.rpc('create_production_recipe', { p_name: name, p_output_product_id: outputProductId, p_output_qty: outputQty, p_items: items, p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null });
      if (error) {
        console.error('Create production recipe RPC error:', error.message);
        const message = error.message.includes('output_must_be_finished_good') ? 'Produk hasil harus bertipe Barang Jadi.' : error.message.includes('input_must_be_stocked_material') ? 'Bahan resep harus berupa bahan baku atau barang dalam proses yang melacak stok.' : error.message.includes('recipe_name_or_item_already_exists') ? 'Nama resep atau bahan yang sama sudah digunakan.' : 'Resep gagal disimpan. Periksa kembali bahan dan produk hasil.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, result: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    if (body.action === 'complete') {
      const recipeId = typeof body.recipeId === 'string' ? body.recipeId : '';
      const batchCount = Number(body.batchCount);
      const labor = Number(body.laborCost ?? 0);
      const overhead = Number(body.overheadCost ?? 0);
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      if (!UUID.test(recipeId) || !Number.isFinite(batchCount) || batchCount <= 0 || batchCount > 10000 || !money(labor) || !money(overhead) || !UUID.test(requestId)) return NextResponse.json({ error: 'Jumlah batch, biaya, atau ID permintaan tidak valid.' }, { status: 400 });
      const { data, error } = await ctx.userClient.rpc('complete_production_batch', { p_recipe_id: recipeId, p_batch_count: batchCount, p_direct_labor_cost: labor, p_overhead_cost: overhead, p_idempotency_key: requestId, p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null });
      if (error) {
        console.error('Complete production batch RPC error:', error.message);
        const insufficient = error.message.match(/insufficient_raw_material:([^\n]+)/);
        const message = insufficient ? `Bahan baku ${insufficient[1]} tidak mencukupi.` : error.message.includes('recipe_not_found') ? 'Resep tidak ditemukan.' : error.message.includes('output_product_not_found') ? 'Produk jadi tidak ditemukan.' : 'Produksi gagal diselesaikan. Periksa stok bahan baku dan biaya produksi.';
        return NextResponse.json({ error: message }, { status: 409 });
      }
      return NextResponse.json({ ok: true, result: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: 'Aksi produksi tidak dikenal.' }, { status: 400 });
  } catch (error) {
    console.error('Post production error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat memproses produksi.' }, { status: 500 });
  }
}
