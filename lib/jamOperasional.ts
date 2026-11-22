import { supabase } from './supabase';

/** Jam buka dan tutup usaha dalam format HH:MM (WIB). Salah satunya boleh kosong saat percakapan belum selesai. */
export type JamOperasional = { buka: string | null; tutup: string | null };

export const PROFILE_HOURS_EVENT = 'cava:profile-hours-saved';

const JAM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isValidJam = (value: unknown): value is string => typeof value === 'string' && JAM_PATTERN.test(value);

/** "08:00" -> "08.00" supaya enak dibaca dan diucapkan. */
export const formatJam = (jam: string) => jam.replace(':', '.');

export function jamKeMenit(jam: string): number {
  const [hour, minute] = jam.split(':').map(Number);
  return hour * 60 + minute;
}

export function menitKeJam(totalMinutes: number): string {
  const safe = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

type Period = 'pagi' | 'siang' | 'sore' | 'malam';
type Token = { hour: number; minute: number; period?: Period; half: boolean };

const NUMBER_WORDS: Array<[string, number]> = [
  ['dua belas', 12], ['sebelas', 11], ['sepuluh', 10], ['sembilan', 9], ['delapan', 8], ['tujuh', 7],
  ['enam', 6], ['lima', 5], ['empat', 4], ['tiga', 3], ['dua', 2], ['satu', 1],
];

function toHour24(hour: number, period: Period | undefined, closing: boolean): number {
  const h = hour === 24 ? 0 : hour;
  if (period === 'pagi') return h === 12 ? 0 : h;
  if (period === 'siang') return h >= 1 && h <= 4 ? h + 12 : h;
  if (period === 'sore') return h < 12 ? h + 12 : h;
  if (period === 'malam') return h === 12 ? 0 : h < 12 ? h + 12 : h;
  // Tanpa keterangan waktu, jam tutup 1-11 hampir pasti sore atau malam ("tutup jam 5" = 17.00).
  if (closing && h >= 1 && h <= 11) return h + 12;
  return h;
}

function resolveToken(token: Token, closing: boolean): string {
  let hour = token.hour;
  let minute = token.minute;
  if (token.half) {
    hour = hour === 1 ? 12 : hour - 1; // "setengah 8" = 07.30
    minute = 30;
  }
  return menitKeJam(toHour24(hour, token.period, closing) * 60 + minute);
}

/**
 * Memahami jawaban lisan tentang jam usaha, mis. "buka jam 8 pagi tutup jam 5 sore",
 * "dari jam 07.30 sampai 21.00", atau hanya "tutupnya jam 9 malam".
 * Mengembalikan null bila tidak ada jam yang dapat dipahami dengan yakin.
 */
export function parseOperatingHours(raw: string): JamOperasional | null {
  let text = raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  for (const [word, value] of NUMBER_WORDS) text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(value));
  text = text.replace(/(\d{1,2})[.:](\d{2})/g, '$1:$2');

  const tokenPattern = /(setengah\s+)?\b(\d{1,2})(?::(\d{2}))?(?!\d)\s*(pagi|subuh|siang|sore|malam)?/g;
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text)) !== null) {
    const hour = Number(match[2]);
    const minute = match[3] ? Number(match[3]) : 0;
    if (hour > 24 || minute > 59) continue;
    const periodText = match[4];
    const period: Period | undefined = periodText === 'subuh' ? 'pagi' : (periodText as Period | undefined);
    tokens.push({ hour, minute, period, half: Boolean(match[1]) });
  }
  if (!tokens.length) return null;

  const closeIndex = text.search(/\b(tutup|closing|selesai)(nya)?\b/);
  const openIndex = text.search(/\b(buka|mulai|open)(nya)?\b/);

  let buka: string | null = null;
  let tutup: string | null = null;
  if (tokens.length === 1) {
    if (closeIndex >= 0 && openIndex < 0) tutup = resolveToken(tokens[0], true);
    else if (openIndex >= 0 && closeIndex < 0) buka = resolveToken(tokens[0], false);
    else return null;
  } else {
    // Biasanya "buka ... tutup ..."; bila kata tutup disebut lebih dulu, urutannya dibalik.
    const swapped = closeIndex >= 0 && openIndex >= 0 && closeIndex < openIndex;
    buka = resolveToken(swapped ? tokens[1] : tokens[0], false);
    tutup = resolveToken(swapped ? tokens[0] : tokens[1], true);
  }

  if (buka && tutup) {
    const bukaMenit = jamKeMenit(buka);
    const tutupMenit = jamKeMenit(tutup);
    // Tutup lewat tengah malam hanya wajar sampai dini hari (mis. 22.00 - 02.00).
    if (tutupMenit <= bukaMenit && tutupMenit > 5 * 60) return null;
    if (tutupMenit === bukaMenit) return null;
  }
  if ((buka && !isValidJam(buka)) || (tutup && !isValidJam(tutup))) return null;
  return { buka, tutup };
}

export type SaveHoursResult = { ok: true } | { ok: false; message: string };

/** Menyimpan jam usaha ke profil akun yang sedang login (dilindungi RLS). Dipanggil setelah pemilik mengonfirmasi. */
export async function saveOperatingHours(buka: string, tutup: string): Promise<SaveHoursResult> {
  if (!isValidJam(buka) || !isValidJam(tutup)) return { ok: false, message: 'Format jam belum valid. Coba sebutkan lagi.' };
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return { ok: false, message: 'Masuk ke akun CAVA terlebih dahulu untuk menyimpan jam usaha.' };

  const { data, error } = await supabase
    .from('business_profiles')
    .update({ jam_buka: buka, jam_tutup: tutup, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .select('user_id');

  if (error) {
    if (/jam_buka|jam_tutup/i.test(error.message)) {
      return { ok: false, message: 'Pengaturan jam usaha belum aktif di database. Jalankan supabase/migration_v20_jam_operasional.sql terlebih dahulu.' };
    }
    return { ok: false, message: error.message || 'Jam usaha belum berhasil disimpan.' };
  }
  if (!data || data.length === 0) return { ok: false, message: 'Profil usaha belum dibuat. Lengkapi dulu di Pengaturan Usaha.' };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROFILE_HOURS_EVENT));
  return { ok: true };
}
