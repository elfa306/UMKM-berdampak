import type { SupabaseClient } from '@supabase/supabase-js';

type LedgerEntry = { id: string; entry_no: string; source_type: string; entry_date: string; description: string; created_at: string };
type LedgerLine = { entry_id: string; account_code: string; account_name: string; account_type: string; debit: number | string; credit: number | string };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
function monthRange(month?: string) {
  const selected = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth();
  const [year, mon] = selected.split('-').map(Number);
  if (mon < 1 || mon > 12) return monthRange(currentMonth());
  const start = `${selected}-01`;
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);
  return { month: selected, start, endExclusive: next };
}
function calculate(entries: LedgerEntry[], lines: LedgerLine[], month?: string) {
  const range = monthRange(month);
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const currentLines = lines.filter((line) => {
    const entry = entryMap.get(line.entry_id);
    return Boolean(entry && entry.entry_date >= range.start && entry.entry_date < range.endExclusive);
  });
  const aggregate = (source: LedgerLine[]) => {
    const accounts = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
    for (const line of source) {
      const current = accounts.get(line.account_code) ?? { code: line.account_code, name: line.account_name, type: line.account_type, debit: 0, credit: 0 };
      current.debit += num(line.debit); current.credit += num(line.credit); accounts.set(line.account_code, current);
    }
    return [...accounts.values()].map((a) => ({ ...a, balance: a.type === 'asset' || a.type === 'expense' || a.type === 'contra_equity' ? a.debit - a.credit : a.credit - a.debit }));
  };
  const allAccounts = aggregate(lines);
  const monthAccounts = aggregate(currentLines);
  const sumBy = (accounts: ReturnType<typeof aggregate>, predicate: (a: ReturnType<typeof aggregate>[number]) => boolean) => accounts.filter(predicate).reduce((sum, a) => sum + a.balance, 0);
  const revenue = sumBy(monthAccounts, (a) => a.type === 'revenue');
  const cogs = sumBy(monthAccounts, (a) => ['5000', '5100'].includes(a.code));
  const operatingExpenses = sumBy(monthAccounts, (a) => ['6000', '6100', '7000'].includes(a.code));
  const otherExpenses = sumBy(monthAccounts, (a) => a.type === 'expense' && !['5000', '5100', '6000', '6100', '7000'].includes(a.code));
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - operatingExpenses - otherExpenses;
  const assets = sumBy(allAccounts, (a) => a.type === 'asset');
  const liabilities = sumBy(allAccounts, (a) => a.type === 'liability');
  const capitalAndOpening = sumBy(allAccounts, (a) => a.type === 'equity') - sumBy(allAccounts, (a) => a.type === 'contra_equity');
  const lifetimeRevenue = sumBy(allAccounts, (a) => a.type === 'revenue');
  const lifetimeExpenses = sumBy(allAccounts, (a) => a.type === 'expense');
  const lifetimeNet = lifetimeRevenue - lifetimeExpenses;
  const equity = capitalAndOpening + lifetimeNet;
  const cash = allAccounts.filter((a) => ['1000', '1010'].includes(a.code)).reduce((s, a) => s + a.balance, 0);
  const currentEntryIds = new Set(entries.filter((entry) => entry.entry_date >= range.start && entry.entry_date < range.endExclusive).map((entry) => entry.id));
  const priorEntryIds = new Set(entries.filter((entry) => entry.entry_date < range.start).map((entry) => entry.id));
  const cashLines = lines.filter((line) => ['1000', '1010'].includes(line.account_code));
  const openingCash = cashLines.filter((line) => priorEntryIds.has(line.entry_id)).reduce((sum, line) => sum + num(line.debit) - num(line.credit), 0);
  const periodCashLines = cashLines.filter((line) => currentEntryIds.has(line.entry_id));
  const cashIn = periodCashLines.reduce((sum, line) => sum + num(line.debit), 0);
  const cashOut = periodCashLines.reduce((sum, line) => sum + num(line.credit), 0);
  const cashFlow = { openingCash, cashIn, cashOut, netChange: cashIn - cashOut, closingCash: openingCash + cashIn - cashOut };
  const recent = entries.slice(0, 15).map((entry) => {
    const entryLines = lines.filter((line) => line.entry_id === entry.id);
    return { ...entry, totalDebit: entryLines.reduce((s, l) => s + num(l.debit), 0), totalCredit: entryLines.reduce((s, l) => s + num(l.credit), 0) };
  });
  const totalDebit = currentLines.reduce((s, l) => s + num(l.debit), 0);
  const totalCredit = currentLines.reduce((s, l) => s + num(l.credit), 0);
  return {
    period: range.month,
    profitLoss: { revenue, cogs, grossProfit, operatingExpenses, otherExpenses, netProfit, grossMargin: revenue > 0 ? grossProfit / revenue : 0, netMargin: revenue > 0 ? netProfit / revenue : 0 },
    balanceSheet: { assets, liabilities, capital: capitalAndOpening, retainedEarnings: lifetimeNet, equity, difference: assets - liabilities - equity, cash },
    cashFlow,
    accounts: allAccounts.sort((a, b) => a.code.localeCompare(b.code)),
    monthlyTrialBalance: monthAccounts.sort((a, b) => a.code.localeCompare(b.code)),
    recentEntries: recent,
    journalCount: entries.length,
    monthDebit: totalDebit,
    monthCredit: totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    note: 'Laporan dibentuk dari jurnal transaksi yang tercatat. Saldo harian/modal_harian lama tidak otomatis dianggap sebagai beban. Periksa saldo awal kas, bank, piutang, dan utang sebelum menggunakan laporan sebagai laporan resmi.',
  };
}

async function loadSnapshot(admin: SupabaseClient, entryTable: string, lineTable: string, scopeColumn: string, scopeId: string, month?: string) {
  const { data: entriesRaw, error: entriesError } = await admin.from(entryTable)
    .select('id,entry_no,source_type,entry_date,description,created_at')
    .eq(scopeColumn, scopeId).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(5000);
  if (entriesError) throw new Error(`Gagal membaca jurnal: ${entriesError.message}`);
  const entries = (entriesRaw ?? []) as LedgerEntry[];
  const ids = entries.map((e) => e.id);
  const lines: LedgerLine[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin.from(lineTable)
      .select('entry_id,account_code,account_name,account_type,debit,credit')
      .eq(scopeColumn, scopeId).in('entry_id', chunk);
    if (error) throw new Error(`Gagal membaca rincian jurnal: ${error.message}`);
    lines.push(...((data ?? []) as LedgerLine[]));
  }
  return calculate(entries, lines, month);
}

export function getOwnerLedgerSnapshot(admin: SupabaseClient, userId: string, month?: string) {
  return loadSnapshot(admin, 'journal_entries', 'journal_lines', 'user_id', userId, month);
}
export function getDemoLedgerSnapshot(admin: SupabaseClient, sessionId: string, month?: string) {
  return loadSnapshot(admin, 'demo_journal_entries', 'demo_journal_lines', 'session_id', sessionId, month);
}
