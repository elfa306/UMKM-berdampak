import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin } from '@/lib/ownerApi.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_TEXT_LENGTH = 1200;
const DEFAULT_MODEL = 'eleven_v4';
const SUPPORTED_EMOTIVE_MODELS = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3']);

/** Add server-only audio direction tags. The visible transcript remains unchanged. */
function addEmotionTag(text: string): string {
  const normalized = text.toLocaleLowerCase('id-ID');

  if (/[?？]\s*$/.test(text) || /\b(langsung saya catat|apakah|mau saya|boleh saya)\b/.test(normalized)) {
    return `[curious] ${text}`;
  }

  if (/\b(sudah saya catat|berhasil saya catat|transaksi berhasil|berhasil disimpan|sudah tersimpan)\b/.test(normalized)) {
    return `[happy] ${text}`;
  }

  if (/\b(maaf|belum bisa|belum berhasil|gagal|tidak dapat|tidak berhasil|ada kendala|terjadi kesalahan)\b/.test(normalized)) {
    return `[calm, reassuring] ${text}`;
  }

  return `[warm, conversational] ${text}`;
}
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSafeSameOrigin(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }

  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Silakan masuk ke akun CAVA terlebih dahulu.' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `Teks suara harus diisi dan maksimal ${MAX_TEXT_LENGTH} karakter.` }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voiceId) {
      return NextResponse.json({
        error: 'Atur ELEVENLABS_API_KEY dan ELEVENLABS_VOICE_ID di file .env.local untuk mengaktifkan suara CAVA.',
      }, { status: 503 });
    }

    const configuredModel = process.env.ELEVENLABS_TTS_MODEL?.trim();
    // Ignore the previous multilingual-v2 setting: it does not support Audio Tags.
    // Only allow Eleven models that support Audio Tags.
    const modelId = configuredModel && SUPPORTED_EMOTIVE_MODELS.has(configuredModel)
      ? configuredModel
      : DEFAULT_MODEL;
    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`);
    endpoint.searchParams.set('output_format', 'mp3_22050_32');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: addEmotionTag(text),
        model_id: modelId,
        language_code: 'id',
        // Eleven v4 uses stability and similarity; style/speed are not supported.
        voice_settings: {
          stability: 0.42,
          similarity_boost: 0.78,
        },
        apply_text_normalization: 'on',
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    });

    if (!response.ok) {
      const detailText = await response.text().catch(() => '');
      let providerCode = '';
      let providerMessage = '';
      try {
        const parsed = JSON.parse(detailText) as {
          detail?: { status?: string; message?: string };
          status?: string;
          message?: string;
        };
        providerCode = parsed.detail?.status || parsed.status || '';
        providerMessage = parsed.detail?.message || parsed.message || '';
      } catch {
        // Respons error tidak selalu dikirim sebagai JSON.
      }
      console.error('ElevenLabs TTS error:', response.status, providerCode, providerMessage || detailText.slice(0, 300));

      if (response.status === 401 || providerCode === 'invalid_api_key' || providerCode === 'missing_api_key') {
        return NextResponse.json({ error: 'API Key ElevenLabs tidak valid. Periksa ELEVENLABS_API_KEY di .env.local.' }, { status: 502 });
      }
      if (response.status === 402 || providerCode === 'insufficient_credits') {
        return NextResponse.json({ error: 'Kredit ElevenLabs tidak cukup untuk membuat audio. Periksa Usage/Subscription akun ElevenLabs. Jika memakai paket Free, jangan gunakan suara dari Voice Library melalui API; buat suara sendiri lewat Voice Design.' }, { status: 402 });
      }
      if (response.status === 403 || providerCode === 'voice_access_denied' || providerCode === 'feature_not_available' || providerCode === 'insufficient_permissions') {
        return NextResponse.json({ error: 'Akun atau API Key tidak memiliki akses ke suara/model ini. Pada paket Free, suara dari Voice Library tidak tersedia melalui API. Coba Voice Design milik sendiri dan pastikan izin Text to Speech aktif.' }, { status: 403 });
      }
      if (response.status === 404 || providerCode === 'voice_not_found') {
        return NextResponse.json({ error: 'Voice ID tidak ditemukan. Salin kembali Voice ID dari suara yang tersimpan di My Voices.' }, { status: 404 });
      }
      if (response.status === 429) {
        return NextResponse.json({ error: 'Batas permintaan ElevenLabs tercapai. Tunggu sebentar lalu coba lagi.' }, { status: 429 });
      }
      if (response.status === 400 || response.status === 422) {
        return NextResponse.json({ error: 'Permintaan TTS ditolak. Periksa model TTS dan teks jawaban yang dikirim.' }, { status: 502 });
      }
      return NextResponse.json({ error: `ElevenLabs gagal membuat audio (HTTP ${response.status}). Periksa Request Log untuk detail.` }, { status: 502 });
    }

    const payload = await response.json().catch(() => null) as {
      audio_base64?: string;
      alignment?: {
        characters?: string[];
        character_start_times_seconds?: number[];
        character_end_times_seconds?: number[];
      } | null;
      normalized_alignment?: {
        characters?: string[];
        character_start_times_seconds?: number[];
        character_end_times_seconds?: number[];
      } | null;
    } | null;
    if (typeof payload?.audio_base64 !== 'string' || !payload.audio_base64) {
      return NextResponse.json({ error: 'ElevenLabs tidak mengembalikan data audio yang valid.' }, { status: 502 });
    }

    const audio = Buffer.from(payload.audio_base64, 'base64');
    if (audio.length < 1000 || audio.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Audio yang dihasilkan tidak valid atau terlalu besar.' }, { status: 502 });
    }

    const alignment = payload.alignment ?? payload.normalized_alignment ?? null;
    return NextResponse.json({ audio_base64: payload.audio_base64, alignment }, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-CAVA-TTS-Provider': 'elevenlabs',
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('CAVA ElevenLabs TTS error:', error);
    return NextResponse.json({ error: 'Suara belum dapat dibuat. Coba putar ulang jawaban.' }, { status: 502 });
  }
}
