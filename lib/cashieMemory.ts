import { supabase } from './supabase';

/**
 * Memori aktivitas usaha Cashie: bukan menyimpan percakapan mentah, tetapi rencana pendek yang
 * disebut pemilik ("besok mau beli bahan") supaya Cashie bisa menindaklanjutinya seperti teman.
 *
 * Disimpan per akun di perangkat (localStorage), maksimal 20 rencana, dibuang otomatis setelah 14 hari.
 * Tidak ada data yang dikirim ke server; kegagalan penyimpanan tidak boleh mengganggu asisten.
 */

export type PlanKind = 'beli_bahan' | 'produksi' | 'harga' | 'varian';
export type PlanStatus = 'open' | 'done' | 'dropped';

export type Plan = {
  id: string;
  kind: PlanKind;
  createdDay: string;
  dueDay: string;
  status: PlanStatus;
  asked: number;
  lastAskedDay: string | null;
};

export type DuePlan = { id: string; kind: PlanKind; daysAgo: number };

const STORAGE_PREFIX = 'cava:cashie-memory:v1:';
const MAX_PLANS = 20;
const MAX_AGE_DAYS = 14;
const MAX_ASKED = 2;
const DAY_MS = 86_400_000;

const FUTURE = /\b(besok|lusa|nanti|minggu depan|rencananya|berencana|mau|ingin|pengen|akan|harus)\b/;
const PAST = /\b(tadi|kemarin|barusan|baru saja|sudah|telah)\b/;
const COMMAND = /\b(catat|catatkan|tolong|bantu|buka|bukakan|lihat|tampilkan|hapus|ubah|simpan|tambahkan|unduh|ekspor)\b/;
const STRONG_FUTURE = /\b(besok|lusa|nanti|minggu depan|rencananya|berencana)\b/;
const AMOUNT = /\b(ribu|rb|juta|jt|rp|rupiah)\b|\d{4,}/;

const dayDiff = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);

function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

function normalize(raw: string): string {
  return raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectKind(text: string): PlanKind | null {
  if (/\b(beli|belanja|kulakan|restock|stok)\b/.test(text)) return 'beli_bahan';
  if (/\b(varian|menu baru|produk baru|resep baru)\b/.test(text)) return 'varian';
  if (/\bharga\b/.test(text)) return 'harga';
  if (/\b(produksi|bikin|membuat|buat|masak|memasak)\b/.test(text)) return 'produksi';
  return null;
}

/**
 * Mengenali rencana ke depan dari ucapan pemilik. Sengaja konservatif: kalimat transaksi
 * (ada nominal) atau yang sudah lewat ("tadi beli bahan") tidak dianggap rencana.
 */
export function extractPlan(raw: string, today: string): (Pick<Plan, 'kind' | 'dueDay'> & { strong: boolean }) | null {
  const text = normalize(raw);
  const words = text.split(' ').filter(Boolean);
  if (words.length < 3 || words.length > 25) return null;
  if (!FUTURE.test(text) || PAST.test(text) || AMOUNT.test(text) || COMMAND.test(text)) return null;
  const kind = detectKind(text);
  if (!kind) return null;
  const offset = /\blusa\b/.test(text) ? 2 : /\bminggu depan\b/.test(text) ? 7 : 1;
  return { kind, dueDay: addDays(today, offset), strong: STRONG_FUTURE.test(text) };
}

function read(userId: string): Plan[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + userId) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as Plan[]).filter((plan) => plan && typeof plan.id === 'string' && typeof plan.dueDay === 'string') : [];
  } catch {
    return [];
  }
}

function write(userId: string, plans: Plan[]) {
  try { window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(plans.slice(-MAX_PLANS))); } catch { /* abaikan */ }
}

function prune(plans: Plan[], today: string): Plan[] {
  return plans.filter((plan) => dayDiff(today, plan.createdDay) <= MAX_AGE_DAYS && !(plan.status === 'open' && plan.asked >= MAX_ASKED && plan.lastAskedDay !== null && dayDiff(today, plan.lastAskedDay) >= 1));
}

export async function currentMemoryUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Dipanggil untuk setiap ucapan pemilik; menyimpan rencana bila ada, tidak pernah mengganggu alur utama. */
export async function captureUserPlan(raw: string, today: string): Promise<PlanKind | null> {
  if (typeof window === 'undefined') return null;
  try {
    const found = extractPlan(raw, today);
    if (!found) return null;
    const userId = await currentMemoryUserId();
    if (!userId) return null;
    const plans = prune(read(userId), today);
    const existing = plans.find((plan) => plan.kind === found.kind && plan.status === 'open');
    if (existing) {
      existing.dueDay = found.dueDay;
      existing.asked = 0;
      existing.lastAskedDay = null;
    } else {
      plans.push({ id: `${found.kind}-${Date.now().toString(36)}`, kind: found.kind, createdDay: today, dueDay: found.dueDay, status: 'open', asked: 0, lastAskedDay: null });
    }
    write(userId, plans);
    // Hanya rencana dengan penanda waktu jelas yang menggantikan AI; yang samar tetap diingat tetapi diteruskan ke AI.
    return found.strong ? found.kind : null;
  } catch {
    return null;
  }
}

/** Balasan hangat saat Cashie mencatat rencana pemilik; tidak membuka form apa pun. */
export function planAcknowledgement(kind: PlanKind): string {
  switch (kind) {
    case 'beli_bahan': return 'Siap, saya ingat rencanamu beli bahan. Nanti saya tanyakan lagi, dan setelah belanja ceritakan saja ya, saya bantu catat.';
    case 'produksi': return 'Oke, saya ingat rencana produksimu. Nanti saya tanyakan hasilnya ya.';
    case 'harga': return 'Baik, saya ingat rencana mengevaluasi harga jual. Nanti kita bahas bareng ya.';
    case 'varian': return 'Seru! Saya ingat rencana varian barumu. Nanti saya tanya perkembangannya ya.';
  }
}

/** Rencana terbuka yang sudah waktunya ditanyakan, paling lama lebih dulu. */
export function duePlansFor(userId: string, today: string): DuePlan[] {
  if (typeof window === 'undefined') return [];
  return prune(read(userId), today)
    .filter((plan) => plan.status === 'open' && plan.dueDay <= today && plan.asked < MAX_ASKED && plan.lastAskedDay !== today)
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay))
    .map((plan) => ({ id: plan.id, kind: plan.kind, daysAgo: Math.max(1, dayDiff(today, plan.createdDay)) }));
}

export function markPlanAsked(userId: string, planId: string, today: string) {
  if (typeof window === 'undefined') return;
  const plans = read(userId);
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return;
  plan.asked += 1;
  plan.lastAskedDay = today;
  write(userId, plans);
}

export function setPlanStatus(userId: string, planId: string, status: PlanStatus) {
  if (typeof window === 'undefined') return;
  const plans = read(userId);
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return;
  plan.status = status;
  write(userId, plans);
}

/** Pembelian bahan yang baru dicatat menandai rencana "beli bahan" sebagai selesai, tanpa perlu ditanya lagi. */
export function completeBuyPlans(userId: string): number {
  if (typeof window === 'undefined') return 0;
  const plans = read(userId);
  let changed = 0;
  for (const plan of plans) {
    if (plan.kind === 'beli_bahan' && plan.status === 'open') {
      plan.status = 'done';
      changed += 1;
    }
  }
  if (changed) write(userId, plans);
  return changed;
}

/** Jawaban singkat atas pertanyaan tindak lanjut: sudah, batal, atau masih berlaku. */
export function planReply(raw: string): 'done' | 'drop' | 'keep' | null {
  const text = normalize(raw);
  const count = text.split(' ').filter(Boolean).length;
  if (!text || count > 7) return null;
  if (/\b(batal|batalkan|tidak jadi|gak jadi|nggak jadi|enggak jadi|ga jadi|engga jadi|dibatalkan)\b/.test(text)) return 'drop';
  if (/\b(sudah|udah|beres|selesai)\b/.test(text) && !/\b(belum|tidak|nggak|gak)\b/.test(text)) return 'done';
  if (/\b(masih|ya|iya|iyaa|yoi|lanjut|tetap|jadi)\b/.test(text) && !/\b(tidak|nggak|gak)\b/.test(text)) return 'keep';
  return null;
}
