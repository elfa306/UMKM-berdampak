'use client';

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { rupiah, todayISO } from './accounting';
import { TRANSACTION_SAVED_EVENT, type QuickSavedDetail } from './quickSession';
import { completeBuyPlans, duePlansFor, markPlanAsked, type DuePlan } from './cashieMemory';
import { PROFILE_HOURS_EVENT, formatJam, isValidJam, jamKeMenit, menitKeJam } from './jamOperasional';

/**
 * Cashie sebagai teman usaha: memilih kapan perlu bicara, apa yang ditanyakan, dan kapan diam.
 *
 * Prinsip:
 * - Semua pesan berbasis data transaksi akun yang sedang login (RLS Supabase), bukan asumsi AI.
 * - Waktu tidak kaku: jam buka/tutup dari profil usaha dipakai bila ada; bila belum ada, Cashie
 *   menyimpulkan kebiasaan dari jam transaksi; bila data juga belum cukup, memakai jendela umum.
 * - Cashie bisa bertanya jam usaha lewat percakapan dan menyimpannya setelah dikonfirmasi.
 * - Selain pesan terjadwal, Cashie bereaksi singkat pada peristiwa (penjualan pertama hari ini,
 *   penjualan melewati kemarin, pengeluaran besar yang belum jelas kategorinya).
 * - Lebih sering diam: batas harian, jeda antarpesan, berhenti bila pengguna menutup 2 pesan,
 *   dan tidak pernah menyela aktivitas lain.
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
  minute: number;
};

type Tally = Map<string, { label: string; qty: number }>;
type Named = { label: string; qty: number };

export type ProfileInfo = {
  exists: boolean;
  name: string | null;
  jamBuka: string | null;
  jamTutup: string | null;
  /** False bila kolom jam_buka/jam_tutup belum ada di database (migration v20 belum dijalankan). */
  hoursSupported: boolean;
};

export type ProactiveSnapshot = {
  userId: string;
  today: string;
  profile: ProfileInfo;
  inferredHours: { buka: string; tutup: string } | null;
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
  weekSalesTotal: number;
  prevWeekSalesTotal: number;
  /** Rencana yang pernah disebut pemilik dan sudah waktunya ditindaklanjuti (memori aktivitas usaha). */
  duePlans: DuePlan[];
};

export type ProactiveAction = 'record_sale' | 'record_expense' | 'open_report' | 'open_settings';
export type ProactiveIntent =
  | { type: 'ask_hours'; suggestion: { buka: string; tutup: string } | null }
  | { type: 'plan_followup'; planId: string };
export type ProactiveMessage = { id: string; text: string; actions: ProactiveAction[]; intent?: ProactiveIntent };
type Candidate = ProactiveMessage & { cooldownDays: number };

type Memory = {
  day: string;
  count: number;
  lastAt: number;
  dismissed: number;
  reactiveCount: number;
  reactiveLastAt: number;
  seen: Record<string, string>;
};

type Win = [number, number];
type Windows = { morning: Win; insight: Win; closing: Win; recap: Win; overnight: boolean; open: number };

const DAY_MS = 86_400_000;
const MAX_PER_DAY = 3;
const MAX_REACTIVE_PER_DAY = 3;
const MIN_GAP_MS = 90 * 60_000;
const MIN_REACTIVE_GAP_MS = 10 * 60_000;
const MIN_AFTER_PROACTIVE_MS = 3 * 60_000;
const MAX_DISMISSED_PER_DAY = 2;
const SNAPSHOT_TTL_MS = 5 * 60_000;
const RECURRING = /\b(listrik|pln|pdam|wifi|internet|sewa|kontrakan|gaji|pulsa|elpiji)\b/;
const DEFAULT_PROFILE: ProfileInfo = { exists: false, name: null, jamBuka: null, jamTutup: null, hoursSupported: false };
const DEFAULT_WINDOWS: Windows = {
  morning: [5 * 60, 11 * 60],
  insight: [9 * 60, 18 * 60],
  closing: [18 * 60, 20 * 60],
  recap: [20 * 60, 23 * 60],
  overnight: false,
  open: 7 * 60,
};

let activeMemoryKey: string | null = null;
let activeUserId: string | null = null;

const wibDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const wibMinute = (iso: string) => {
  const date = new Date(iso);
  return (date.getUTCHours() * 60 + date.getUTCMinutes() + 7 * 60) % 1440; // WIB = UTC+7, tanpa DST
};
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

function jakartaMinute(date = new Date()): number {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
    .format(date).split(':').map(Number);
  return (hour % 24) * 60 + minute;
}

/** Variasi kalimat yang stabil sepanjang hari tetapi berganti dari hari ke hari. */
function pick(seed: string, options: string[]): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return options[hash % options.length];
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

/** Menyimpulkan jam buka/tutup dari kebiasaan transaksi 30 hari terakhir (minimal 5 hari aktif). */
function inferHours(rows: Tx[]): { buka: string; tutup: string } | null {
  const perDay = new Map<string, { first: number; last: number }>();
  for (const row of rows) {
    if (row.age > 30) continue;
    const current = perDay.get(row.date);
    if (!current) perDay.set(row.date, { first: row.minute, last: row.minute });
    else {
      current.first = Math.min(current.first, row.minute);
      current.last = Math.max(current.last, row.minute);
    }
  }
  if (perDay.size < 5) return null;
  const firsts: number[] = [];
  const lasts: number[] = [];
  perDay.forEach((value) => { firsts.push(value.first); lasts.push(value.last); });
  const open = Math.floor(median(firsts) / 30) * 30;
  const close = Math.ceil(median(lasts) / 30) * 30;
  if (close - open < 180 || close > 1439) return null;
  return { buka: menitKeJam(open), tutup: menitKeJam(close) };
}

/** Mengubah baris transaksi mentah menjadi ringkasan kondisi usaha. Murni, mudah diuji. */
export function buildSnapshot(userId: string, raw: RawTx[], today: string, profile: ProfileInfo = DEFAULT_PROFILE, duePlans: DuePlan[] = []): ProactiveSnapshot {
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
      minute: wibMinute(item.created_at),
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
    profile,
    inferredHours: inferHours(rows),
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
    weekSalesTotal: sum(weekSales),
    prevWeekSalesTotal: sum(prevWeekSales),
    duePlans,
  };
}

/** Jendela waktu mengikuti jam usaha: dari profil, lalu dari kebiasaan transaksi, lalu jendela umum. */
function resolveWindows(s: ProactiveSnapshot): Windows {
  const hours = s.profile.jamBuka && s.profile.jamTutup
    ? { buka: s.profile.jamBuka, tutup: s.profile.jamTutup }
    : s.inferredHours;
  if (!hours) return DEFAULT_WINDOWS;
  const open = jamKeMenit(hours.buka);
  let close = jamKeMenit(hours.tutup);
  if (close <= open) close += 1440;
  let insight: Win = [open + 60, close - 60];
  if (insight[1] - insight[0] < 60) insight = [open, close - 30];
  return {
    morning: [open - 60, open + 180],
    insight,
    closing: [close - 60, close],
    recap: [close, close + 180],
    overnight: close > 1440,
    open,
  };
}

const inWin = (now: number, [from, to]: Win) => now >= from && now < to;

function timeGreeting(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return hour < 11 ? 'selamat pagi' : hour < 15 ? 'selamat siang' : hour < 18 ? 'selamat sore' : 'selamat malam';
}

/** Daftar pesan yang layak, berurutan menurut prioritas. Daftar kosong berarti Cashie diam. */
export function proactiveCandidates(s: ProactiveSnapshot, date: Date, memory: Pick<Memory, 'count'>): Candidate[] {
  const windows = resolveWindows(s);
  let now = jakartaMinute(date);
  if (windows.overnight && now < windows.open - 60) now += 1440;

  const awake = now >= Math.min(windows.morning[0], windows.insight[0]) && now < windows.recap[1];
  if (!awake) return [];

  const list: Candidate[] = [];
  const day = s.today;
  const shop = s.profile.name?.trim() || null;
  const add = (id: string, text: string, cooldownDays: number, actions: ProactiveAction[] = [], intent?: ProactiveIntent) =>
    list.push({ id, text, cooldownDays, actions, intent });
  const variant = (id: string, options: string[]) => pick(`${day}:${id}`, options);

  // Teman yang baik tahu kapan usahamu buka dan tutup; bila belum tahu, ia bertanya.
  const declared = Boolean(s.profile.jamBuka && s.profile.jamTutup);
  if (s.profile.exists && s.profile.hoursSupported && !declared && memory.count >= 1) {
    if (s.inferredHours) {
      add('ask-hours', `Biar saya bisa menemani di waktu yang pas: dari catatanmu, usahamu biasanya buka sekitar jam ${formatJam(s.inferredHours.buka)} dan tutup sekitar jam ${formatJam(s.inferredHours.tutup)}. Benar begitu?`, 7, [], { type: 'ask_hours', suggestion: s.inferredHours });
    } else {
      add('ask-hours', 'Biar saya bisa menemani di waktu yang pas, usahamu biasanya buka jam berapa dan tutup jam berapa? Tahan tombol V lalu ceritakan saja, nanti saya catat di profil usaha.', 7, ['open_settings'], { type: 'ask_hours', suggestion: null });
    }
  }

  // Teman yang baik ingat apa yang kamu rencanakan dan menanyakannya, tanpa memaksa.
  const plan = s.duePlans[0];
  if (plan && (inWin(now, windows.morning) || inWin(now, windows.insight))) {
    const when = plan.daysAgo <= 1 ? 'Kemarin' : `${plan.daysAgo} hari lalu`;
    const text = {
      beli_bahan: `${when} kamu bilang mau beli bahan. Rencana itu masih berlaku?`,
      produksi: `${when} kamu berencana menyiapkan produksi. Bagaimana, sudah jalan?`,
      harga: `${when} kita berencana mengevaluasi harga jual. Mau kita lanjutkan sekarang?`,
      varian: `${when} kamu ingin mencoba varian baru. Jadi bagaimana?`,
    }[plan.kind];
    const actions: ProactiveAction[] = plan.kind === 'beli_bahan' ? ['record_expense'] : plan.kind === 'harga' ? ['open_report'] : [];
    add(`plan-${plan.id}`, text, 1, actions, { type: 'plan_followup', planId: plan.id });
  }

  if (inWin(now, windows.morning)) {
    if (s.yesterdaySales.count > 0) {
      const topName = s.yesterdaySales.topName ? ` ${capitalize(s.yesterdaySales.topName)} paling banyak terjual.` : '';
      const total = rupiah(s.yesterdaySales.total);
      add('morning-yesterday', variant('morning-yesterday', [
        `Selamat pagi! Kemarin penjualan tercatat ${total}.${topName} Hari ini mau menyiapkan jumlah yang sama?`,
        `Pagi! Kemarin penjualan tercatat ${total}.${topName} Hari ini kita siapkan seperti kemarin, atau ada rencana lain?`,
      ]), 1);
    } else if (s.activeDays14 === 0) {
      add('morning-new', 'Selamat pagi! Bagaimana persiapan usaha hari ini? Ada yang perlu kita siapkan bareng?', 1);
    } else {
      add('morning-default', variant('morning-default', [
        'Selamat pagi! Mau mulai dari mengecek persediaan atau menyiapkan produksi hari ini?',
        shop ? `Pagi! Siap buka ${shop} hari ini? Ada yang mau disiapkan dulu?` : 'Pagi! Ada rencana apa untuk usaha hari ini? Saya siap bantu.',
      ]), 1);
    }
  }

  if (inWin(now, windows.insight)) {
    if (s.unusualExpense) {
      add('insight-unusual-expense', `Ada pengeluaran ${s.unusualExpense.label} ${rupiah(s.unusualExpense.amount)} yang lebih besar dari biasanya. Mau kita periksa?`, 2, ['open_report']);
    }
    if (s.missingRecurring) {
      add(`insight-recurring-${slug(s.missingRecurring.key)}`, `Bulan lalu ada catatan pengeluaran ${s.missingRecurring.label}. Untuk bulan ini sudah tercatat belum?`, 7, ['record_expense']);
    }
    if (s.prevWeekCosts >= 100_000 && s.weekCosts >= s.prevWeekCosts * 1.25) {
      add('insight-cost-up', `Pengeluaran 7 hari terakhir ${rupiah(s.weekCosts)}, naik dari ${rupiah(s.prevWeekCosts)} di minggu sebelumnya. Mau kita lihat penyebabnya?`, 3, ['open_report']);
    }
    if (s.salesDrop) {
      add('insight-sales-drop', 'Penjualan beberapa hari terakhir lebih rendah dari biasanya. Ada perubahan kondisi usaha?', 3, ['open_report']);
    }
    if (s.risingProduct) {
      add('insight-rising-product', `Penjualan ${s.risingProduct.label} meningkat dibanding minggu lalu. Apakah kamu ingin menambah produksinya?`, 3);
    }
    if (s.prevWeekSalesTotal >= 50_000 && s.weekSalesTotal >= s.prevWeekSalesTotal * 1.15) {
      add('insight-sales-up', `Penjualan 7 hari terakhir ${rupiah(s.weekSalesTotal)}, naik dari ${rupiah(s.prevWeekSalesTotal)} di minggu sebelumnya. Mantap, pencatatannya juga rapi!`, 7);
    }
    if (s.topProduct) {
      add('insight-top-product', `Yang paling banyak terjual minggu ini adalah ${s.topProduct.label}.`, 7);
    }
    if (s.slowProduct) {
      add('insight-slow-product', `${capitalize(s.slowProduct.label)} belum terjual minggu ini, padahal minggu lalu ada. Mau kita evaluasi?`, 5);
    }
  }

  if (inWin(now, windows.closing)) {
    if (s.todaySales.count === 0) {
      add('closing-soon', 'Sebentar lagi tutup usaha. Apakah semua penjualan hari ini sudah masuk? Belum ada penjualan tercatat hari ini.', 1, ['record_sale', 'record_expense']);
    } else if (s.todayCosts.count === 0) {
      add('closing-soon', variant('closing-soon', [
        'Sebentar lagi tutup usaha. Ada pembelian bahan atau pengeluaran hari ini yang belum dicatat?',
        'Hampir waktunya tutup. Tadi ada belanja bahan atau pengeluaran lain yang belum masuk catatan?',
      ]), 1, ['record_expense', 'record_sale']);
    } else {
      add('closing-soon', variant('closing-soon', [
        'Sebentar lagi tutup usaha. Ada transaksi yang belum dicatat?',
        'Hampir waktunya tutup. Kita cek dulu ya, semua transaksi hari ini sudah masuk?',
      ]), 1, ['record_sale', 'record_expense']);
    }
  }

  if (inWin(now, windows.recap)) {
    if (s.todaySales.count + s.todayCosts.count === 0) {
      add('closing-empty', 'Hari ini belum ada transaksi tercatat. Apakah semua penjualan dan pembelian hari ini sudah masuk?', 1, ['record_sale', 'record_expense']);
    } else {
      const sales = s.todaySales.total;
      const costs = s.todayCosts.total;
      const diff = sales >= costs ? `Selisihnya ${rupiah(sales - costs)}.` : `Pengeluaran lebih besar ${rupiah(costs - sales)} dari penjualan.`;
      add('daily-recap', variant('daily-recap', [
        `Sepertinya aktivitas hari ini sudah selesai. Penjualan tercatat ${rupiah(sales)}, pengeluaran tercatat ${rupiah(costs)}. ${diff}`,
        `Capek ya hari ini? Rekapnya: penjualan ${rupiah(sales)}, pengeluaran ${rupiah(costs)}. ${diff} Ada yang belum dicatat sebelum istirahat?`,
      ]), 1, ['open_report']);
    }
  }

  // Sapaan hangat sebagai pesan pertama hari ini bila tidak ada hal lain yang lebih relevan.
  if (!list.length && memory.count === 0 && now < windows.closing[0]) {
    const greeting = timeGreeting(now);
    add(`greeting-${greeting.replace(' ', '-')}`, shop
      ? `Halo, ${greeting}! Gimana kabar ${shop} hari ini? Ada yang ingin kamu siapkan?`
      : `Halo, ${greeting}! Ada yang ingin kamu siapkan untuk usaha hari ini?`, 1);
  }
  return list;
}

/** Reaksi singkat setelah transaksi dicatat: penjualan pertama, melewati kemarin, pengeluaran besar. */
export function reactiveCandidates(s: ProactiveSnapshot, rows: QuickSavedDetail['rows']): Candidate[] {
  const list: Candidate[] = [];
  const day = s.today;
  const sold = rows.filter((row) => row.jenis === 'penjualan');
  const spent = rows.filter((row) => row.jenis === 'biaya');

  const bigExpense = spent.find((row) => Number(row.jumlah) >= 100_000);
  if (bigExpense) {
    const amount = Number(bigExpense.jumlah);
    list.push({
      id: `react-expense-${slug(normalize(bigExpense.keterangan))}-${amount}`,
      text: `Pengeluaran ${bigExpense.keterangan.trim()} ${rupiah(amount)} tadi untuk bahan produksi atau kebutuhan operasional?`,
      cooldownDays: 2,
      actions: [],
    });
  }
  if (sold.length && s.yesterdaySales.total > 0 && s.todaySales.total > s.yesterdaySales.total) {
    list.push({
      id: 'react-beat-yesterday',
      text: pick(`${day}:beat`, [
        `Penjualan hari ini sudah ${rupiah(s.todaySales.total)}, melewati kemarin. Mantap!`,
        `Hebat, penjualan hari ini ${rupiah(s.todaySales.total)} sudah lebih tinggi dari kemarin.`,
      ]),
      cooldownDays: 1,
      actions: [],
    });
  }
  if (sold.length && s.todaySales.count === sold.length) {
    list.push({
      id: 'react-first-sale',
      text: pick(`${day}:first`, [
        'Penjualan pertama hari ini sudah masuk. Semangat ya!',
        'Yeay, penjualan pertama hari ini tercatat. Semoga lancar sampai sore!',
      ]),
      cooldownDays: 1,
      actions: [],
    });
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
        reactiveCount: sameDay ? Number(parsed.reactiveCount) || 0 : 0,
        reactiveLastAt: sameDay ? Number(parsed.reactiveLastAt) || 0 : 0,
        seen: pruneSeen(seen, day),
      };
    }
  } catch {
    // Penyimpanan lokal yang diblokir atau rusak tidak boleh mengganggu asisten.
  }
  return { day, count: 0, lastAt: 0, dismissed: 0, reactiveCount: 0, reactiveLastAt: 0, seen: {} };
}

function writeMemory(key: string, memory: Memory) {
  try { window.localStorage.setItem(key, JSON.stringify(memory)); } catch { /* abaikan */ }
}

function gateAllows(memory: Memory, nowMs: number): boolean {
  return memory.count < MAX_PER_DAY
    && memory.dismissed < MAX_DISMISSED_PER_DAY
    && nowMs - memory.lastAt >= MIN_GAP_MS
    && nowMs - memory.reactiveLastAt >= MIN_AFTER_PROACTIVE_MS;
}

function reactiveAllows(memory: Memory, nowMs: number): boolean {
  return memory.reactiveCount < MAX_REACTIVE_PER_DAY
    && memory.dismissed < MAX_DISMISSED_PER_DAY
    && nowMs - memory.reactiveLastAt >= MIN_REACTIVE_GAP_MS
    && nowMs - memory.lastAt >= MIN_AFTER_PROACTIVE_MS;
}

const isUnseen = (memory: Memory, today: string, candidate: Candidate) => {
  const lastSeen = memory.seen[candidate.id];
  return !lastSeen || dayDiff(today, lastSeen) >= candidate.cooldownDays;
};

/** Memilih satu pesan yang belum dalam masa jeda, atau null bila Cashie sebaiknya diam. */
export function pickProactiveMessage(s: ProactiveSnapshot, date: Date, memory: Memory): Candidate | null {
  return proactiveCandidates(s, date, memory).find((candidate) => isUnseen(memory, s.today, candidate)) ?? null;
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
  activeUserId = user.id;
  const since = new Date(Date.now() - 70 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('id,jenis,keterangan,jumlah,qty,created_at')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error || !data) return null;

  type ProfileRow = { nama_usaha?: string | null; jam_buka?: string | null; jam_tutup?: string | null };
  let profile: ProfileInfo = DEFAULT_PROFILE;
  const full = await supabase.from('business_profiles').select('nama_usaha,jam_buka,jam_tutup').eq('user_id', user.id).maybeSingle();
  if (!full.error) {
    const row = full.data as ProfileRow | null;
    profile = {
      exists: Boolean(row),
      name: row?.nama_usaha ?? null,
      jamBuka: isValidJam(row?.jam_buka) ? row.jam_buka : null,
      jamTutup: isValidJam(row?.jam_tutup) ? row.jam_tutup : null,
      hoursSupported: true,
    };
  } else {
    // Kolom jam belum ada (migration v20 belum dijalankan): tetap ambil nama usaha, jangan menanyakan jam.
    const basic = await supabase.from('business_profiles').select('nama_usaha').eq('user_id', user.id).maybeSingle();
    const row = basic.error ? null : (basic.data as ProfileRow | null);
    profile = { exists: Boolean(row), name: row?.nama_usaha ?? null, jamBuka: null, jamTutup: null, hoursSupported: false };
  }
  const today = todayISO();
  return buildSnapshot(user.id, data as RawTx[], today, profile, duePlansFor(user.id, today));
}

type Options = {
  enabled: boolean;
  /** True hanya bila Cashie sedang diam dan tidak ada aktivitas lain yang berjalan. */
  canInterrupt: () => boolean;
  /** Menampilkan pesan (dan membacakannya bila suara aktif). */
  deliver: (message: ProactiveMessage) => void;
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
        const candidate = pickProactiveMessage(snapshot, new Date(), memory);
        if (!candidate) return;

        memory.count += 1;
        memory.lastAt = Date.now();
        memory.seen[candidate.id] = day;
        writeMemory(activeMemoryKey, memory);
        if (candidate.intent?.type === 'plan_followup' && activeUserId) markPlanAsked(activeUserId, candidate.intent.planId, day);
        deliverRef.current(candidate);
      } catch (error) {
        console.warn('Cashie proaktif tidak dapat dijalankan:', error);
      } finally {
        running = false;
      }
    };

    const react = async (detail: QuickSavedDetail) => {
      if (running || !ready()) return;
      running = true;
      try {
        const day = todayISO();
        if (activeMemoryKey && !reactiveAllows(readMemory(activeMemoryKey, day), Date.now())) return;
        snapshot = await loadSnapshot();
        snapshotAt = Date.now();
        if (!snapshot || !activeMemoryKey || !ready()) return;

        const memory = readMemory(activeMemoryKey, day);
        if (!reactiveAllows(memory, Date.now())) return;
        const candidate = reactiveCandidates(snapshot, detail.rows).find((item) => isUnseen(memory, day, item));
        if (!candidate) return;

        memory.reactiveCount += 1;
        memory.reactiveLastAt = Date.now();
        memory.seen[candidate.id] = day;
        writeMemory(activeMemoryKey, memory);
        deliverRef.current(candidate);
      } catch (error) {
        console.warn('Reaksi Cashie tidak dapat dijalankan:', error);
      } finally {
        running = false;
      }
    };

    const first = window.setTimeout(() => void tick(), 2500);
    const interval = window.setInterval(() => void tick(), 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') window.setTimeout(() => void tick(), 1500); };
    const invalidate = () => { snapshotAt = 0; };
    // Transaksi yang dicatat Cashie sendiri tidak memicu reaksi: kartu suksesnya masih tampil sehingga ready() bernilai false.
    const onSaved = (event: Event) => {
      snapshotAt = 0;
      const detail = (event as CustomEvent<QuickSavedDetail | undefined>).detail;
      if (!detail || detail.guest || !detail.rows?.length) return;
      // Pembelian yang baru dicatat menuntaskan rencana "beli bahan" tanpa perlu ditanya lagi.
      if (activeUserId && detail.rows.some((row) => row.jenis === 'biaya' && Number(row.jumlah) >= 20_000 && !RECURRING.test(row.keterangan.toLowerCase()))) {
        completeBuyPlans(activeUserId);
      }
      window.setTimeout(() => void react(detail), 2200);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(TRANSACTION_SAVED_EVENT, onSaved);
    window.addEventListener(PROFILE_HOURS_EVENT, invalidate);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(TRANSACTION_SAVED_EVENT, onSaved);
      window.removeEventListener(PROFILE_HOURS_EVENT, invalidate);
    };
  }, [enabled]);
}
