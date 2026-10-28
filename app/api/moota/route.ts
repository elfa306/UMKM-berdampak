import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const runtime = 'nodejs';

type Mut = {
  mutation_id?: string; account_number?: string; date?: string;
  description?: string; amount?: number | string; type?: string;
};

// Moota menandatangani isi webhook dengan HMAC-SHA256 memakai secret token (header "Signature").
// Cocokkan nama header & format dengan dokumentasi Moota terbaru sebelum produksi.
function signatureOk(raw: string, sig: string | null, secret: string) {
  if (!sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.MOOTA_SECRET;
  const userId = process.env.MOOTA_USER_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !userId || !url || !key) return NextResponse.json({ error: 'Konfigurasi server belum lengkap' }, { status: 500 });

  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get('signature'), secret)) return NextResponse.json({ error: 'Signature tidak valid' }, { status: 401 });

  let body: Mut[];
  try { const j = JSON.parse(raw); body = Array.isArray(j) ? j : [j]; }
  catch { return NextResponse.json({ error: 'JSON tidak valid' }, { status: 400 }); }

  // Hanya uang masuk (CR)
  const masuk = body.filter((m) => String(m.type ?? '').toUpperCase() === 'CR' && Number(m.amount) > 0);
  const rows = masuk.map((m) => ({
    user_id: userId,
    mutation_id: m.mutation_id ?? crypto.createHash('sha1').update(`${m.account_number}|${m.date}|${m.amount}|${m.description}`).digest('hex'),
    jumlah: Math.round(Number(m.amount)),
    catatan: (m.description ?? '').slice(0, 80),
  }));
  if (!rows.length) return NextResponse.json({ ok: true, diterima: 0 });

  const sb = createClient(url, key, { auth: { persistSession: false } });
  // Simpan ke inbox; duplikat (mutation_id sama) diabaikan sehingga webhook aman dikirim ulang
  const { data: baru, error } = await sb.from('qris_inbox')
    .upsert(rows, { onConflict: 'user_id,mutation_id', ignoreDuplicates: true }).select('id,mutation_id,jumlah,catatan');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Jika hari ini sudah "mulai berjualan", langsung catat sebagai penjualan QRIS
  const tanggal = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const { data: sesi } = await sb.from('daily_sessions').select('id').eq('user_id', userId).eq('tanggal', tanggal).maybeSingle();
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
  return NextResponse.json({ ok: true, diterima: baru?.length ?? 0 });
}
