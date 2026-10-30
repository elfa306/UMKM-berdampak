// "Ka-Ching!" disintesis dengan Web Audio, jadi tidak perlu file mp3.
// Browser HP memblokir suara sebelum ada sentuhan pertama; unlockSound() dipanggil dari sentuhan apa pun.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

export function unlockSound() {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

export const isSoundOn = () => {
  try { return localStorage.getItem('kasir_suara') !== 'off'; } catch { return true; }
};
export const setSoundOn = (on: boolean) => {
  try { localStorage.setItem('kasir_suara', on ? 'on' : 'off'); } catch { /* abaikan */ }
};

function nada(c: AudioContext, freq: number, mulai: number, durasi: number, volume: number, tipe: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipe;
  o.frequency.setValueAtTime(freq, mulai);
  g.gain.setValueAtTime(0.0001, mulai);
  g.gain.exponentialRampToValueAtTime(volume, mulai + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, mulai + durasi);
  o.connect(g).connect(c.destination);
  o.start(mulai);
  o.stop(mulai + durasi + 0.05);
}

export function kaChing() {
  if (!isSoundOn()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime + 0.02;
  // "Ka": klik logam singkat
  nada(c, 2100, t, 0.06, 0.25, 'square');
  // "Ching": dua dentingan bel yang saling menimpa
  nada(c, 1318.5, t + 0.07, 0.9, 0.35);
  nada(c, 1760, t + 0.15, 1.1, 0.3);
  nada(c, 2637, t + 0.15, 0.6, 0.12);
  try { navigator.vibrate?.([70, 40, 110]); } catch { /* abaikan */ }
}
