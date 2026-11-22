// Aturan kapan Cashie boleh berbicara lebih dulu (tanpa diminta pengguna).
// Tujuannya: Cashie tahu kapan harus bicara dan kapan diam.
// Semua status disimpan di localStorage per perangkat; jika penyimpanan
// diblokir, Cashie memilih diam (aman) kecuali untuk sapaan pertama.

const STORE_KEY = 'cava:cashie-proactive:v1';

export const PROACTIVE_MIN_GAP_MS = 15 * 60 * 1000; // jeda antar pesan proaktif
export const PROACTIVE_MAX_PER_DAY = 4;             // batas pesan proaktif per hari
export const PROACTIVE_MAX_DISMISS_STREAK = 2;      // ditutup 2x berturut-turut → diam hari ini

type ProactiveState = {
  day: string;
  count: number;
  lastAt: number;
  dismissStreak: number;
  spoken: Record<string, number>; // kunci topik → waktu terakhir disampaikan
};

function jakartaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(now));
}

function emptyState(day: string): ProactiveState {
  return { day, count: 0, lastAt: 0, dismissStreak: 0, spoken: {} };
}

function readState(now: number): ProactiveState | null {
  const day = jakartaDay(now);
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState(day);
    const parsed = JSON.parse(raw) as Partial<ProactiveState>;
    if (parsed.day !== day) return emptyState(day); // hari baru → mulai bersih
    return {
      day,
      count: Number(parsed.count) || 0,
      lastAt: Number(parsed.lastAt) || 0,
      dismissStreak: Number(parsed.dismissStreak) || 0,
      spoken: parsed.spoken && typeof parsed.spoken === 'object' ? parsed.spoken : {},
    };
  } catch {
    return null;
  }
}

function writeState(state: ProactiveState) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {
    // Penyimpanan lokal yang diblokir tidak boleh mengganggu asisten.
  }
}

/** Ada dialog/modal terbuka atau tab tidak terlihat → jangan menyela. */
export function isUserBusyElsewhere(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState !== 'visible') return true;
  return document.querySelector('dialog[open]') !== null;
}

export type ProactiveOptions = {
  /** Topik yang hanya boleh disampaikan sekali per hari (mis. "greeting"). */
  oncePerDay?: boolean;
  /** Pesan penting boleh melewati jeda antar pesan, tapi tidak melewati batas harian. */
  bypassGap?: boolean;
};

export function canSpeakProactively(key: string, options: ProactiveOptions = {}, now = Date.now()): boolean {
  if (typeof window === 'undefined' || isUserBusyElsewhere()) return false;
  const state = readState(now);
  if (!state) return false;
  if (state.dismissStreak >= PROACTIVE_MAX_DISMISS_STREAK) return false;
  if (state.count >= PROACTIVE_MAX_PER_DAY) return false;
  if (options.oncePerDay !== false && state.spoken[key]) return false;
  if (!options.bypassGap && state.lastAt && now - state.lastAt < PROACTIVE_MIN_GAP_MS) return false;
  return true;
}

/** Topik ini sudah pernah disampaikan hari ini (selamanya untuk hari tersebut). */
export function hasSpokenProactiveToday(key: string, now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const state = readState(now);
  return Boolean(state?.spoken[key]);
}

export function markProactiveSpoken(key: string, now = Date.now()) {
  const state = readState(now) ?? emptyState(jakartaDay(now));
  state.count += 1;
  state.lastAt = now;
  state.spoken[key] = now;
  writeState(state);
}

/** Pengguna menutup pesan proaktif tanpa menanggapi. */
export function markProactiveDismissed(now = Date.now()) {
  const state = readState(now);
  if (!state) return;
  state.dismissStreak += 1;
  writeState(state);
}

/** Pengguna menanggapi (bicara, mengetuk, atau menekan V) → Cashie boleh aktif lagi. */
export function markProactiveEngaged(now = Date.now()) {
  const state = readState(now);
  if (!state || state.dismissStreak === 0) return;
  state.dismissStreak = 0;
  writeState(state);
}
