'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { rupiah, todayISO } from '@/lib/accounting';
import { kaChing } from '@/lib/sound';
import {
  SAMPLE_PRODUCTS,
  ensureTodaySession,
  type QuickSavedDetail,
  type QuickSavedRow,
} from '@/lib/quickSession';
import { QRIS_MATCH_EVENT, publishActiveInvoice } from '@/lib/qrisBridge';

type PanelProduct = { id: string; nama: string; harga: number };
type InvoiceItem = { productId: string; nama: string; harga: number; qty: number; subtotal: number };
type Invoice = {
  id: string;
  invoice_no: string;
  total: number;
  items: InvoiceItem[];
  status: 'pending' | 'paid_manual';
  paid_at?: string | null;
  notificationMatch?: boolean;
};
type Msg = { kind: 'ok' | 'err'; text: string } | null;

const jam = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

/**
 * Kasir QRIS di dalam "Catat Transaksi → Uang masuk → QRIS".
 * Ketuk produk untuk mengisi keranjang (tanpa mengetik harga), lalu pilih QRIS Statis
 * atau buat invoice QRIS Dinamis. Setiap pembayaran yang dikonfirmasi diumumkan ke beranda.
 */
export default function QrisCashier({
  active,
  onRecorded,
}: {
  active: boolean;
  onRecorded: (detail: QuickSavedDetail) => void;
}) {
  const tanggal = todayISO();
  const [guest, setGuest] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [products, setProducts] = useState<PanelProduct[]>([]);
  const [jenis, setJenis] = useState<'statis' | 'dinamis'>('statis');
  const [keranjang, setKeranjang] = useState<Record<string, number>>({});
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [confirmType, setConfirmType] = useState<'statis' | 'dinamis' | null>(null);
  const [busy, setBusy] = useState(false);
  const [staticDone, setStaticDone] = useState<{ total: number; count: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const staticKeyRef = useRef<string | null>(null);

  const cartLines = useMemo(
    () =>
      Object.entries(keranjang)
        .map(([id, qty]) => {
          const product = products.find((item) => item.id === id);
          return product ? { product, qty } : null;
        })
        .filter((line): line is { product: PanelProduct; qty: number } => line !== null),
    [keranjang, products],
  );
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.harga * line.qty, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.qty, 0);

  // Muat produk dan invoice dinamis yang masih menunggu (bila sudah login).
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) {
        setGuest(true);
        setProducts(SAMPLE_PRODUCTS);
        setLoaded(true);
        return;
      }
      setGuest(false);
      const [p, s] = await Promise.all([
        supabase
          .from('products')
          .select('id,nama,harga')
          .eq('aktif', true)
          .in('jenis_item', ['merchandise', 'finished_good', 'service'])
          .order('created_at'),
        supabase.from('daily_sessions').select('id,modal_harian').eq('tanggal', tanggal).maybeSingle(),
      ]);
      if (!alive) return;
      setProducts((p.data ?? []).map((x) => ({ id: x.id as string, nama: x.nama as string, harga: Number(x.harga) })));
      if (s.data?.id && Number(s.data.modal_harian) > 0) {
        const saved = await supabase
          .from('qris_invoice_drafts')
          .select('id,invoice_no,total,items,status,paid_at')
          .eq('session_id', s.data.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (alive && saved.data) {
          setJenis('dinamis');
          setInvoice({
            id: saved.data.id,
            invoice_no: saved.data.invoice_no,
            total: Number(saved.data.total),
            items: Array.isArray(saved.data.items) ? (saved.data.items as InvoiceItem[]) : [],
            status: 'pending',
            paid_at: saved.data.paid_at,
            notificationMatch: false,
          });
        }
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [active, tanggal]);

  // Beranda memberi tahu bila ada notifikasi GoPay dengan nominal yang sama dengan invoice.
  useEffect(() => {
    const onMatch = () => setInvoice((current) => (current ? { ...current, notificationMatch: true } : current));
    window.addEventListener(QRIS_MATCH_EVENT, onMatch);
    return () => window.removeEventListener(QRIS_MATCH_EVENT, onMatch);
  }, []);

  // Beranda perlu tahu invoice yang sedang menunggu.
  useEffect(() => {
    if (!loaded) return;
    publishActiveInvoice(invoice && invoice.status === 'pending' ? { invoice_no: invoice.invoice_no, total: invoice.total } : null);
  }, [invoice, loaded]);

  const flash = (kind: 'ok' | 'err', text: string) => setMsg({ kind, text });

  function tambah(product: PanelProduct) {
    if (invoice) return flash('err', 'Tutup invoice QRIS yang terbuka sebelum membuat pesanan baru.');
    setMsg(null);
    staticKeyRef.current = null;
    setStaticDone(null);
    setKeranjang((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
  }

  function ubahJumlah(productId: string, delta: number) {
    setKeranjang((current) => {
      const next = { ...current };
      const value = (next[productId] ?? 0) + delta;
      if (value <= 0) delete next[productId];
      else next[productId] = value;
      return next;
    });
  }

  function kosongkan() {
    staticKeyRef.current = null;
    setKeranjang({});
  }

  async function buatInvoice() {
    if (!cartLines.length || jenis !== 'dinamis' || invoice) return;
    setMsg(null);
    const items: InvoiceItem[] = cartLines.map(({ product, qty }) => ({
      productId: product.id,
      nama: product.nama,
      harga: product.harga,
      qty,
      subtotal: product.harga * qty,
    }));
    const invoiceNo = `INV-${tanggal.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;

    if (guest) {
      // Mode tamu: invoice contoh hanya di layar.
      setInvoice({ id: `local-${crypto.randomUUID()}`, invoice_no: invoiceNo, total: cartTotal, items, status: 'pending' });
      setKeranjang({});
      return flash('ok', 'Mode tamu: invoice contoh dibuat dan tidak disimpan.');
    }

    const sessionId = await ensureTodaySession(tanggal);
    if (!sessionId) return flash('err', 'Modal harian belum diisi. Buka Beranda CAVA dan isi modal harian terlebih dahulu.');
    const { data, error } = await supabase
      .from('qris_invoice_drafts')
      .insert({ session_id: sessionId, invoice_no: invoiceNo, total: cartTotal, items, status: 'pending' })
      .select('id,invoice_no,total,items')
      .single();
    if (error) {
      return flash(
        'err',
        error.message.includes('qris_invoice_drafts')
          ? 'Tabel invoice QRIS belum tersedia. Jalankan migration_v14_qris_invoice_drafts.sql di Supabase.'
          : `Invoice QRIS gagal dibuat: ${error.message}`,
      );
    }
    setInvoice({
      id: data.id,
      invoice_no: data.invoice_no,
      total: Number(data.total),
      items: Array.isArray(data.items) ? (data.items as InvoiceItem[]) : items,
      status: 'pending',
      notificationMatch: false,
    });
    setKeranjang({});
    flash('ok', 'Invoice QRIS dinamis dibuat. QR yang tampil masih contoh dan tidak dapat dibayar.');
  }

  async function tutupInvoice() {
    if (!invoice) return;
    if (!invoice.id.startsWith('local-')) {
      const { error } = await supabase
        .from('qris_invoice_drafts')
        .update({ status: 'cancelled' })
        .eq('id', invoice.id)
        .eq('status', 'pending');
      if (error) return flash('err', `Invoice tidak dapat ditutup: ${error.message}`);
    }
    const sudahLunas = invoice.status === 'paid_manual';
    setInvoice(null);
    flash('ok', sudahLunas ? 'Invoice ditutup. Pencatatan simulasi tetap tersimpan.' : 'Invoice QRIS ditutup tanpa membuat transaksi.');
  }

  function mintaKonfirmasi(type: 'statis' | 'dinamis') {
    if (busy) return;
    if (type === 'statis' && !cartLines.length) return flash('err', 'Tambahkan produk ke keranjang sebelum mencatat pembayaran.');
    if (type === 'dinamis' && (!invoice || invoice.status !== 'pending')) return flash('err', 'Invoice QRIS dinamis tidak tersedia atau sudah diproses.');
    if (type === 'statis' && !staticKeyRef.current) staticKeyRef.current = crypto.randomUUID();
    setConfirmType(type);
  }

  async function konfirmasiDibayar() {
    if (!confirmType || busy) return;
    const type = confirmType;
    const total = type === 'statis' ? cartTotal : (invoice?.total ?? 0);
    const baris =
      type === 'statis'
        ? cartLines.map(({ product, qty }) => ({ productId: product.id, nama: product.nama, qty, subtotal: product.harga * qty }))
        : (invoice?.items ?? []).map((item) => ({ productId: item.productId, nama: item.nama, qty: item.qty, subtotal: item.subtotal }));
    const count = baris.reduce((sum, b) => sum + b.qty, 0);
    if (total <= 0) return flash('err', 'Total pembayaran harus lebih dari nol.');

    const selesai = (recordedTotal: number, label: string) => {
      if (type === 'dinamis') {
        setInvoice((current) => (current ? { ...current, status: 'paid_manual', paid_at: new Date().toISOString() } : current));
      } else {
        setKeranjang({});
        setStaticDone({ total: recordedTotal, count });
        staticKeyRef.current = null;
      }
      setConfirmType(null);
      kaChing();
      flash('ok', `${label} tercatat sebagai pembayaran simulasi sebesar ${rupiah(recordedTotal)}.`);
    };

    if (guest) {
      // Mode tamu: dicatat di layar beranda saja, tidak masuk database.
      const now = new Date().toISOString();
      const rows: QuickSavedRow[] = baris.map((b) => ({
        id: crypto.randomUUID(),
        jenis: 'penjualan',
        keterangan: `${b.nama} × ${b.qty}`,
        jumlah: b.subtotal,
        metode: 'qris',
        qty: b.qty,
        created_at: now,
        payment_source: 'qris_simulation',
      }));
      selesai(total, type === 'statis' ? 'QRIS Statis (mode tamu)' : `QRIS Dinamis ${invoice?.invoice_no ?? ''}`.trim());
      onRecorded({ guest: true, rows });
      return;
    }

    setBusy(true);
    setMsg(null);
    const sessionId = await ensureTodaySession(tanggal);
    if (!sessionId) {
      setBusy(false);
      setConfirmType(null);
      return flash('err', 'Modal harian belum diisi. Isi modal harian di Beranda CAVA terlebih dahulu. Tidak ada transaksi yang dicatat.');
    }
    const { data, error } = await supabase.rpc('confirm_qris_payment_simulation', {
      p_session_id: sessionId,
      p_qris_type: type,
      p_items: type === 'statis' ? cartLines.map(({ product, qty }) => ({ productId: product.id, qty })) : null,
      p_invoice_id: type === 'dinamis' ? invoice?.id : null,
      p_confirmation_key: type === 'statis' ? staticKeyRef.current : null,
    });
    setBusy(false);
    if (error) {
      const message = error.message || 'Konfirmasi pembayaran gagal.';
      setConfirmType(null);
      if (message.includes('insufficient_stock')) return flash('err', 'Stok salah satu produk tidak mencukupi. Tidak ada transaksi yang dicatat.');
      if (message.includes('confirm_qris_payment_simulation'))
        return flash('err', 'Fitur belum tersedia. Jalankan migration_v15_qris_simulation_confirmation.sql di Supabase terlebih dahulu.');
      return flash('err', `Pembayaran simulasi gagal dicatat: ${message}`);
    }
    const recordedTotal = Number(data?.total ?? total);
    const rows = (Array.isArray(data?.transactions) ? data.transactions : []) as QuickSavedRow[];
    selesai(recordedTotal, type === 'statis' ? 'QRIS Statis' : `QRIS Dinamis ${invoice?.invoice_no ?? ''}`.trim());
    onRecorded({ guest: false, rows });
  }

  const confirmTotal = confirmType === 'statis' ? cartTotal : (invoice?.total ?? 0);

  return (
    <div className="mt-3 space-y-3">
      <div className="seg" role="group" aria-label="Jenis QRIS">
        <button type="button" className={jenis === 'statis' ? 'on' : ''} onClick={() => setJenis('statis')} disabled={!!invoice}>
          QRIS Statis
        </button>
        <button type="button" className={jenis === 'dinamis' ? 'on' : ''} onClick={() => setJenis('dinamis')} disabled={!!invoice}>
          QRIS Dinamis
        </button>
      </div>
      <p className="muted">
        Ketuk produk untuk menambah ke keranjang, harga terisi otomatis. QRIS Statis langsung tampil di layar; QRIS Dinamis membuat invoice lebih dulu.
      </p>

      {msg && (
        <p role={msg.kind === 'err' ? 'alert' : 'status'} className={msg.kind === 'err' ? 'err' : 'note ok'}>
          {msg.text}
        </p>
      )}

      {!loaded ? (
        <p className="muted">Memuat produk…</p>
      ) : products.length === 0 ? (
        <p className="muted">Belum ada produk. Tambahkan di menu Inventaris.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {products.map((p) => (
            <button key={p.id} type="button" className="tile" onClick={() => tambah(p)} disabled={!!invoice}>
              <span className="tile-name">{p.nama}</span>
              <span>
                <span className="tile-price block">{rupiah(p.harga)}</span>
                {keranjang[p.id] ? <span className="tile-qty mt-1.5 inline-block">Di keranjang: {keranjang[p.id]}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-[18px] bg-[#EEF5F1] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <b className="text-sm text-[#103A57]">Keranjang QRIS</b>
            <p className="mt-0.5 text-[11px] font-semibold text-[#4F6B7C]">{cartCount} item dipilih</p>
          </div>
          <button
            type="button"
            onClick={kosongkan}
            disabled={!cartLines.length || !!invoice}
            className="rounded-full bg-white px-3 py-1.5 text-[11px] font-extrabold text-[#103A57] disabled:opacity-40"
          >
            Kosongkan
          </button>
        </div>

        {cartLines.length ? (
          <div className="mt-3 space-y-2.5">
            {cartLines.map(({ product, qty }) => (
              <div key={product.id} className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-xs text-[#103A57]">{product.nama}</b>
                  <span className="text-[11px] font-semibold text-[#4F6B7C] tabular-nums">
                    {rupiah(product.harga)} × {qty}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => ubahJumlah(product.id, -1)} disabled={!!invoice} className="qty-btn" aria-label={`Kurangi ${product.nama}`}>
                    −
                  </button>
                  <span className="w-5 text-center text-xs font-extrabold text-[#103A57]">{qty}</span>
                  <button type="button" onClick={() => ubahJumlah(product.id, 1)} disabled={!!invoice} className="qty-btn" aria-label={`Tambah ${product.nama}`}>
                    +
                  </button>
                </div>
                <b className="w-[78px] text-right text-xs tabular-nums text-[#103A57]">{rupiah(product.harga * qty)}</b>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-[#103A57]/10 pt-2.5">
              <span className="text-xs font-bold text-[#4F6B7C]">Total</span>
              <strong className="text-lg tabular-nums text-[#103A57]">{rupiah(cartTotal)}</strong>
            </div>
          </div>
        ) : (
          !invoice && <p className="mt-3 rounded-xl bg-white p-3 text-center text-xs font-semibold text-[#4F6B7C]">Keranjang kosong. Ketuk produk di atas.</p>
        )}

        {jenis === 'statis' ? (
          <div className="mt-3 rounded-2xl bg-white p-3.5">
            <div className="text-center">
              <b className="text-sm text-[#103A57]">QRIS Statis · Tampil Langsung</b>
              <p className="mt-1 text-[11px] font-semibold text-[#4F6B7C]">Tanpa invoice. Pelanggan biasanya mengisi nominal sendiri.</p>
            </div>
            <img src="/qris-contoh.png" alt="QRIS contoh statis yang tidak dapat menerima pembayaran" className="mx-auto mt-3 aspect-square w-full max-w-[230px] rounded-xl bg-white object-contain" />
            <div className="mt-2 text-center text-sm font-extrabold tabular-nums text-[#103A57]">Total pilihan produk: {rupiah(cartTotal)}</div>
            <p className="note mt-2.5">Gambar ini hanya contoh visual dan tidak dapat menerima pembayaran. Tombol di bawah hanya membuat pencatatan simulasi, bukan bukti dana masuk.</p>
            <button type="button" onClick={() => mintaKonfirmasi('statis')} disabled={!cartLines.length || busy} className="btn-main mt-3 disabled:opacity-40">
              {busy ? 'Menyimpan…' : 'Tandai sudah dibayar · simulasi'}
            </button>
            {staticDone && (
              <p className="note ok mt-2.5">
                ✅ Pembayaran simulasi terakhir tercatat: {rupiah(staticDone.total)} untuk {staticDone.count} item. {guest ? 'Sudah masuk ke beranda (mode tamu, tidak disimpan ke laporan).' : 'Sudah masuk ke beranda dan laporan.'}
              </p>
            )}
          </div>
        ) : invoice ? (
          <div className="mt-3 rounded-2xl bg-white p-3.5">
            <div className="flex items-center justify-between gap-2">
              <b className="text-sm text-[#103A57]">Invoice QRIS Dinamis</b>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${invoice.status === 'paid_manual' ? 'bg-[#366B2B]/15 text-[#366B2B]' : 'bg-amber-100 text-amber-900'}`}>
                {invoice.status === 'paid_manual' ? 'Lunas · simulasi' : 'Menunggu'}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold text-[#307B8E]">{invoice.invoice_no}</p>
            <div className="mt-2.5 space-y-1.5 rounded-xl bg-[#EEF5F1] p-3">
              {invoice.items.map((item, index) => (
                <div key={`${item.productId}-${index}`} className="flex justify-between gap-3 text-[11px] font-semibold text-[#103A57]">
                  <span>
                    {item.nama} × {item.qty}
                  </span>
                  <b className="tabular-nums">{rupiah(item.subtotal)}</b>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-[#103A57]/10 pt-2 text-sm text-[#103A57]">
                <b>Total invoice</b>
                <strong className="tabular-nums">{rupiah(invoice.total)}</strong>
              </div>
            </div>
            <img src="/qris-contoh.png" alt="QRIS dinamis contoh untuk tampilan invoice" className="mx-auto mt-3 aspect-square w-full max-w-[230px] rounded-xl bg-white object-contain" />
            <p className="note mt-2.5">
              QR di atas tetap gambar contoh yang sama, bukan QR dinamis yang membawa nominal atau referensi invoice. Tombol konfirmasi hanya mencatat simulasi manual dan tidak memverifikasi dana dari bank atau GoPay Merchant.
            </p>
            {invoice.notificationMatch && invoice.status === 'pending' && (
              <p className="note ok mt-2.5">
                Ada notifikasi GoPay/MacroDroid dengan nominal yang sama. Cocokkan waktu dan mutasi di aplikasi merchant sebelum memakai konfirmasi manual.
              </p>
            )}
            {invoice.status === 'pending' && (
              <button type="button" onClick={() => mintaKonfirmasi('dinamis')} disabled={busy} className="btn-main mt-3 disabled:opacity-40">
                {busy ? 'Menyimpan…' : 'Tandai sudah dibayar · simulasi'}
              </button>
            )}
            {invoice.status === 'paid_manual' && (
              <p className="note ok mt-2.5">
                ✅ Pembayaran simulasi tercatat{invoice.paid_at ? ` pada ${jam(invoice.paid_at)}` : ''}. {guest ? ' Transaksi sudah masuk ke beranda (mode tamu, tidak disimpan ke laporan).' : ' Transaksi sudah masuk ke beranda dan laporan.'}
              </p>
            )}
            <button type="button" onClick={tutupInvoice} className="btn-ghost mt-2.5">
              {invoice.status === 'pending' ? 'Tutup / batalkan invoice' : 'Tutup invoice'}
            </button>
          </div>
        ) : (
          <button type="button" onClick={buatInvoice} disabled={!cartLines.length} className="btn-main mt-3 disabled:opacity-40">
            Buat invoice QRIS dinamis
          </button>
        )}
      </div>

      {confirmType &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-[#103A57]/60 p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qris-confirm-title"
          >
            <div className="w-full max-w-md rounded-t-[26px] bg-white p-5 shadow-2xl sm:rounded-[22px]">
              <h2 id="qris-confirm-title" className="text-base font-extrabold text-[#103A57]">
                Konfirmasi pembayaran QRIS
              </h2>
              <p className="mt-2.5 text-sm leading-6 text-[#4F6B7C]">
                QRIS yang tampil adalah gambar contoh dan tidak bisa menerima uang. Melanjutkan akan membuat <b className="text-[#103A57]">transaksi simulasi</b> sebesar{' '}
                <b className="text-[#103A57]">{rupiah(confirmTotal)}</b>, memperbarui stok yang dilacak, dan memasukkannya ke beranda dan laporan dengan label{' '}
                <b className="text-[#103A57]">QRIS Simulasi</b>.
              </p>
              <p className="note mt-3">Jangan gunakan tombol ini sebagai bukti pembayaran sungguhan. Untuk transaksi nyata, periksa dana di aplikasi merchant terlebih dahulu.</p>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <button type="button" disabled={busy} onClick={() => setConfirmType(null)} className="btn-ghost">
                  Kembali
                </button>
                <button type="button" disabled={busy} onClick={konfirmasiDibayar} className="btn-main !w-full disabled:opacity-50">
                  {busy ? 'Menyimpan…' : 'Ya, catat simulasi'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
