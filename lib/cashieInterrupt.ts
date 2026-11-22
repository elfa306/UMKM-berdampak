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
  spoken: Record<string, number>; // kunci topik → waktu terakhir disampaikan (bertahan lintas hari)
};

const SPOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const QUIET_HOURS = { from: 22, to: 5 }; // 22.00–04.59 WIB Cashie tidak memulai percakapan

function jakartaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(now));
}

function emptyState(day: string, spoken: Record<string, number> = {}): ProactiveState {
  return { day, count: 0, lastAt: 0, dismissStreak: 0, spoken };
}

function pruneSpoken(value: unknown, now: number): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    const time = Number(at);
    if (Number.isFinite(time) && now - time < SPOKEN_RETENTION_MS) result[key] = time;
  }
  return result;
}

export function jakartaHour(now = Date.now()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(now))) % 24;
}

export function isQuietHours(now = Date.now()): boolean {
  const hour = jakartaHour(now);
  return hour >= QUIET_HOURS.from || hour < QUIET_HOURS.to;
}

function readState(now: number): ProactiveState | null {
  const day = jakartaDay(now);
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState(day);
    const parsed = JSON.parse(raw) as Partial<ProactiveState>;
    const spoken = pruneSpoken(parsed.spoken, now);
    if (parsed.day !== day) return emptyState(day, spoken); // hari baru → hitungan harian bersih, riwayat topik tetap
    return {
      day,
      count: Number(parsed.count) || 0,
      lastAt: Number(parsed.lastAt) || 0,
      dismissStreak: Number(parsed.dismissStreak) || 0,
      spoken,
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
  /** Topik yang sama tidak diulang sebelum sekian hari berlalu (bawaan 1 = sekali per hari). */
  cooldownDays?: number;
  /** Pesan penting boleh melewati jeda antar pesan, tapi tidak melewati batas harian. */
  bypassGap?: boolean;
};

function spokenWithinCooldown(state: ProactiveState, key: string, cooldownDays: number, now: number): boolean {
  const last = state.spoken[key];
  if (!last) return false;
  const lastDay = Date.parse(`${jakartaDay(last)}T00:00:00Z`);
  const today = Date.parse(`${jakartaDay(now)}T00:00:00Z`);
  return Math.round((today - lastDay) / DAY_MS) < cooldownDays;
}

export function canSpeakProactively(key: string, options: ProactiveOptions = {}, now = Date.now()): boolean {
  if (typeof window === 'undefined' || isUserBusyElsewhere() || isQuietHours(now)) return false;
  const state = readState(now);
  if (!state) return false;
  if (state.dismissStreak >= PROACTIVE_MAX_DISMISS_STREAK) return false;
  if (state.count >= PROACTIVE_MAX_PER_DAY) return false;
  if (spokenWithinCooldown(state, key, options.cooldownDays ?? 1, now)) return false;
  if (!options.bypassGap && state.lastAt && now - state.lastAt < PROACTIVE_MIN_GAP_MS) return false;
  return true;
}

/** Topik ini sudah pernah disampaikan hari ini (selamanya untuk hari tersebut). */
export function hasSpokenProactiveToday(key: string, now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const state = readState(now);
  return state ? spokenWithinCooldown(state, key, 1, now) : false;
}

export function markProactiveSpoken(key: string | string[], now = Date.now()) {
  const state = readState(now) ?? emptyState(jakartaDay(now));
  state.count += 1; // satu pesan dihitung satu kali, walau menandai beberapa topik
  state.lastAt = now;
  for (const k of Array.isArray(key) ? key : [key]) state.spoken[k] = now;
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
