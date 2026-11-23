import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin, type OwnerContext } from '@/lib/ownerApi.server';
import { publicAiError, transcribeWithAssemblyAI, type SpeechContext } from '@/lib/aiProvider.server';
import { correctTranscript } from '@/lib/transcriptCorrection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

type AudioQualityInput = {
  durationMs: number;
  rms: number;
  peak: number;
  silenceRatio: number;
  clippingRatio: number;
};

// Hanya metadata numerik yang diterima; tidak menyimpan audio atau isi transkrip ke log.
function parseAudioQuality(value: FormDataEntryValue | null): AudioQualityInput | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const keys = ['durationMs', 'rms', 'peak', 'silenceRatio', 'clippingRatio'] as const;
    if (!parsed || typeof parsed !== 'object' || keys.some((key) => typeof parsed[key] !== 'number' || !Number.isFinite(parsed[key]))) return null;
    const quality = parsed as unknown as AudioQualityInput;
    if (quality.durationMs < 0 || quality.durationMs > 60_000) return null;
    if (quality.rms < 0 || quality.rms > 1 || quality.peak < 0 || quality.peak > 1) return null;
    if (quality.silenceRatio < 0 || quality.silenceRatio > 1 || quality.clippingRatio < 0 || quality.clippingRatio > 1) return null;
    return quality;
  } catch {
    return null;
  }
}

// Data usaha diambil khusus dari akun yang sedang login. Kegagalan query
// katalog tidak boleh menggagalkan transkripsi suara.
async function loadSpeechContext(ctx: OwnerContext): Promise<SpeechContext> {
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
    return { businessName, productNames: Array.from(new Set(productNames)) };
  } catch {
    return { businessName: '', productNames: [] };
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

    const audioQuality = parseAudioQuality(form.get('audio_quality'));
    if (audioQuality) {
      console.info(
        `[CAVA ASR] kualitas audio: durasi=${audioQuality.durationMs}ms rms=${audioQuality.rms} peak=${audioQuality.peak} hening=${audioQuality.silenceRatio} clipping=${audioQuality.clippingRatio}`,
      );
    }

    // Upload audio ke AssemblyAI berjalan bersamaan dengan pembacaan katalog Supabase.
    const speechContextPromise = loadSpeechContext(ctx);
    const [speechContext, asr] = await Promise.all([
      speechContextPromise,
      transcribeWithAssemblyAI(audio, speechContextPromise, request.signal),
    ]);

    const { text: transcript, changes } = correctTranscript(asr.transcript, speechContext.productNames);
    if (changes.length) console.info(`[CAVA ASR] koreksi katalog: ${changes.length} koreksi`);

    return NextResponse.json(
      {
        transcript,
        provider: asr.provider,
        asr: {
          model: asr.model,
          languageCode: asr.languageCode,
          confidence: asr.confidence,
          lowConfidenceWordCount: asr.lowConfidenceWordCount,
        },
        ...(changes.length ? { rawTranscript: asr.transcript, corrections: changes } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('CAVA voice transcription error:', error);
    const message = publicAiError(error, 'Suara belum bisa diproses.');
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
