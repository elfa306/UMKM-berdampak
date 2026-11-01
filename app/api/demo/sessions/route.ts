import { NextResponse } from 'next/server';
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_MAX_AGE_SECONDS,
  createDemoSession,
  getDemoAdminClient,
  hashClientIp,
  hashDemoToken,
  isDemoBusinessType,
  isDemoMode,
  isSameOriginRequest,
} from '@/lib/demoSessions.server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Format permintaan tidak valid.' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Format permintaan tidak valid.' }, { status: 400 });
  }

  const businessType = body.businessType;
  const mode = body.mode;
  const businessName = typeof body.businessName === 'string' ? body.businessName : undefined;

  if (!isDemoBusinessType(businessType) || !isDemoMode(mode)) {
    return NextResponse.json({ error: 'Jenis usaha atau mode demonstrasi tidak valid.' }, { status: 400 });
  }
  if (businessName && businessName.trim().length > 80) {
    return NextResponse.json({ error: 'Nama usaha maksimal 80 karakter.' }, { status: 400 });
  }

  try {
    const admin = getDemoAdminClient();
    const { data: allowed, error: rateError } = await admin.rpc('consume_demo_session_rate_limit', {
      p_ip_hash: hashClientIp(request),
      p_limit: 100,
      p_window_seconds: 900,
    });
    if (rateError) {
      console.error('Demo rate limit error:', rateError.message);
      return NextResponse.json({ error: 'Sistem demo belum siap. Pastikan migration_v6 sudah dijalankan.' }, { status: 503 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Terlalu banyak sesi demo dibuat dari jaringan ini. Coba kembali beberapa menit lagi.' }, { status: 429 });
    }

    const { error: cleanupError } = await admin.rpc('cleanup_expired_demo_sessions');
    if (cleanupError) console.warn('Demo cleanup skipped:', cleanupError.message);

    const cookieStore = await cookies();
    const previousToken = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
    const created = await createDemoSession({ businessType, mode, businessName });

    // Setelah sesi baru dan data awal berhasil dibuat, sesi sebelumnya diakhiri.
    if (previousToken) {
      const { error: endPreviousError } = await admin.from('demo_sessions')
        .update({ status: 'ended', last_seen_at: new Date().toISOString() })
        .eq('token_hash', hashDemoToken(previousToken))
        .eq('status', 'active');
      if (endPreviousError) {
        await admin.from('demo_sessions').delete().eq('id', created.session.id);
        throw endPreviousError;
      }
    }

    const response = NextResponse.json({
      ok: true,
      session: {
        id: created.session.id,
        businessType: created.session.business_type,
        mode: created.session.demo_mode,
        businessName: created.session.business_name,
        createdAt: created.session.created_at,
        expiresAt: created.session.expires_at,
        productCount: created.productCount,
      },
      redirectTo: '/demo/ruang',
    });

    response.cookies.set({
      name: DEMO_SESSION_COOKIE,
      value: created.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Create demo session error:', error);
    return NextResponse.json({
      error: 'Tidak dapat membuat sesi demonstrasi. Periksa konfigurasi server dan migration_v6.',
    }, { status: 500 });
  }
}
