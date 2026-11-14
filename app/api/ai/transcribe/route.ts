import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin } from '@/lib/ownerApi.server';
import { publicAiError, transcribeWithFallback } from '@/lib/aiProvider.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

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

    const { transcript, provider } = await transcribeWithFallback(audio);
    return NextResponse.json({ transcript, provider }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('CAVA voice transcription error:', error);
    const message = publicAiError(error, 'Suara belum bisa diproses.');
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
