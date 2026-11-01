import InventoryManager from '@/components/InventoryManager';

export const metadata = {
  title: 'Inventaris | UMKM Berdampak',
  description: 'Kelola katalog barang, pemasok, penerimaan pembelian, dan mutasi persediaan UMKM.',
};

export default function InventarisPage() {
  return <InventoryManager />;
}
