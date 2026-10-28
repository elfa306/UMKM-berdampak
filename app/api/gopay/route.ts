import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ambil nominal dari teks notifikasi, mis. "Rp15.000", "Rp 15.000,00", "Rp. 1.250.000"
export function parseRupiah(text: string): number | null {
  const m = text.match(/Rp\.?\s*([\d.,]+)/i);
  if (!m) return null;
  let s = m[1].replace(/[.,]+$/, '');
  s = s.replace(/,\d{1,2}$/, '');        // buang sen: ",00"
  s = s.replace(/[.,]/g, '');            // buang pemisah ribuan
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Hanya notifikasi uang masuk. Sesuaikan kata kunci dengan contoh notifikasi GoPay Merchant Anda.
const MASUK = /(terima|diterima|masuk|berhasil)/i;
const BUKAN = /(tarik|penarikan|gagal|refund|dikembalikan|dibatalkan|promo|voucher)/i;

function tokenOk(got: string | null, expected: string) {
  if (!got) return false;
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const token = process.env.GOPAY_WEBHOOK_TOKEN;
  const userId = process.env.OWNER_USER_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !userId || !url || !key) {
    return NextResponse.json({ error: 'Konfigurasi server belum lengkap' }, { status: 500 });
  }
  if (!tokenOk(req.headers.get('x-webhook-token'), token)) {
    return NextResponse.json({ error: 'Token tidak valid' }, { status: 401 });
  }

  // MacroDroid bisa mengirim JSON {title,text,ts} ATAU teks mentah; dua-duanya diterima.
  const raw = await req.text();
  let title = '', text = raw, ts = '';
  try {
    const j = JSON.parse(raw);
    title = String(j.title ?? ''); text = String(j.text ?? ''); ts = String(j.ts ?? '');
  } catch { /* bukan JSON: pakai teks mentah */ }
  const isi = `${title} ${text}`.trim();

  if (!MASUK.test(isi) || BUKAN.test(isi)) return NextResponse.json({ ok: true, diabaikan: 'bukan uang masuk' });
  const jumlah = parseRupiah(isi);
  if (!jumlah) return NextResponse.json({ ok: true, diabaikan: 'nominal tidak ditemukan' });

  // ID unik per notifikasi. Kirim ts (waktu dalam ms) dari MacroDroid agar dua pembayaran
  // dengan nominal sama tetap terhitung dua kali, sementara kiriman ulang tetap tidak dobel.
  const bucket = ts || String(Math.floor(Date.now() / 60000));
  const mutationId = 'gopay:' + crypto.createHash('sha1').update(`${isi}|${bucket}`).digest('hex');

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: baru, error } = await sb.from('qris_inbox')
    .upsert([{ user_id: userId, mutation_id: mutationId, jumlah, catatan: title.slice(0, 80) || 'GoPay Merchant' }],
      { onConflict: 'user_id,mutation_id', ignoreDuplicates: true })
    .select('id,mutation_id,jumlah,catatan');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tanggal = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const { data: sesi } = await sb.from('daily_sessions').select('id')
    .eq('user_id', userId).eq('tanggal', tanggal).maybeSingle();
  if (sesi) {
    for (const m of baru ?? []) {
      const { error: e } = await sb.from('transactions').insert({
        user_id: userId, session_id: sesi.id, jenis: 'penjualan', qty: 1, metode: 'qris',
        keterangan: 'QRIS masuk' + (m.catatan ? ` · ${String(m.catatan).slice(0, 40)}` : ''),
        jumlah: m.jumlah, ref_id: m.mutation_id,
      });
      if (!e || e.code === '23505') await sb.from('qris_inbox').update({ posted: true }).eq('id', m.id);
    }
  }
  return NextResponse.json({ ok: true, jumlah, baru: baru?.length ?? 0 });
}
