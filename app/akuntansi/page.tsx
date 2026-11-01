import AccountingDashboard from '@/components/AccountingDashboard';

export const metadata = { title: 'Akuntansi & Laporan Keuangan | UMKM Berdampak', description: 'Jurnal, laporan laba rugi, posisi keuangan, arus kas, dan catatan usaha.' };

export default function AkuntansiPage() {
  return <AccountingDashboard mode="production" />;
}
