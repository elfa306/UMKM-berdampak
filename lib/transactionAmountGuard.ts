/**
 * Pengaman nominal transaksi Cashie.
 *
 * Action transaksi hanya sah jika nominal uang benar-benar disebutkan.
 * Harga katalog, rata-rata transaksi, dan tebakan model bukan bukti nominal.
 */
type MoneyHit = { amount: number; start: number; end: number; source: 'numeric' | 'words' };

const WORD_AMOUNT_PATTERN = /\b((?:nol|kosong|seperempat|setengah|seratus|seribu|sepuluh|sebelas|satu|se|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|puluh|ratus|belas)(?:[\s-]+(?:nol|kosong|seperempat|setengah|seratus|seribu|sepuluh|sebelas|satu|se|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|puluh|ratus|belas)){0,5})\s+(ribu|juta|jt|miliar|milyar|rupiah)\b/giu;

function parseIndonesianNumberPhrase(phrase: string): number | null {
  const tokens = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const digits: Record<string, number> = {
    nol: 0, kosong: 0, se: 1, satu: 1, dua: 2, tiga: 3, empat: 4,
    lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
  };
  let total = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === 'setengah') { total += 0.5; continue; }
    if (token === 'seperempat') { total += 0.25; continue; }
    if (token === 'seratus') { total += 100; continue; }
    if (token === 'seribu') { total += 1000; continue; }
    if (token === 'sepuluh') { total += 10; continue; }
    if (token === 'sebelas') { total += 11; continue; }
    const digit = digits[token];
    if (digit === undefined) return null;

    const next = tokens[index + 1];
    if (next === 'ratus') {
      total += digit * 100;
      index += 1;
    } else if (next === 'puluh') {
      total += digit * 10;
      index += 1;
    } else if (next === 'belas') {
      total += 10 + digit;
      index += 1;
    } else {
      total += digit;
    }
  }

  return Number.isFinite(total) ? total : null;
}

function parseNumericAmount(raw: string, suffix: string): number | null {
  const compact = raw.replace(/\s/g, '');
  const isGrouped = /^\d{1,3}(?:\.\d{3})+$/.test(compact)
    || /^\d{1,3}(?:,\d{3})+$/.test(compact);
  const base = Number(isGrouped ? compact.replace(/[.,]/g, '') : compact.replace(',', '.'));
  if (!Number.isFinite(base)) return null;

  const normalizedSuffix = suffix.toLowerCase();
  const multiplier = ['ribu', 'rb', 'k'].includes(normalizedSuffix) ? 1_000
    : ['juta', 'jt'].includes(normalizedSuffix) ? 1_000_000
      : ['miliar', 'milyar'].includes(normalizedSuffix) ? 1_000_000_000
        : 1;
  const amount = Math.round(base * multiplier);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** Mengambil nominal uang yang diucapkan, bukan jumlah/berat barang. */
export function extractExplicitMoneyAmounts(text: string): number[] {
  const safeText = String(text ?? '').toLowerCase()
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
  const hits: MoneyHit[] = [];
  const moneyCue = /\b(?:harga|seharga|sebesar|total|nominal|biaya|habis|bayar|dibayar|menghabiskan|keluar|uang|senilai)\b/i;
  const quantityUnit = /^\s*(?:kg|kilogram|gram|gr|liter|litre|ml|mili\w*|pcs|buah|ikat|pack|pak|dus|botol|bungkus|cup|gelas|ekor|karung|lembar|lusin)\b/i;

  const numericPattern = /\b(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(ribu|rb|k|juta|jt|miliar|milyar|rupiah))?\b/giu;
  let match: RegExpExecArray | null;
  while ((match = numericPattern.exec(safeText)) !== null) {
    const currencyPrefix = Boolean(match[1]);
    const numeric = match[2];
    const suffix = match[3] ?? '';
    const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(numeric);
    const digits = numeric.replace(/\D/g, '');
    const nearby = safeText.slice(Math.max(0, match.index - 32), Math.min(safeText.length, numericPattern.lastIndex + 18));
    const cuePresent = moneyCue.test(nearby);
    const after = safeText.slice(numericPattern.lastIndex);

    // "2 kg", "3 ikat", dan sejenisnya adalah kuantitas, bukan nominal uang.
    if (!currencyPrefix && !suffix && quantityUnit.test(after)) continue;
    // Angka polos hanya diakui bila besar (>= 1.000), dikelompokkan ribuan,
    // atau jelas mengikuti kata penanda harga/nominal.
    if (!currencyPrefix && !suffix && !grouped && digits.length < 4 && !cuePresent) continue;
    if (!currencyPrefix && !suffix && !grouped && digits.length === 4 && /^20\d{2}$/.test(digits) && !cuePresent) continue;

    const amount = parseNumericAmount(numeric, suffix);
    if (amount !== null) hits.push({ amount, start: match.index, end: numericPattern.lastIndex, source: 'numeric' });
  }

  const wordPattern = new RegExp(WORD_AMOUNT_PATTERN.source, WORD_AMOUNT_PATTERN.flags);
  while ((match = wordPattern.exec(safeText)) !== null) {
    const base = parseIndonesianNumberPhrase(match[1]);
    if (base === null) continue;
    const unit = match[2].toLowerCase();
    const multiplier = unit === 'ribu' ? 1_000
      : unit === 'juta' || unit === 'jt' ? 1_000_000
        : unit === 'miliar' || unit === 'milyar' ? 1_000_000_000
          : 1;
    const amount = Math.round(base * multiplier);
    if (Number.isSafeInteger(amount) && amount > 0) {
      hits.push({ amount, start: match.index, end: wordPattern.lastIndex, source: 'words' });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const merged: MoneyHit[] = [];
  for (const hit of hits) {
    const previous = merged[merged.length - 1];
    // Gabungkan komponen nominal seperti "satu juta dua ratus ribu",
    // tetapi jangan gabungkan item berbeda yang dipisahkan kata "dan".
    if (previous && previous.source === 'words' && hit.source === 'words'
      && safeText.slice(previous.end, hit.start).trim() === '') {
      previous.amount += hit.amount;
      previous.end = hit.end;
    } else if (!previous || hit.start >= previous.end) {
      merged.push({ ...hit });
    }
  }

  return merged.map((hit) => hit.amount);
}

/**
 * Memastikan setiap action transaksi memiliki satu nominal eksplisit yang
 * sama persis dari ucapan. Mencegah nominal default, angka karangan, dan
 * satu nominal dipakai berulang untuk beberapa item.
 */
export function transactionAmountsMatchUtterance(text: string, actionAmounts: readonly number[]): boolean {
  if (!actionAmounts.length) return true;
  const spokenAmounts = extractExplicitMoneyAmounts(text);
  if (spokenAmounts.length !== actionAmounts.length) return false;

  const unmatched = [...spokenAmounts];
  for (const rawAmount of actionAmounts) {
    if (!Number.isSafeInteger(rawAmount) || rawAmount <= 0) return false;
    const index = unmatched.findIndex((amount) => amount === rawAmount);
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}
