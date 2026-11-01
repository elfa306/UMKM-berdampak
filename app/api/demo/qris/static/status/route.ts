import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const transactionId = new URL(request.url).searchParams.get('transactionId') || '';
    if (!transactionId || transactionId.length > 64) return NextResponse.json({ error: 'ID transaksi tidak valid.' }, { status: 400 });

    const { data: payment, error } = await getDemoAdminClient()
      .from('demo_payments')
      .select('id,order_id,status,amount,paid_at,external_transaction_id')
      .eq('session_id', session.id)
      .eq('provider', 'belibayar_sandbox')
      .eq('external_transaction_id', transactionId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) return NextResponse.json({ found: false, status: 'processing' }, { headers: { 'Cache-Control': 'no-store' } });

    const { data: order, error: orderError } = await getDemoAdminClient()
      .from('demo_orders')
      .select('id,invoice_no,status,total,payment_method,paid_at')
      .eq('id', payment.order_id)
      .eq('session_id', session.id)
      .maybeSingle();
    if (orderError) throw orderError;
    return NextResponse.json({ found: true, paymentStatus: payment.status, order }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get static QRIS status error:', error);
    return NextResponse.json({ error: 'Status pembayaran tidak dapat diperiksa.' }, { status: 500 });
  }
}
