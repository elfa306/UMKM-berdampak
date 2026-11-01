import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createStaticQris, isBelibayarSandboxConfigured } from '@/lib/belibayarSandbox.server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const { data, error } = await getDemoAdminClient()
      .from('demo_static_qris')
      .select('provider_reference,merchant_reference,label,qr_content,status,created_at')
      .eq('session_id', session.id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ qr: data ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo static QRIS error:', error);
    return NextResponse.json({ error: 'QRIS statis demo gagal dimuat.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    if (!isBelibayarSandboxConfigured()) return NextResponse.json({ error: 'API Key, Secret Key, dan Webhook Secret Belibayar Sandbox belum dikonfigurasi di server.' }, { status: 503 });

    const admin = getDemoAdminClient();
    const { data: existing, error: existingError } = await admin
      .from('demo_static_qris')
      .select('provider_reference,merchant_reference,label,qr_content,status,created_at')
      .eq('session_id', session.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === 'active') return NextResponse.json({ ok: true, qr: existing, reused: true }, { headers: { 'Cache-Control': 'no-store' } });

    // Reference buatan merchant: unik per sesi, tidak mengandung token cookie.
    const merchantReference = `DEMOQR_${session.id.replace(/-/g, '')}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const label = `${session.business_name} - Demo`.slice(0, 100);
    const created = await createStaticQris({ reference: merchantReference, label });

    const { data: saved, error: saveError } = await admin
      .from('demo_static_qris')
      .upsert({
        session_id: session.id,
        provider_reference: created.reference,
        merchant_reference: merchantReference,
        label,
        qr_content: created.qr_content,
        status: created.status,
        raw_payload: created,
      }, { onConflict: 'session_id' })
      .select('provider_reference,merchant_reference,label,qr_content,status,created_at')
      .single();
    if (saveError || !saved) throw new Error(`QR berhasil dibuat tetapi gagal disimpan: ${saveError?.message ?? 'data kosong'}`);
    return NextResponse.json({ ok: true, qr: saved, reused: false }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'QRIS statis gagal dibuat.';
    console.error('Create demo static QRIS error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
