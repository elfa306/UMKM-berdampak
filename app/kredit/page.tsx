import { redirect } from 'next/navigation';

// Fitur Nilai Usaha telah diganti dengan Rekomendasi Pembiayaan.
// URL lama tetap diarahkan agar tautan atau bookmark sebelumnya tidak rusak.
export default function KreditLegacyRedirect() {
  redirect('/pembiayaan');
}
