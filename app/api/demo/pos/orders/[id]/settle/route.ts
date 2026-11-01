import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });

  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });

    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'ID pesanan tidak valid.' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Format konfirmasi pembayaran tidak valid.' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'paid' && action !== 'cancel') return NextResponse.json({ error: 'Aksi pembayaran tidak valid.' }, { status: 400 });

    if (action === 'paid') {
      const { data: payment, error: paymentError } = await getDemoAdminClient()
        .from('demo_payments')
        .select('provider')
        .eq('session_id', session.id)
        .eq('order_id', id)
        .maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment || payment.provider !== 'cash_simulation') {
        return NextResponse.json({ error: 'QRIS contoh tidak bisa melunasi pesanan. Gunakan simulator internal mode demo; pembayaran QRIS nyata belum terhubung pada fitur ini.' }, { status: 409 });
      }
    }

    const { data, error } = await getDemoAdminClient().rpc('settle_demo_pos_order', {
      p_session_id: session.id,
      p_order_id: id,
      p_action: action,
    });
    if (error) {
      console.error('Settle demo POS order RPC error:', error.message);
      if (error.message.includes('insufficient_stock_at_payment')) return NextResponse.json({ error: 'Stok sudah berubah dan tidak mencukupi untuk menyelesaikan pesanan ini. Batalkan lalu buat pesanan baru.' }, { status: 409 });
      if (error.message.includes('demo_session_expired')) return NextResponse.json({ error: 'Sesi demonstrasi sudah kedaluwarsa.' }, { status: 401 });
      if (error.message.includes('paid_order_cannot_be_cancelled')) return NextResponse.json({ error: 'Pesanan yang sudah dibayar tidak dapat dibatalkan dari kasir demo.' }, { status: 409 });
      if (error.message.includes('order_not_found')) return NextResponse.json({ error: 'Pesanan tidak ditemukan pada sesi ini.' }, { status: 404 });
      return NextResponse.json({ error: 'Status pembayaran tidak dapat diperbarui.' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, result: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Settle demo POS order error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat memproses pembayaran demo.' }, { status: 500 });
  }
}
