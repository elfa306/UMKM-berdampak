import { NextResponse } from 'next/server';
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_MAX_AGE_SECONDS,
  createDemoSession,
  getCurrentDemoSession,
  getDemoAdminClient,
  hashClientIp,
  isSameOriginRequest,
} from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }

  try {
    const current = await getCurrentDemoSession();
    if (!current) {
      return NextResponse.json({ error: 'Sesi demonstrasi sudah berakhir. Mulai sesi baru dari halaman demo.' }, { status: 401 });
    }

    const admin = getDemoAdminClient();
    const { data: allowed, error: rateError } = await admin.rpc('consume_demo_session_rate_limit', {
      p_ip_hash: hashClientIp(request),
      p_limit: 100,
      p_window_seconds: 900,
    });
    if (rateError) {
      console.error('Demo reset rate limit error:', rateError.message);
      return NextResponse.json({ error: 'Sistem demo belum siap. Pastikan migration_v6 sudah dijalankan.' }, { status: 503 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Terlalu banyak aktivitas demo dari jaringan ini. Coba kembali beberapa menit lagi.' }, { status: 429 });
    }

    // Buat sesi pengganti terlebih dahulu. Jika gagal, sesi lama tetap bisa dipakai.
    const created = await createDemoSession({
      businessType: current.business_type,
      mode: current.demo_mode,
      businessName: current.business_name,
    });

    // Tandai sesi lama berakhir, tetapi pertahankan relasi pembayaran selama masa
    // retry callback provider. Webhook pembayaran terlambat tetap perlu dipetakan.
    const { error: endError } = await admin.from('demo_sessions')
      .update({ status: 'ended', last_seen_at: new Date().toISOString() })
      .eq('id', current.id);
    if (endError) {
      await admin.from('demo_sessions').delete().eq('id', created.session.id);
      throw endError;
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
    });
    response.cookies.set({ name: DEMO_SESSION_COOKIE, value: created.token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DEMO_SESSION_MAX_AGE_SECONDS });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Reset demo session error:', error);
    return NextResponse.json({ error: 'Gagal mengatur ulang sesi demonstrasi. Silakan coba kembali.' }, { status: 500 });
  }
}
