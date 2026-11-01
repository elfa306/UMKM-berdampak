import { redirect } from 'next/navigation';
import DemoPOS from '@/components/demo/DemoPOS';
import { getCurrentDemoSession } from '@/lib/demoSessions.server';
import { getDemoPOSSnapshot } from '@/lib/demoPos.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Kasir Demo | UMKM Berdampak',
  description: 'Simulasi POS dan transaksi pada lingkungan demonstrasi UMKM Berdampak.',
};

export default async function DemoCashierPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');

  const snapshot = await getDemoPOSSnapshot(session.id);
  return (
    <DemoPOS
      businessName={session.business_name}
      businessType={session.business_type}
      mode={session.demo_mode}
      initialSnapshot={snapshot}
    />
  );
}
