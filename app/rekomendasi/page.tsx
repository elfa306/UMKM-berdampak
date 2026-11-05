import { redirect } from 'next/navigation';

// Rute lama tetap diarahkan ke halaman rekomendasi pembiayaan yang dipertahankan.
export default function RekomendasiLegacy() {
  redirect('/pembiayaan');
}
