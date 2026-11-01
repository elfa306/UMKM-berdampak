import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'ID pesanan tidak valid.' }, { status: 400 });

    const admin = getDemoAdminClient();
    const { data: order, error: orderError } = await admin.from('demo_orders')
      .select('id,invoice_no,status,total,payment_method,paid_at')
      .eq('id', id).eq('session_id', session.id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });

    const { data: payment, error: paymentError } = await admin.from('demo_payments')
      .select('provider,status,external_transaction_id,expires_at,merchant_fee,net_credit')
      .eq('order_id', id).eq('session_id', session.id).maybeSingle();
    if (paymentError) throw paymentError;
    return NextResponse.json({ order, payment }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo order payment status error:', error);
    return NextResponse.json({ error: 'Status pesanan tidak dapat diperiksa.' }, { status: 500 });
  }
}
