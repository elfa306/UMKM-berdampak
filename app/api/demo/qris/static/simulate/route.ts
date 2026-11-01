import { NextResponse } from 'next/server';
import { getCurrentDemoSession, isSameOriginRequest } from '@/lib/demoSessions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  const session = await getCurrentDemoSession();
  if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
  return NextResponse.json({ error: 'QRIS ini hanya gambar contoh. Untuk menguji alur pesanan, gunakan tombol simulasi internal pada invoice QRIS di Kasir Demo.' }, { status: 409 });
}
