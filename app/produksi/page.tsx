import ManufacturingManager from '@/components/ManufacturingManager';

export const metadata = { title: 'Produksi & HPP | UMKM Berdampak', description: 'Kelola resep produksi, bahan baku, batch, dan harga pokok produksi.' };

export default function ProduksiPage() {
  return <ManufacturingManager mode="production" />;
}
