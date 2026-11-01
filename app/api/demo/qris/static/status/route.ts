import { NextResponse } from 'next/server';
import { getCurrentDemoSession } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentDemoSession();
  if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
  return NextResponse.json({ found: false, status: 'display_only', sampleOnly: true }, { headers: { 'Cache-Control': 'no-store' } });
}
