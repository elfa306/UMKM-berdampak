import { redirect } from 'next/navigation';
import DemoInventory from '@/components/demo/DemoInventory';
import { getCurrentDemoSession } from '@/lib/demoSessions.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Persediaan Demo | UMKM Berdampak',
  description: 'Kelola stok, pemasok, pembelian, dan mutasi persediaan pada ruang demonstrasi.',
};

export default async function DemoInventoryPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');
  return <DemoInventory businessName={session.business_name} businessType={session.business_type} mode={session.demo_mode} />;
}
