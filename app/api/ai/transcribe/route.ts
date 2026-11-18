import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin, type OwnerContext } from '@/lib/ownerApi.server';
import { publicAiError, transcribeWithFallback } from '@/lib/aiProvider.server';
import { correctTranscript } from '@/lib/transcriptCorrection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

// Nama produk aktif dipakai untuk mengoreksi salah dengar (mis. "ST" -> "Es Teh").
// Tidak pernah gagal: bila katalog tidak terbaca, koreksi katalog dilewati saja.
async function loadProductNames(ctx: OwnerContext): Promise<string[]> {
  try {
    const { data, error } = await ctx.userClient.from('products').select('nama').eq('user_id', ctx.user.id).eq('aktif', true).limit(200);
    if (error) return [];
    return ((data ?? []) as Array<{ nama: string | null }>).map((row) => String(row.nama ?? '')).filter(Boolean);
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
    const namesPromise = loadProductNames(ctx);
    const { transcript: rawTranscript, provider } = await transcribeWithFallback(audio);
    const { text: transcript, changes } = correctTranscript(rawTranscript, await namesPromise);
    if (changes.length) console.info(`[CAVA AI] autocorrect transkrip: ${changes.length} koreksi (${changes.map((change) => change.reason).join(', ')})`);

    return NextResponse.json(
      { transcript, provider, ...(changes.length ? { rawTranscript, corrections: changes } : {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('CAVA voice transcription error:', error);
    const message = publicAiError(error, 'Suara belum bisa diproses.');
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
