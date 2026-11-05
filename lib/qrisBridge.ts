/**
 * Jembatan kecil antara panel QRIS di modal Catat Transaksi dan beranda.
 * Beranda perlu tahu invoice dinamis yang sedang menunggu agar notifikasi GoPay/MacroDroid
 * dengan nominal yang sama bisa dicocokkan.
 */
export type ActiveInvoice = { invoice_no: string; total: number } | null;

declare global {
  interface Window {
    __cavaActiveInvoice?: ActiveInvoice;
  }
}

export function publishActiveInvoice(invoice: ActiveInvoice) {
  if (typeof window === 'undefined') return;
  window.__cavaActiveInvoice = invoice;
}

export function getActiveInvoice(): ActiveInvoice {
  if (typeof window === 'undefined') return null;
  return window.__cavaActiveInvoice ?? null;
}

export const QRIS_MATCH_EVENT = 'cava:qris-match';

export function announceInvoiceMatch(invoiceNo: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QRIS_MATCH_EVENT, { detail: { invoiceNo } }));
}
