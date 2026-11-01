import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';
import { getDemoLedgerSnapshot } from '@/lib/ledgerSnapshot.server';
import { recordDemoEvent } from '@/lib/demoDashboard.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MONEY = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000_000_000;

export async function GET(request: Request) {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau kedaluwarsa.' }, { status: 401 });
    const month = new URL(request.url).searchParams.get('month') ?? undefined;
    const snapshot = await getDemoLedgerSnapshot(getDemoAdminClient(), session.id, month);
    await recordDemoEvent({
      sessionId: session.id,
      eventType: 'profit_loss_viewed',
      idempotencyKey: 'mission:profit_loss_viewed',
      metadata: { source: 'demo_accounting_dashboard' },
    });
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo accounting snapshot error:', error);
    return NextResponse.json({ error: 'Laporan akuntansi demo gagal dimuat. Pastikan migration v13 sudah dijalankan.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demo tidak ditemukan atau kedaluwarsa.' }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || body.action !== 'manual_entry') return NextResponse.json({ error: 'Aksi akuntansi tidak dikenal.' }, { status: 400 });
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const amount = Number(body.amount);
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 250) : '';
    const paymentAccount = body.paymentAccount === '1010' ? '1010' : '1000';
    if (!['expense', 'capital', 'draw', 'supplier_payment', 'labor_payment', 'overhead_payment'].includes(kind) || !MONEY(amount) || !description) return NextResponse.json({ error: 'Jenis, nominal, dan keterangan wajib diisi dengan benar.' }, { status: 400 });
    const { data, error } = await getDemoAdminClient().rpc('create_demo_accounting_manual_entry', { p_session_id: session.id, p_kind: kind, p_amount: amount, p_description: description, p_payment_account: paymentAccount });
    if (error) {
      console.error('Create demo accounting entry error:', error.message);
      return NextResponse.json({ error: 'Pencatatan jurnal demo gagal. Periksa migration v13.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Post demo accounting entry error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat mencatat jurnal demo.' }, { status: 500 });
  }
}
