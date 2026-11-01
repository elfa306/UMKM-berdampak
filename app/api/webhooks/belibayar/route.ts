import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Belibayar has been retired from UMKM Berdampak. The example QRIS image is display-only.
// Return 410 so delayed callbacks from old Sandbox attempts cannot mutate demo orders.
export async function POST() {
  return NextResponse.json(
    { success: false, error: 'Belibayar integration is no longer used by this application.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
