import { redirect } from 'next/navigation';
import DemoDashboard from '@/components/demo/DemoDashboard';
import {
  getCurrentDemoSession,
  getDemoProductCount,
} from '@/lib/demoSessions.server';
import {
  getDemoGuidedMissions,
  getDemoDashboardSnapshot,
  getDemoMissionProgress,
} from '@/lib/demoDashboard.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Dashboard Demonstrasi | UMKM Berdampak',
  description: 'Dashboard usaha interaktif dalam lingkungan demonstrasi UMKM Berdampak.',
};

export default async function DemoRoomPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');

  const missions = getDemoGuidedMissions(session.business_type);
  const [productCount, snapshot, missionProgress] = await Promise.all([
    getDemoProductCount(session.id),
    getDemoDashboardSnapshot(session.id),
    getDemoMissionProgress(session.id, missions),
  ]);

  return (
    <DemoDashboard
      session={{
        id: session.id,
        businessType: session.business_type,
        mode: session.demo_mode,
        businessName: session.business_name,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        productCount,
      }}
      snapshot={snapshot}
      missionProgress={missionProgress}
      missions={missions}
    />
  );
}
