/**
 * Autocorrect hasil transkripsi suara (Whisper/Gemini) untuk Cashie.
 *
 * Dua lapis koreksi, keduanya deterministik dan tidak memakai AI:
 * 1. Alias: salah dengar yang sudah diketahui, mis. "ST" -> "es teh".
 * 2. Katalog: kata/frasa yang mirip dengan nama produk aktif milik pengguna
 *    (fuzzy match berbasis Levenshtein) dikoreksi ke nama produk yang benar.
 *
 * Prinsip: bila ragu, jangan diubah. Angka, nominal, dan kata lain dibiarkan apa adanya.
 */

export type TranscriptCorrection = { from: string; to: string; reason: 'alias' | 'katalog' };
export type CorrectionResult = { text: string; changes: TranscriptCorrection[] };

/** Salah dengar yang sering terjadi. Kunci ditulis huruf kecil; tambahkan sesuai temuan di lapangan. */
export const BUILTIN_ALIASES: Record<string, string> = {
  st: 'es teh',
  's t': 'es teh',
  'es tea': 'es teh',
  'es the': 'es teh',
};

// Kemiripan minimal (0-1) agar sebuah frasa dianggap salah dengar dari nama produk.
const MIN_SIMILARITY = 0.8;
// Nama produk yang terlalu pendek tidak dikoreksi secara fuzzy karena terlalu rawan salah ganti.
const MIN_FUZZY_LENGTH = 5;
// Jika dua produk sama-sama mirip (selisih skor kecil), jangan menebak.
const AMBIGUITY_MARGIN = 0.05;
const MAX_WINDOW_WORDS = 5;

type Token = { norm: string; start: number; end: number };
type Edit = { start: number; end: number; to: string; reason: TranscriptCorrection['reason'] };

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[A-Za-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ norm: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

// Token bersebelahan dianggap satu frasa hanya bila dipisah spasi/titik/strip (bukan koma dsb.).
function contiguous(text: string, tokens: Token[], from: number, count: number): boolean {
  for (let i = from; i < from + count - 1; i++) {
    if (!/^[\s.\-]*$/.test(text.slice(tokens[i].end, tokens[i + 1].start))) return false;
  }
  return true;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function applyEdits(text: string, edits: Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.to + result.slice(edit.end);
  }
  return result;
}

function aliasPass(text: string, aliases: Record<string, string>, catalog: Map<string, string>): { text: string; changes: TranscriptCorrection[] } {
  const entries = Object.entries(aliases)
    .map(([key, value]) => ({ words: normalizeText(key).split(' ').filter(Boolean), value: value.trim() }))
    .filter((entry) => entry.words.length > 0 && entry.value)
    .sort((a, b) => b.words.length - a.words.length);
  if (!entries.length) return { text, changes: [] };

  const tokens = tokenize(text);
  const edits: Edit[] = [];
  for (let i = 0; i < tokens.length;) {
    let matched = false;
    for (const entry of entries) {
      const count = entry.words.length;
      if (i + count > tokens.length || !contiguous(text, tokens, i, count)) continue;
      if (!entry.words.every((word, offset) => tokens[i + offset].norm === word)) continue;
      const target = catalog.get(normalizeText(entry.value)) ?? entry.value;
      edits.push({ start: tokens[i].start, end: tokens[i + count - 1].end, to: target, reason: 'alias' });
      i += count;
      matched = true;
      break;
    }
    if (!matched) i++;
  }

  const changes = edits.map((edit) => ({ from: text.slice(edit.start, edit.end), to: edit.to, reason: edit.reason }));
  return { text: applyEdits(text, edits), changes };
}

function catalogPass(text: string, names: string[]): { text: string; changes: TranscriptCorrection[] } {
  const products = names
    .map((name) => ({ name, norm: normalizeText(name) }))
    .map((item) => ({ ...item, key: item.norm.replace(/ /g, ''), words: item.norm.split(' ').filter(Boolean).length }))
    .filter((item) => item.key.length >= MIN_FUZZY_LENGTH);
  if (!products.length) return { text, changes: [] };

  const tokens = tokenize(text);
  type Candidate = { start: number; end: number; length: number; score: number; name: string; noop: boolean };
  const candidates: Candidate[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let count = 1; count <= MAX_WINDOW_WORDS && i + count <= tokens.length; count++) {
      if (!contiguous(text, tokens, i, count)) break;
      const window = tokens.slice(i, i + count);
      // Angka/nominal tidak pernah menjadi bagian dari nama produk yang dikoreksi.
      if (window.some((token) => /^\d+$/.test(token.norm))) continue;
      const joined = window.map((token) => token.norm).join('');
      const spaced = window.map((token) => token.norm).join(' ');

      const scored = products
        .filter((item) => count >= Math.max(1, item.words - 1) && count <= item.words + 1 && Math.abs(joined.length - item.key.length) <= 2)
        .map((item) => {
          const distance = levenshtein(joined, item.key);
          return { item, distance, score: 1 - distance / Math.max(joined.length, item.key.length) };
        })
        .filter((entry) => entry.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score);
      if (!scored.length) continue;

      const best = scored[0];
      const runnerUp = scored.find((entry) => entry.item.key !== best.item.key);
      if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) continue;

      candidates.push({
        start: window[0].start,
        end: window[count - 1].end,
        length: count,
        score: best.score,
        name: best.item.name,
        noop: spaced === best.item.norm,
      });
    }
  }

  // Pilih kandidat terbaik yang tidak saling tumpang tindih (skor tertinggi, lalu frasa terpanjang).
  candidates.sort((a, b) => b.score - a.score || b.length - a.length);
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    if (accepted.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
    accepted.push(candidate);
  }

  const edits = accepted.filter((candidate) => !candidate.noop);
  const changes = edits.map((edit) => ({ from: text.slice(edit.start, edit.end), to: edit.name, reason: 'katalog' as const }));
  return { text: applyEdits(text, edits.map((edit) => ({ start: edit.start, end: edit.end, to: edit.name, reason: 'katalog' as const }))), changes };
}

/**
 * Koreksi transkrip. Tidak pernah melempar error: bila terjadi masalah, transkrip asli dikembalikan.
 * @param productNames nama produk aktif pengguna (untuk fuzzy match dan penulisan nama yang benar)
 * @param extraAliases alias tambahan per usaha, mis. { 'tt': 'teh tarik' }
 */
export function correctTranscript(transcript: string, productNames: string[] = [], extraAliases: Record<string, string> = {}): CorrectionResult {
  try {
    const names = Array.from(new Set(productNames.map((name) => String(name ?? '').trim()).filter(Boolean)));
    const catalog = new Map(names.map((name) => [normalizeText(name), name] as [string, string]));

    const aliased = aliasPass(transcript, { ...BUILTIN_ALIASES, ...extraAliases }, catalog);
    const fuzzy = catalogPass(aliased.text, names);
    return { text: fuzzy.text, changes: [...aliased.changes, ...fuzzy.changes] };
  } catch (error) {
    console.warn('[CAVA AI] koreksi transkrip dilewati:', error instanceof Error ? error.message : error);
    return { text: transcript, changes: [] };
  }
}
