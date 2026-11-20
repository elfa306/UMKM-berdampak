import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin, type OwnerContext } from '@/lib/ownerApi.server';
import { publicAiError, transcribeWithFallback } from '@/lib/aiProvider.server';
import { correctTranscript } from '@/lib/transcriptCorrection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

// Referensi koreksi transkrip mencakup nama usaha dan produk aktif pemilik.
// Kegagalan membaca salah satu sumber tidak boleh menggagalkan transkripsi.
async function loadSpeechNames(ctx: OwnerContext): Promise<string[]> {
  try {
    const [productsResult, profileResult] = await Promise.all([
      ctx.userClient.from('products').select('nama').eq('user_id', ctx.user.id).eq('aktif', true).limit(200),
      ctx.userClient.from('business_profiles').select('nama_usaha').eq('user_id', ctx.user.id).maybeSingle(),
    ]);
    const productNames = productsResult.error ? [] : ((productsResult.data ?? []) as Array<{ nama: string | null }>)
      .map((row) => String(row.nama ?? '').trim()).filter(Boolean);
    const businessName = !profileResult.error
      ? String((profileResult.data as { nama_usaha?: string | null } | null)?.nama_usaha ?? '').trim()
      : '';
    return Array.from(new Set([...(businessName ? [businessName] : []), ...productNames]));
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  if (!isSafeSameOrigin(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Silakan masuk ke akun CAVA terlebih dahulu.' }, { status: 401 });

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File)) return NextResponse.json({ error: 'Rekaman suara tidak ditemukan.' }, { status: 400 });
    if (audio.size < 1200) return NextResponse.json({ error: 'Rekaman terlalu singkat. Tahan tombol V sedikit lebih lama.' }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'Rekaman terlalu besar. Coba ucapkan perintah dengan durasi lebih singkat.' }, { status: 413 });

    // Ambil katalog bersamaan dengan transkripsi agar tidak menambah latensi.
    const namesPromise = loadSpeechNames(ctx);
    const { transcript: rawTranscript, provider } = await transcribeWithFallback(audio, request.signal);
    const { text: transcript, changes } = correctTranscript(rawTranscript, await namesPromise);
    if (changes.length) console.info(`[CAVA AI] autocorrect transkrip: ${changes.length} koreksi (${changes.map((change) => change.reason).join(', ')})`);

    return NextResponse.json(
      { transcript, provider, ...(changes.length ? { rawTranscript, corrections: changes } : {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('CAVA voice transcription error:', error);
    const message = publicAiError(error, 'Suara belum bisa diproses.');
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
