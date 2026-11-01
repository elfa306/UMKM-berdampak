import { NextResponse } from 'next/server';
import { getCurrentDemoSession, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sample = { provider_reference: 'CONTOH-QRIS', merchant_reference: 'CONTOH-DEMO', label: 'QRIS Contoh UMKM Berdampak', qr_content: null, qr_url: '/qris-contoh.png', status: 'display_only', sample_only: true };

export async function GET() {
  const session = await getCurrentDemoSession();
  if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
  return NextResponse.json({ qr: sample }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  const session = await getCurrentDemoSession();
  if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
  return NextResponse.json({ ok: true, qr: sample, reused: true, message: 'QRIS contoh siap ditampilkan; tidak memproses pembayaran.' }, { headers: { 'Cache-Control': 'no-store' } });
}
