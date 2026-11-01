import { redirect } from 'next/navigation';
import AccountingDashboard from '@/components/AccountingDashboard';
import { getCurrentDemoSession } from '@/lib/demoSessions.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Akuntansi Demo | UMKM Berdampak', description: 'Laporan keuangan dan jurnal pada ruang demonstrasi UMKM.' };

export default async function DemoAkuntansiPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');
  return <AccountingDashboard mode="demo" businessName={session.business_name} />;
}
