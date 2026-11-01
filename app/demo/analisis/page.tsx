import { redirect } from 'next/navigation';
import DemoBusinessAnalysis from '@/components/demo/DemoBusinessAnalysis';
import { getCurrentDemoSession, getDemoAdminClient } from '@/lib/demoSessions.server';
import { getDemoLedgerSnapshot } from '@/lib/ledgerSnapshot.server';
import { recordDemoEvent } from '@/lib/demoDashboard.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Analisis Usaha Demo | UMKM Berdampak', description: 'Analisis ringkas kesehatan keuangan pada ruang demonstrasi UMKM.' };

export default async function DemoAnalisisPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');
  const snapshot = await getDemoLedgerSnapshot(getDemoAdminClient(), session.id);
  await recordDemoEvent({
    sessionId: session.id,
    eventType: 'financing_recommendation_viewed',
    idempotencyKey: 'mission:financing_recommendation_viewed',
    metadata: { source: 'demo_business_analysis' },
  });
  return <DemoBusinessAnalysis businessName={session.business_name} businessType={session.business_type} snapshot={snapshot} />;
}
