import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';
import { getDemoInventorySnapshot } from '@/lib/demoInventory.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOVEMENTS = new Set(['adjustment_in', 'adjustment_out', 'return_in', 'return_out', 'waste']);

function objectBody(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function GET() {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const snapshot = await getDemoInventorySnapshot(session.id);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo inventory error:', error);
    return NextResponse.json({ error: 'Data persediaan demonstrasi gagal dimuat.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });

  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const body = objectBody(await request.json());
    if (!body) return NextResponse.json({ error: 'Format permintaan tidak valid.' }, { status: 400 });
    const admin = getDemoAdminClient();

    if (body.action === 'supplier') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2 || name.length > 100) return NextResponse.json({ error: 'Nama pemasok harus berisi 2–100 karakter.' }, { status: 400 });
      const { data, error } = await admin.rpc('create_demo_supplier', {
        p_session_id: session.id,
        p_name: name,
        p_phone: typeof body.phone === 'string' ? body.phone.trim() : null,
        p_note: typeof body.note === 'string' ? body.note.trim() : null,
      });
      if (error) {
        const message = error.message.includes('supplier_already_exists') ? 'Nama pemasok tersebut sudah ada.' : 'Pemasok gagal disimpan.';
        return NextResponse.json({ error: message }, { status: 409 });
      }
      return NextResponse.json({ ok: true, supplier: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    if (body.action === 'purchase') {
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      const supplierId = body.supplierId === null || body.supplierId === '' ? null : typeof body.supplierId === 'string' ? body.supplierId : null;
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ error: 'ID permintaan pembelian tidak valid.' }, { status: 400 });
      if (supplierId && !UUID.test(supplierId)) return NextResponse.json({ error: 'Pemasok tidak valid.' }, { status: 400 });
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return NextResponse.json({ error: 'Tambahkan 1–50 barang pada penerimaan.' }, { status: 400 });
      const items: Array<{ productId: string; qty: number; unitCost: number }> = [];
      for (const raw of body.items) {
        const row = objectBody(raw);
        if (!row || typeof row.productId !== 'string' || !UUID.test(row.productId)) return NextResponse.json({ error: 'Produk pembelian tidak valid.' }, { status: 400 });
        const qty = Number(row.qty);
        const unitCost = Number(row.unitCost);
        if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000 || Math.round(qty * 1000) !== qty * 1000 || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 100_000_000_000) {
          return NextResponse.json({ error: 'Kuantitas atau harga beli tidak valid.' }, { status: 400 });
        }
        items.push({ productId: row.productId, qty, unitCost });
      }
      const { data, error } = await admin.rpc('receive_demo_inventory_purchase', {
        p_session_id: session.id,
        p_supplier_id: supplierId,
        p_note: note,
        p_idempotency_key: requestId,
        p_items: items,
      });
      if (error) {
        console.error('Receive demo inventory purchase RPC error:', error.message);
        if (error.message.includes('insufficient') ) return NextResponse.json({ error: 'Stok tidak mencukupi untuk proses ini.' }, { status: 409 });
        if (error.message.includes('supplier_not_found')) return NextResponse.json({ error: 'Pemasok tidak ditemukan pada sesi ini.' }, { status: 404 });
        if (error.message.includes('service_cannot_be_stocked')) return NextResponse.json({ error: 'Produk jasa tidak dapat menerima stok fisik.' }, { status: 400 });
        if (error.message.includes('demo_session_expired')) return NextResponse.json({ error: 'Sesi demonstrasi sudah kedaluwarsa.' }, { status: 401 });
        return NextResponse.json({ error: 'Penerimaan barang gagal disimpan. Periksa produk dan nilai pembelian.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, result: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    if (body.action === 'adjust') {
      const productId = typeof body.productId === 'string' ? body.productId : '';
      const movementType = typeof body.movementType === 'string' ? body.movementType : '';
      const qty = Number(body.qty);
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 250) : '';
      if (!UUID.test(productId) || !MOVEMENTS.has(movementType)) return NextResponse.json({ error: 'Produk atau jenis mutasi tidak valid.' }, { status: 400 });
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000 || Math.round(qty * 1000) !== qty * 1000) return NextResponse.json({ error: 'Jumlah mutasi tidak valid.' }, { status: 400 });
      if (!UUID.test(requestId)) return NextResponse.json({ error: 'ID permintaan mutasi tidak valid.' }, { status: 400 });
      const { data, error } = await admin.rpc('adjust_demo_inventory_stock', {
        p_session_id: session.id,
        p_product_id: productId,
        p_movement_type: movementType,
        p_quantity: qty,
        p_note: note,
        p_idempotency_key: requestId,
      });
      if (error) {
        console.error('Adjust demo inventory RPC error:', error.message);
        if (error.message.includes('insufficient_stock')) return NextResponse.json({ error: 'Stok tidak mencukupi untuk mutasi keluar.' }, { status: 409 });
        if (error.message.includes('service_cannot_be_stocked')) return NextResponse.json({ error: 'Produk jasa tidak memiliki stok fisik.' }, { status: 400 });
        return NextResponse.json({ error: 'Penyesuaian stok gagal disimpan.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, result: data }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'Aksi persediaan tidak dikenal.' }, { status: 400 });
  } catch (error) {
    console.error('Post demo inventory error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat memproses persediaan demonstrasi.' }, { status: 500 });
  }
}
