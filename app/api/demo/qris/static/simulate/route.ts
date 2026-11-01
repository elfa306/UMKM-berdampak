import { NextResponse } from 'next/server';
import { simulateStaticQris, isBelibayarSandboxConfigured } from '@/lib/belibayarSandbox.server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    if (!isBelibayarSandboxConfigured()) return NextResponse.json({ error: 'API Key, Secret Key, dan Webhook Secret Belibayar Sandbox belum dikonfigurasi.' }, { status: 503 });

    let payload: unknown;
    try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Format nominal tidak valid.' }, { status: 400 }); }
    const amount = Number((payload as { amount?: unknown } | null)?.amount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
      return NextResponse.json({ error: 'Nominal harus berupa bilangan bulat antara Rp1 dan Rp100.000.000.' }, { status: 400 });
    }

    const { data: qr, error } = await getDemoAdminClient()
      .from('demo_static_qris')
      .select('merchant_reference,provider_reference,status')
      .eq('session_id', session.id)
      .maybeSingle();
    if (error) throw error;
    if (!qr || qr.status !== 'active') return NextResponse.json({ error: 'Buat QRIS statis terlebih dahulu.' }, { status: 409 });

    // Belibayar menerima reference provider atau merchant_reference; gunakan reference milik merchant yang unik per sesi.
    const result = await simulateStaticQris(qr.merchant_reference, amount);
    return NextResponse.json({ ok: true, transactionId: result.transaction_id, amount: result.amount, fee: result.fee, netAmount: result.net_amount, message: 'Simulasi dikirim. Menunggu webhook Belibayar.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulasi QRIS statis gagal.';
    console.error('Simulate demo static QRIS error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
