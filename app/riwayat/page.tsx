import { redirect } from 'next/navigation';

// Riwayat kini menyatu dengan Statistik. Alamat lama tetap jalan dan diarahkan ke halaman gabungan.
export default function Riwayat() {
  redirect('/statistik');
}
