/** Pengenal perintah sederhana yang dijalankan langsung di perangkat tanpa memanggil AI. */

const MONTH_NAMES = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|agt|sep|sept|okt|nov|des)\b/;

/** Perintah unduh laporan yang jelas ("ekspor excel", "unduh laporan bulan lalu") dijalankan langsung tanpa AI. */
export function matchLocalExport(raw: string, today: string): { month: string; openReport: boolean } | null {
  const text = raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!text || text.split(' ').length > 14) return null;
  if (!/\b(ekspor|export|eksport|unduh|download|donlot|undh)\b/.test(text) && !/\b(excel|xlsx)\b/.test(text)) return null;
  if (!/\b(excel|xlsx|laporan|akuntansi)\b/.test(text)) return null;
  if (/\b(catat|hapus|ubah|tambah|bayar|beli|jual)\b/.test(text) || MONTH_NAMES.test(text) || /\b\d{4}\b/.test(text)) return null;
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const target = /\bbulan (lalu|kemarin|sebelumnya)\b/.test(text) ? new Date(Date.UTC(year, month - 2, 1)) : new Date(Date.UTC(year, month - 1, 1));
  return { month: target.toISOString().slice(0, 7), openReport: /\b(buka|lihat|tampilkan|tunjukkan)\b/.test(text) && /\blaporan\b/.test(text) };
}

