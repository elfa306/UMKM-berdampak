import { NextResponse } from 'next/server';
import { simulateDynamicQris, isBelibayarSandboxConfigured } from '@/lib/belibayarSandbox.server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    if (!isBelibayarSandboxConfigured()) return NextResponse.json({ error: 'API Key, Secret Key, dan Webhook Secret Belibayar Sandbox belum dikonfigurasi.' }, { status: 503 });

    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'ID pesanan tidak valid.' }, { status: 400 });
    let payload: unknown;
    try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Format simulasi tidak valid.' }, { status: 400 }); }
    const action = (payload as { action?: unknown } | null)?.action;
    if (action !== 'success' && action !== 'expire') return NextResponse.json({ error: 'Aksi simulasi harus success atau expire.' }, { status: 400 });

    const { data: payment, error } = await getDemoAdminClient()
      .from('demo_payments')
      .select('external_reference,status,provider')
      .eq('session_id', session.id)
      .eq('order_id', id)
      .eq('provider', 'belibayar_sandbox')
      .maybeSingle();
    if (error) throw error;
    if (!payment?.external_reference) return NextResponse.json({ error: 'Pembayaran QRIS Belibayar untuk invoice ini tidak ditemukan.' }, { status: 404 });
    if (payment.status !== 'pending') return NextResponse.json({ error: `Pembayaran sudah berstatus ${payment.status}.` }, { status: 409 });

    const result = await simulateDynamicQris(payment.external_reference, action);
    return NextResponse.json({ ok: true, action, result, message: 'Simulasi dikirim. Menunggu webhook Belibayar.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulasi pembayaran gagal.';
    console.error('Simulate dynamic QRIS error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
