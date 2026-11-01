import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// Simulasi ini sepenuhnya internal untuk sesi demo. Tidak menghubungi penyedia QRIS.
export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'ID pesanan tidak valid.' }, { status: 400 });

    let payload: unknown;
    try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Format simulasi tidak valid.' }, { status: 400 }); }
    const action = (payload as { action?: unknown } | null)?.action;
    if (action !== 'success' && action !== 'expire') return NextResponse.json({ error: 'Aksi simulasi harus success atau expire.' }, { status: 400 });

    const admin = getDemoAdminClient();
    const { data: payment, error: paymentError } = await admin.from('demo_payments')
      .select('status,provider,raw_payload')
      .eq('session_id', session.id).eq('order_id', id).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || payment.provider !== 'manual_demo' || payment.raw_payload?.qr_sample_only !== true) {
      return NextResponse.json({ error: 'Invoice ini bukan pembayaran QRIS contoh pada sesi demo.' }, { status: 404 });
    }
    if (payment.status !== 'pending') return NextResponse.json({ error: `Pembayaran sudah berstatus ${payment.status}.` }, { status: 409 });

    const result = await admin.rpc('settle_demo_pos_order', {
      p_session_id: session.id,
      p_order_id: id,
      p_action: action === 'success' ? 'paid' : 'cancel',
    });
    if (result.error) {
      console.error('Settle internal demo QRIS simulation error:', result.error.message);
      if (result.error.message.includes('insufficient_stock_at_payment')) return NextResponse.json({ error: 'Stok berubah dan tidak mencukupi untuk menyelesaikan pesanan.' }, { status: 409 });
      return NextResponse.json({ error: 'Simulasi pembayaran tidak dapat diselesaikan.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action, result: result.data, message: action === 'success' ? 'Simulasi internal demo berhasil. Tidak ada uang sungguhan yang diterima.' : 'Invoice demo dibatalkan.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Simulate internal demo QRIS error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat menjalankan simulasi demo.' }, { status: 500 });
  }
}
