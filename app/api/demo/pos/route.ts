import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';
import { getDemoPOSSnapshot } from '@/lib/demoPos.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const snapshot = await getDemoPOSSnapshot(session.id);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo POS error:', error);
    return NextResponse.json({ error: 'Katalog kasir demo gagal dimuat.' }, { status: 500 });
  }
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
      return NextResponse.json({ error: 'Format pesanan tidak valid.' }, { status: 400 });
    }

    const paymentMethod = body.paymentMethod;
    const qrisType = body.qrisType === 'static' ? 'static' : 'dynamic';
    const items = body.items;
    if (paymentMethod !== 'cash' && paymentMethod !== 'qris') return NextResponse.json({ error: 'Pilih metode pembayaran yang tersedia.' }, { status: 400 });
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) return NextResponse.json({ error: 'Keranjang harus berisi 1–30 jenis produk.' }, { status: 400 });

    const seen = new Set<string>();
    const normalizedItems: Array<{ productId: string; qty: number }> = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') return NextResponse.json({ error: 'Rincian produk tidak valid.' }, { status: 400 });
      const row = item as Record<string, unknown>;
      const productId = typeof row.productId === 'string' ? row.productId : '';
      const qty = Number(row.qty);
      if (!/^[0-9a-f-]{36}$/i.test(productId) || !Number.isFinite(qty) || qty <= 0 || qty > 1000 || Math.round(qty * 1000) !== qty * 1000) {
        return NextResponse.json({ error: 'Produk atau jumlah barang tidak valid.' }, { status: 400 });
      }
      if (seen.has(productId)) return NextResponse.json({ error: 'Produk yang sama tidak boleh dikirim berulang dalam satu keranjang.' }, { status: 400 });
      seen.add(productId);
      normalizedItems.push({ productId, qty });
    }

    const admin = getDemoAdminClient();
    const { data, error } = await admin.rpc('create_demo_pos_order', {
      p_session_id: session.id,
      p_items: normalizedItems,
      p_payment_method: paymentMethod,
    });
    if (error) {
      console.error('Create demo POS order RPC error:', error.message);
      const message = error.message || '';
      if (message.includes('insufficient_stock')) return NextResponse.json({ error: 'Stok tidak mencukupi untuk salah satu produk. Perbarui keranjang dan coba lagi.' }, { status: 409 });
      if (message.includes('demo_session_expired')) return NextResponse.json({ error: 'Sesi demonstrasi sudah kedaluwarsa.' }, { status: 401 });
      if (message.includes('item_not_for_sale')) return NextResponse.json({ error: 'Bahan baku dan barang dalam proses tidak dapat dijual langsung.' }, { status: 400 });
      return NextResponse.json({ error: 'Pesanan gagal dibuat. Periksa stok dan data produk.' }, { status: 400 });
    }

    if (paymentMethod !== 'qris') return NextResponse.json({ ok: true, ...data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });

    const order = data.order as { id: string; invoice_no: string; total: number | string; metadata?: Record<string, unknown> };
    const total = Number(order.total);
    if (!Number.isSafeInteger(total) || total < 1) {
      await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
      return NextResponse.json({ error: 'Nominal QRIS harus berupa bilangan bulat rupiah positif. Periksa harga dan jumlah produk.' }, { status: 400 });
    }

    const label = qrisType === 'static' ? 'QRIS Statis (contoh demo)' : 'QRIS Dinamis (contoh demo)';
    const { error: orderUpdateError } = await admin.from('demo_orders').update({
      payment_method: label,
      payment_source: 'manual_demo',
      metadata: { ...(order.metadata ?? {}), payment_provider: 'manual_demo', qris_type: qrisType, qr_sample_only: true },
    }).eq('id', order.id).eq('session_id', session.id);
    if (orderUpdateError) {
      await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
      console.error('Update demo QRIS label failed:', orderUpdateError.message);
      return NextResponse.json({ error: 'Invoice demo gagal disiapkan.' }, { status: 500 });
    }

    const { error: paymentUpdateError } = await admin.from('demo_payments').update({
      provider: 'manual_demo',
      external_reference: null,
      external_transaction_id: null,
      qr_content: null,
      qr_url: '/qris-contoh.png',
      raw_payload: { source: 'pos_demo', method: 'qris', qris_type: qrisType, qr_sample_only: true },
    }).eq('session_id', session.id).eq('order_id', order.id);
    if (paymentUpdateError) {
      await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
      console.error('Update demo sample QRIS payment failed:', paymentUpdateError.message);
      return NextResponse.json({ error: 'Data QRIS contoh gagal disiapkan.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ...data,
      order: { ...order, payment_method: label },
      paymentGateway: { provider: 'manual_demo', qrContent: null, qrUrl: '/qris-contoh.png', qrPayloadMissing: false, qrFallback: false, expiredAt: null, qrisType, sampleOnly: true },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Create demo POS order error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat membuat pesanan demo.' }, { status: 500 });
  }
}
