import { NextResponse } from 'next/server';
import {
  DEMO_SESSION_COOKIE,
  getCurrentDemoSession,
  getDemoAdminClient,
  getDemoProductCount,
  isSameOriginRequest,
} from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentDemoSession();
    if (!session) {
      return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    }
    const productCount = await getDemoProductCount(session.id);
    return NextResponse.json({
      session: {
        id: session.id,
        businessType: session.business_type,
        mode: session.demo_mode,
        businessName: session.business_name,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        productCount,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo session error:', error);
    return NextResponse.json({ error: 'Gagal memeriksa sesi demonstrasi.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }
  try {
    const session = await getCurrentDemoSession();
    if (session) {
      const { error } = await getDemoAdminClient()
        .from('demo_sessions')
        .update({ status: 'ended', last_seen_at: new Date().toISOString() })
        .eq('id', session.id);
      if (error) throw error;
    }
    const response = NextResponse.json({ ok: true, message: 'Sesi demonstrasi telah diakhiri.' });
    response.cookies.set({ name: DEMO_SESSION_COOKIE, value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('End demo session error:', error);
    return NextResponse.json({ error: 'Gagal mengakhiri sesi demonstrasi.' }, { status: 500 });
  }
}
