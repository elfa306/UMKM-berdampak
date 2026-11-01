import { redirect } from 'next/navigation';
import ManufacturingManager from '@/components/ManufacturingManager';
import { getCurrentDemoSession } from '@/lib/demoSessions.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Produksi Demo | UMKM Berdampak', description: 'Coba produksi dan perhitungan HPP pada ruang demonstrasi.' };

export default async function DemoProduksiPage() {
  const session = await getCurrentDemoSession();
  if (!session) redirect('/demo');
  return <ManufacturingManager mode="demo" businessName={session.business_name} />;
}
