'use client';

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { rupiah, todayISO } from './accounting';
import { TRANSACTION_SAVED_EVENT } from './quickSession';

/**
 * Sistem pemicu interaksi proaktif Cashie.
 *
 * Prinsip:
 * - Semua pesan berbasis data transaksi akun yang sedang login (RLS Supabase), bukan asumsi AI.
 * - Cashie lebih sering diam daripada bicara: maksimal 3 pesan per hari, jeda minimal 90 menit,
 *   berhenti hari itu bila pengguna menutup 2 pesan, dan tidak pernah memotong aktivitas lain.
 * - Pesan yang sama tidak diulang selama masa jeda (cooldown) yang disimpan di penyimpanan lokal.
 *
 * Batasan saat ini: belum ada jam tutup di profil usaha, jadi "menjelang tutup" memakai jendela
 * waktu 18.00-20.00 WIB dan rekap harian 20.00-23.00 WIB.
 */

type RawTx = {
  id: string;
  jenis: string;
  keterangan: string | null;
  jumlah: number | string;
  qty: number | string | null;
  created_at: string;
};

type Tx = {
  jenis: 'penjualan' | 'biaya';
  name: string;
  label: string;
  jumlah: number;
  qty: number;
  date: string;
  age: number;
};

type Tally = Map<string, { label: string; qty: number }>;
type Named = { label: string; qty: number };

export type ProactiveSnapshot = {
  userId: string;
  today: string;
  activeDays14: number;
  todaySales: { count: number; total: number };
  todayCosts: { count: number; total: number };
  yesterdaySales: { count: number; total: number; topName: string | null };
  weekCosts: number;
  prevWeekCosts: number;
  topProduct: Named | null;
  risingProduct: Named | null;
  slowProduct: Named | null;
  salesDrop: { recentAvg: number; priorAvg: number } | null;
  unusualExpense: { label: string; amount: number } | null;
  missingRecurring: { key: string; label: string } | null;
};

type Memory = {
  day: string;
  count: number;
  lastAt: number;
  dismissed: number;
  seen: Record<string, string>;
};

type Candidate = { id: string; text: string; cooldownDays: number };

const DAY_MS = 86_400_000;
const MAX_PER_DAY = 3;
const MIN_GAP_MS = 90 * 60_000;
const MAX_DISMISSED_PER_DAY = 2;
const SNAPSHOT_TTL_MS = 5 * 60_000;
const RECURRING = /\b(listrik|pln|pdam|wifi|internet|sewa|kontrakan|gaji|pulsa|elpiji)\b/;

let activeMemoryKey: string | null = null;

const wibDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const dayDiff = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const sum = (list: Tx[]) => list.reduce((total, row) => total + row.jumlah, 0);
const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
const slug = (value: string) => value.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function jakartaHour(date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date)) % 24;
}

function tally(list: Tx[]): Tally {
  const map: Tally = new Map();
  for (const row of list) {
    const current = map.get(row.name);
    if (current) current.qty += row.qty;
    else map.set(row.name, { label: row.label, qty: row.qty });
  }
  return map;
}

function topOf(map: Tally): Named | null {
  let best: Named | null = null;
  map.forEach((value) => {
    if (!best || value.qty > best.qty) best = { label: value.label, qty: value.qty };
  });
  return best;
}

/** Mengubah baris transaksi mentah menjadi ringkasan kondisi usaha. Murni, mudah diuji. */
export function buildSnapshot(userId: string, raw: RawTx[], today: string): ProactiveSnapshot {
  const rows: Tx[] = [];
  for (const item of raw) {
    if (item.jenis !== 'penjualan' && item.jenis !== 'biaya') continue;
    const jumlah = Number(item.jumlah);
    const label = (item.keterangan ?? '').trim();
    if (!Number.isFinite(jumlah) || jumlah <= 0 || !label) continue;
    const date = wibDate(item.created_at);
    rows.push({
      jenis: item.jenis,
      name: normalize(label),
      label,
      jumlah,
      qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
      date,
      age: dayDiff(today, date),
    });
  }

  const between = (list: Tx[], from: number, to: number) => list.filter((row) => row.age >= from && row.age <= to);
  const sales = rows.filter((row) => row.jenis === 'penjualan');
  const costs = rows.filter((row) => row.jenis === 'biaya');

  const todaySalesRows = between(sales, 0, 0);
  const todayCostRows = between(costs, 0, 0);
  const yesterdaySalesRows = between(sales, 1, 1);
  const weekSales = between(sales, 0, 6);
  const prevWeekSales = between(sales, 7, 13);

  const weekTally = tally(weekSales);
  const prevTally = tally(prevWeekSales);

  // Produk terlaris minggu ini: hanya bila datanya cukup untuk bermakna.
  const top = topOf(weekTally);
  const topProduct = weekSales.length >= 5 && top && top.qty >= 3 ? top : null;

  // Produk meningkat: kenaikan jumlah terjual terbesar dibanding minggu lalu.
  let risingProduct: Named | null = null;
  let bestGain = 0;
  weekTally.forEach((value, name) => {
    const previous = prevTally.get(name)?.qty ?? 0;
    if (value.qty >= 5 && previous >= 2 && value.qty >= previous * 1.3 && value.qty - previous > bestGain) {
      bestGain = value.qty - previous;
      risingProduct = { label: value.label, qty: value.qty };
    }
  });

  // Produk kurang laku: terjual minggu lalu, tetapi belum sekali pun minggu ini.
  let slowProduct: Named | null = null;
  prevTally.forEach((value, name) => {
    if (value.qty >= 3 && !weekTally.has(name) && (!slowProduct || value.qty > slowProduct.qty)) {
      slowProduct = { label: value.label, qty: value.qty };
    }
  });

  // Penjualan menurun: 3 hari terakhir yang sudah selesai dibanding rata-rata 7 hari sebelumnya.
  const priorWindow = between(sales, 4, 10);
  const priorActiveDays = new Set(priorWindow.map((row) => row.date)).size;
  const recentAvg = sum(between(sales, 1, 3)) / 3;
  const priorAvg = sum(priorWindow) / 7;
  const salesDrop = priorActiveDays >= 4 && priorAvg >= 20_000 && recentAvg < priorAvg * 0.6
    ? { recentAvg, priorAvg }
    : null;

  // Pengeluaran tidak biasa: satu biaya hari ini jauh di atas nilai tengah biaya sebelumnya.
  const priorCosts = between(costs, 1, 60);
  let unusualExpense: ProactiveSnapshot['unusualExpense'] = null;
  if (priorCosts.length >= 5 && todayCostRows.length) {
    const typical = median(priorCosts.map((row) => row.jumlah));
    const biggest = todayCostRows.reduce((best, row) => (row.jumlah > best.jumlah ? row : best));
    if (biggest.jumlah >= 50_000 && biggest.jumlah >= typical * 2.5) {
      unusualExpense = { label: biggest.label, amount: biggest.jumlah };
    }
  }

  // Pengeluaran berulang: tercatat bulan lalu (listrik, sewa, dst.) tetapi belum bulan ini.
  const [year, month] = today.split('-').map(Number);
  const thisMonth = today.slice(0, 7);
  const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const todayDay = Number(today.slice(8, 10));
  const recurringLastMonth = new Map<string, { label: string; day: number }>();
  const recurringThisMonth = new Set<string>();
  for (const row of costs) {
    const key = row.name.match(RECURRING)?.[1];
    if (!key) continue;
    if (row.date.startsWith(thisMonth)) recurringThisMonth.add(key);
    else if (row.date.startsWith(prevMonth)) {
      const day = Number(row.date.slice(8, 10));
      const current = recurringLastMonth.get(key);
      if (!current || day > current.day) recurringLastMonth.set(key, { label: row.label, day });
    }
  }
  let missingRecurring: ProactiveSnapshot['missingRecurring'] = null;
  recurringLastMonth.forEach((value, key) => {
    if (!missingRecurring && !recurringThisMonth.has(key) && todayDay >= value.day) {
      missingRecurring = { key, label: value.label };
    }
  });

  return {
    userId,
    today,
    activeDays14: new Set(between(rows, 0, 13).map((row) => row.date)).size,
    todaySales: { count: todaySalesRows.length, total: sum(todaySalesRows) },
    todayCosts: { count: todayCostRows.length, total: sum(todayCostRows) },
    yesterdaySales: {
      count: yesterdaySalesRows.length,
      total: sum(yesterdaySalesRows),
      topName: topOf(tally(yesterdaySalesRows))?.label ?? null,
    },
    weekCosts: sum(between(costs, 0, 6)),
    prevWeekCosts: sum(between(costs, 7, 13)),
    topProduct,
    risingProduct,
    slowProduct,
    salesDrop,
    unusualExpense,
    missingRecurring,
  };
}

function timeGreeting(hour: number): string {
  return hour < 11 ? 'selamat pagi' : hour < 15 ? 'selamat siang' : hour < 18 ? 'selamat sore' : 'selamat malam';
}

/** Daftar pesan yang layak, berurutan menurut prioritas. Daftar kosong berarti Cashie diam. */
export function proactiveCandidates(s: ProactiveSnapshot, hour: number, memory: Pick<Memory, 'count'>): Candidate[] {
  const list: Candidate[] = [];
  const add = (id: string, text: string, cooldownDays: number) => list.push({ id, text, cooldownDays });

  if (hour >= 5 && hour < 11) {
    if (s.yesterdaySales.count > 0) {
      const top = s.yesterdaySales.topName ? ` ${capitalize(s.yesterdaySales.topName)} paling banyak terjual.` : '';
      add('morning-yesterday', `Selamat pagi! Kemarin penjualan tercatat ${rupiah(s.yesterdaySales.total)}.${top} Hari ini mau menyiapkan jumlah yang sama?`, 1);
    } else if (s.activeDays14 === 0) {
      add('morning-new', 'Selamat pagi! Bagaimana persiapan usaha hari ini? Ada yang perlu kita siapkan?', 1);
    } else {
      add('morning-default', 'Selamat pagi! Mau mulai dari mengecek persediaan atau menyiapkan produksi hari ini?', 1);
    }
  }

  if (hour >= 9 && hour < 18) {
    if (s.unusualExpense) {
      add('insight-unusual-expense', `Ada pengeluaran ${s.unusualExpense.label} ${rupiah(s.unusualExpense.amount)} yang lebih besar dari biasanya. Mau kita periksa?`, 2);
    }
    if (s.missingRecurring) {
      add(`insight-recurring-${slug(s.missingRecurring.key)}`, `Bulan lalu ada catatan pengeluaran ${s.missingRecurring.label}. Untuk bulan ini sudah tercatat belum?`, 7);
    }
    if (s.prevWeekCosts >= 100_000 && s.weekCosts >= s.prevWeekCosts * 1.25) {
      add('insight-cost-up', `Pengeluaran 7 hari terakhir ${rupiah(s.weekCosts)}, naik dari ${rupiah(s.prevWeekCosts)} di minggu sebelumnya. Mau kita lihat penyebabnya?`, 3);
    }
    if (s.salesDrop) {
      add('insight-sales-drop', 'Penjualan beberapa hari terakhir lebih rendah dari biasanya. Ada perubahan kondisi usaha?', 3);
    }
    if (s.risingProduct) {
      add('insight-rising-product', `Penjualan ${s.risingProduct.label} meningkat dibanding minggu lalu. Apakah kamu ingin menambah produksinya?`, 3);
    }
    if (s.topProduct) {
      add('insight-top-product', `Yang paling banyak terjual minggu ini adalah ${s.topProduct.label}.`, 7);
    }
    if (s.slowProduct) {
      add('insight-slow-product', `${capitalize(s.slowProduct.label)} belum terjual minggu ini, padahal minggu lalu ada. Mau kita evaluasi?`, 5);
    }
  }

  if (hour >= 18 && hour < 20) {
    if (s.todaySales.count === 0) {
      add('closing-soon', 'Sebentar lagi tutup usaha. Apakah semua penjualan hari ini sudah masuk? Belum ada penjualan tercatat hari ini.', 1);
    } else if (s.todayCosts.count === 0) {
      add('closing-soon', 'Sebentar lagi tutup usaha. Ada pembelian bahan atau pengeluaran hari ini yang belum dicatat?', 1);
    } else {
      add('closing-soon', 'Sebentar lagi tutup usaha. Ada transaksi yang belum dicatat?', 1);
    }
  }

  if (hour >= 20 && hour < 23) {
    if (s.todaySales.count + s.todayCosts.count === 0) {
      add('closing-empty', 'Hari ini belum ada transaksi tercatat. Apakah semua penjualan dan pembelian hari ini sudah masuk?', 1);
    } else {
      const { total: sales } = s.todaySales;
      const { total: costs } = s.todayCosts;
      const diff = sales >= costs ? `Selisihnya ${rupiah(sales - costs)}.` : `Pengeluaran lebih besar ${rupiah(costs - sales)} dari penjualan.`;
      add('daily-recap', `Sepertinya aktivitas hari ini sudah selesai. Penjualan tercatat ${rupiah(sales)}, pengeluaran tercatat ${rupiah(costs)}. ${diff}`, 1);
    }
  }

  // Sapaan waktu tetap muncul sebagai pesan pertama hari ini bila tidak ada hal yang lebih relevan.
  if (!list.length && memory.count === 0 && hour >= 5 && hour < 18) {
    add(`greeting-${timeGreeting(hour).replace(' ', '-')}`, `Halo, ${timeGreeting(hour)}! Ada yang ingin kamu siapkan untuk usaha hari ini?`, 1);
  }
  return list;
}

function pruneSeen(seen: Record<string, string>, day: string): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [id, date] of Object.entries(seen)) {
    const age = dayDiff(day, date);
    if (typeof date === 'string' && Number.isFinite(age) && age >= 0 && age <= 14) kept[id] = date;
  }
  return kept;
}

function readMemory(key: string, day: string): Memory {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Memory>;
      const sameDay = parsed.day === day;
      const seen = parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {};
      return {
        day,
        count: sameDay ? Number(parsed.count) || 0 : 0,
        lastAt: sameDay ? Number(parsed.lastAt) || 0 : 0,
        dismissed: sameDay ? Number(parsed.dismissed) || 0 : 0,
        seen: pruneSeen(seen, day),
      };
    }
  } catch {
    // Penyimpanan lokal yang diblokir atau rusak tidak boleh mengganggu asisten.
  }
  return { day, count: 0, lastAt: 0, dismissed: 0, seen: {} };
}

function writeMemory(key: string, memory: Memory) {
  try { window.localStorage.setItem(key, JSON.stringify(memory)); } catch { /* abaikan */ }
}

function gateAllows(memory: Memory, nowMs: number): boolean {
  return memory.count < MAX_PER_DAY
    && memory.dismissed < MAX_DISMISSED_PER_DAY
    && nowMs - memory.lastAt >= MIN_GAP_MS;
}

/** Memilih satu pesan yang belum dalam masa jeda, atau null bila Cashie sebaiknya diam. */
export function pickProactiveMessage(s: ProactiveSnapshot, hour: number, memory: Memory): Candidate | null {
  const candidates = proactiveCandidates(s, hour, memory);
  return candidates.find((candidate) => {
    const lastSeen = memory.seen[candidate.id];
    return !lastSeen || dayDiff(s.today, lastSeen) >= candidate.cooldownDays;
  }) ?? null;
}

/** Dipanggil saat pengguna menutup kartu proaktif; dua kali menutup menghentikan pesan proaktif hari itu. */
export function recordProactiveDismissed() {
  if (!activeMemoryKey || typeof window === 'undefined') return;
  const memory = readMemory(activeMemoryKey, todayISO());
  memory.dismissed += 1;
  writeMemory(activeMemoryKey, memory);
}

async function loadSnapshot(): Promise<ProactiveSnapshot | null> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;
  activeMemoryKey = `cava:cashie-proactive:v2:${user.id}`;
  const since = new Date(Date.now() - 70 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('id,jenis,keterangan,jumlah,qty,created_at')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error || !data) return null;
  return buildSnapshot(user.id, data as RawTx[], todayISO());
}

type Options = {
  enabled: boolean;
  /** True hanya bila Cashie sedang diam dan tidak ada aktivitas lain yang berjalan. */
  canInterrupt: () => boolean;
  /** Menampilkan pesan (dan membacakannya bila suara aktif). */
  deliver: (text: string) => void;
};

export function useCashieProactive({ enabled, canInterrupt, deliver }: Options) {
  const canInterruptRef = useRef(canInterrupt);
  const deliverRef = useRef(deliver);

  useEffect(() => {
    canInterruptRef.current = canInterrupt;
    deliverRef.current = deliver;
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;
    let running = false;
    let snapshot: ProactiveSnapshot | null = null;
    let snapshotAt = 0;

    const modalOpen = () => Boolean(document.querySelector('[aria-modal="true"]'));
    const ready = () => !cancelled && document.visibilityState === 'visible' && !modalOpen() && canInterruptRef.current();

    const tick = async () => {
      if (running || !ready()) return;
      running = true;
      try {
        const day = todayISO();
        if (activeMemoryKey && !gateAllows(readMemory(activeMemoryKey, day), Date.now())) return;

        if (!snapshot || Date.now() - snapshotAt > SNAPSHOT_TTL_MS || snapshot.today !== day) {
          snapshot = await loadSnapshot();
          snapshotAt = Date.now();
        }
        if (!snapshot || !activeMemoryKey) return;
        // Keadaan bisa berubah selama menunggu data; periksa ulang sebelum bicara.
        if (!ready()) return;

        const memory = readMemory(activeMemoryKey, day);
        if (!gateAllows(memory, Date.now())) return;
        const candidate = pickProactiveMessage(snapshot, jakartaHour(), memory);
        if (!candidate) return;

        memory.count += 1;
        memory.lastAt = Date.now();
        memory.seen[candidate.id] = day;
        writeMemory(activeMemoryKey, memory);
        deliverRef.current(candidate.text);
      } catch (error) {
        console.warn('Cashie proaktif tidak dapat dijalankan:', error);
      } finally {
        running = false;
      }
    };

    const first = window.setTimeout(() => void tick(), 2500);
    const interval = window.setInterval(() => void tick(), 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') window.setTimeout(() => void tick(), 1500); };
    const invalidate = () => { snapshotAt = 0; };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(TRANSACTION_SAVED_EVENT, invalidate);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(TRANSACTION_SAVED_EVENT, invalidate);
    };
  }, [enabled]);
}
