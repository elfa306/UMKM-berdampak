import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 20 * 1024;

// Ambil nominal dari notifikasi, mis. "Rp15.000", "Rp 15.000,00", "Rp. 1.250.000".
function parseRupiah(value: string): number | null {
  const match = value.match(/Rp\.?\s*([\d.,]+)/i);
  if (!match) return null;

  let normalized = match[1].replace(/[.,]+$/, '');
  normalized = normalized.replace(/,\d{1,2}$/, '');
  normalized = normalized.replace(/[.,]/g, '');

  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

// Pola ini dipertahankan agar payload MacroDroid lama tetap kompatibel.
const MASUK = /(terima|diterima|masuk|berhasil)/i;
const BUKAN = /(tarik|penarikan|gagal|refund|dikembalikan|dibatalkan|promo|voucher)/i;

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest();

function safeEqual(a: string, b: string) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function parseNotification(raw: string): { title: string; text: string; ts: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      title: String(parsed.title ?? ''),
      text: String(parsed.text ?? ''),
      ts: String(parsed.ts ?? ''),
    };
  } catch {
    // Kompatibilitas untuk pengiriman teks mentah dari konfigurasi MacroDroid lama.
    const titleMatch = raw.match(/"title"\s*:\s*"([\s\S]*?)"\s*,\s*"text"\s*:/);
    const textMatch = raw.match(/"text"\s*:\s*"([\s\S]*?)"\s*,\s*"ts"\s*:/);
    const timestampMatch = raw.match(/"ts"\s*:\s*"?([^"}\s,]*)"?\s*}?\s*$/);
    if (textMatch) {
      return {
        title: titleMatch?.[1] ?? '',
        text: textMatch[1],
        ts: timestampMatch?.[1] ?? '',
      };
    }
    return { title: '', text: raw, ts: '' };
  }
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Konfigurasi server belum lengkap' }, { status: 500 });
  }

  const receivedToken = req.headers.get('x-webhook-token')?.trim();
  if (!receivedToken) return NextResponse.json({ error: 'Token tidak valid' }, { status: 401 });

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload terlalu besar' }, { status: 413 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Token per akun disimpan sebagai SHA-256. Fallback env dipertahankan untuk integrasi lama.
  const tokenHash = sha256(receivedToken).toString('hex');
  const { data: tokenRow, error: tokenLookupError } = await supabase
    .from('webhook_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (tokenLookupError) {
    console.error('GoPay webhook token lookup failed:', tokenLookupError.message);
    return NextResponse.json({ error: 'Tidak dapat memvalidasi token' }, { status: 500 });
  }

  let userId: string | null = tokenRow?.user_id ?? null;
  if (!userId) {
    const legacyToken = process.env.GOPAY_WEBHOOK_TOKEN;
    const legacyUserId = process.env.OWNER_USER_ID;
    if (legacyToken && legacyUserId && safeEqual(receivedToken, legacyToken)) {
      userId = legacyUserId;
    }
  }
  if (!userId) return NextResponse.json({ error: 'Token tidak valid' }, { status: 401 });

  const { title, text, ts } = parseNotification(raw);
  const combinedText = `${title} ${text}`.trim();
  if (!combinedText) return NextResponse.json({ ok: true, ignored: 'empty_notification' });
  if (!MASUK.test(combinedText) || BUKAN.test(combinedText)) {
    return NextResponse.json({ ok: true, ignored: 'not_incoming_payment' });
  }

  const amount = parseRupiah(combinedText);
  if (!amount) return NextResponse.json({ ok: true, ignored: 'amount_not_found' });

  // Timestamp MacroDroid wajib dipertahankan dalam BODY agar retry notifikasi yang sama
  // terdeteksi sebagai duplikat. Fallback 1 menit menjaga kompatibilitas setup lama.
  const dedupeBucket = ts.trim() || String(Math.floor(Date.now() / 60000));
  const mutationId = 'gopay:' + crypto.createHash('sha1')
    .update(`${combinedText}|${dedupeBucket}`)
    .digest('hex');

  // RPC membuat inbox + transaksi harian secara atomik dan idempotent.
  const { data: result, error: ingestError } = await supabase.rpc('ingest_gopay_notification', {
    p_user_id: userId,
    p_mutation_id: mutationId,
    p_amount: amount,
    p_note: title.slice(0, 80) || 'GoPay Merchant',
    p_notification_ts: ts.trim() || null,
  });

  if (ingestError) {
    console.error('GoPay notification ingest failed:', ingestError.message);
    return NextResponse.json({ error: 'Pembayaran diterima tetapi gagal dicatat', code: ingestError.code ?? null }, { status: 500 });
  }

  const outcome = (result ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    source: 'gopay_macrodroid',
    amount,
    duplicate: Boolean(outcome.duplicate),
    posted: Boolean(outcome.posted),
    awaitingDailySession: !Boolean(outcome.posted),
  });
}
