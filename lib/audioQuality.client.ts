export type AudioQualitySummary = {
  durationMs: number;
  rms: number;
  peak: number;
  silenceRatio: number;
  clippingRatio: number;
};

/**
 * Pemeriksaan ringan pada rekaman yang sudah dibuat.
 * Tidak mengubah audio: browser getUserMedia tetap menangani echo cancellation
 * dan noise suppression. Jika codec tidak bisa didekode, analisis dilewati.
 */
export async function analyzeAudioQuality(blob: Blob): Promise<AudioQualitySummary | null> {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;

  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    let sampleCount = 0;
    let sumSquares = 0;
    let peak = 0;
    let silentSamples = 0;
    let clippedSamples = 0;

    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
      const channel = decoded.getChannelData(channelIndex);
      for (let index = 0; index < channel.length; index += 1) {
        const magnitude = Math.abs(channel[index]);
        sampleCount += 1;
        sumSquares += magnitude * magnitude;
        if (magnitude > peak) peak = magnitude;
        if (magnitude < 0.008) silentSamples += 1;
        if (magnitude >= 0.985) clippedSamples += 1;
      }
    }

    if (!sampleCount) return null;
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    return {
      durationMs: Math.round(decoded.duration * 1000),
      rms: round(Math.sqrt(sumSquares / sampleCount)),
      peak: round(peak),
      silenceRatio: round(silentSamples / sampleCount),
      clippingRatio: round(clippedSamples / sampleCount),
    };
  } catch {
    return null;
  } finally {
    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }
}
