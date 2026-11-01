import { NextResponse } from 'next/server';
import { verifyBelibayarWebhookSignature } from '@/lib/belibayarSandbox.server';
import { getDemoAdminClient } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function POST(request: Request) {
  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.length === 0 || rawBody.length > 128 * 1024) {
      return NextResponse.json({ success: false, messages: 'Invalid body size' }, { status: 413 });
    }
    const signature = request.headers.get('x-belibayar-signature') || '';
    if (!verifyBelibayarWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ success: false, messages: 'Invalid signature' }, { status: 401 });
    }

    let payload: unknown;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
      return NextResponse.json({ success: false, messages: 'Invalid JSON' }, { status: 400 });
    }
    if (!isObject(payload)) return NextResponse.json({ success: false, messages: 'Invalid payload' }, { status: 400 });

    // Callback Belibayar dapat dipakai bersama untuk pembayaran dan penarikan.
    // Tahap ini hanya memproses pembayaran QRIS Sandbox; event withdrawal di-ack tanpa diproses.
    if (typeof payload.event === 'string') {
      return NextResponse.json({ success: true, ignored: true, reason: 'Non-payment event' });
    }
    if (payload.payment_method !== 'qris') {
      return NextResponse.json({ success: true, ignored: true, reason: 'Payment method not used by demo' });
    }

    const status = payload.status;
    const transactionId = typeof payload.transaction_id === 'string' ? payload.transaction_id : '';
    const amount = Number(payload.amount);
    const reference = typeof payload.reference === 'string' ? payload.reference : '';
    if (!transactionId || transactionId.length > 64 || !reference || reference.length > 128 || !Number.isSafeInteger(amount) || amount < 1) {
      return NextResponse.json({ success: false, messages: 'Invalid payment fields' }, { status: 400 });
    }
    if (status !== 'paid' && status !== 'expired' && status !== 'cancelled') {
      return NextResponse.json({ success: true, ignored: true, reason: 'Unknown payment status' });
    }

    const admin = getDemoAdminClient();
    if (isObject(payload.static_qr)) {
      // QRIS statis memiliki reference transaksi per pembayaran. Pemetaan sesi berasal
      // dari static_qr.merchant_reference atau static_qr.reference, bukan payload.reference.
      if (status !== 'paid') return NextResponse.json({ success: true, ignored: true, reason: 'Static QR webhook is not paid' });
      const staticQr = payload.static_qr;
      const merchantReference = typeof staticQr.merchant_reference === 'string' ? staticQr.merchant_reference : null;
      const providerReference = typeof staticQr.reference === 'string' ? staticQr.reference : null;
      const { data, error } = await admin.rpc('record_demo_belibayar_static_payment', {
        p_merchant_reference: merchantReference,
        p_provider_reference: providerReference,
        p_transaction_id: transactionId,
        p_webhook_reference: reference,
        p_amount: amount,
        p_payload: payload,
      });
      if (error) {
        // Webhook dapat dikirim ulang. Jika transaksi sudah ada, jawab 2xx tanpa menggandakan omzet.
        const { data: duplicate } = await admin.from('demo_payments')
          .select('id').eq('provider', 'belibayar_sandbox').eq('external_transaction_id', transactionId).maybeSingle();
        if (duplicate) return NextResponse.json({ success: true, duplicate: true });
        console.error('Belibayar static webhook RPC error:', error.message);
        return NextResponse.json({ success: false, messages: 'Static payment could not be recorded' }, { status: 503 });
      }
      return NextResponse.json({ success: true, result: data });
    }

    const { data, error } = await admin.rpc('apply_demo_belibayar_dynamic_webhook', {
      p_reference: reference,
      p_transaction_id: transactionId,
      p_amount: amount,
      p_status: status,
      p_payload: payload,
    });
    if (error) {
      // Jika provider mengirim ulang transaction_id yang sudah diproses, ACK agar
      // callback tidak terus diulang. Jangan pernah menganggap transaksi baru lunas.
      const { data: duplicate } = await admin.from('demo_payments')
        .select('id')
        .eq('provider', 'belibayar_sandbox')
        .eq('external_transaction_id', transactionId)
        .maybeSingle();
      if (duplicate) return NextResponse.json({ success: true, duplicate: true });
      console.error('Belibayar dynamic webhook RPC error:', error.message);
      // Reference tidak cocok / transaksi belum dikenal akan dicoba ulang oleh provider.
      return NextResponse.json({ success: false, messages: 'Payment reference could not be matched' }, { status: 503 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    console.error('Belibayar webhook handler error:', error);
    return NextResponse.json({ success: false, messages: 'Webhook processing failed' }, { status: 500 });
  }
}
