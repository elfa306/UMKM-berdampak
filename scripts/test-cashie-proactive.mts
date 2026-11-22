import assert from 'node:assert/strict';
import { buildSnapshot, pickProactiveMessage, proactiveCandidates } from '../lib/cashieProactive';

let pass = 0, fail = 0;
const t = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log('GAGAL:', name, '\n  ', (e as Error).message.split('\n')[0]); } };

const today = '2026-11-22';
const at = (day: string, hhmmWib: string) => { const [h, m] = hhmmWib.split(':').map(Number); return new Date(`${day}T${String(h - 7 < 0 ? h + 17 : h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); };
const mem = (over: Record<string, unknown> = {}) => ({ day: today, count: 0, lastAt: 0, dismissed: 0, reactiveCount: 0, reactiveLastAt: 0, seen: {} as Record<string, string>, ...over });
let n = 0;
const tx = (jenis: 'penjualan' | 'biaya', keterangan: string, jumlah: number, day: string, hhmm = '10:00') => ({ id: `t${n++}`, jenis, keterangan, jumlah, qty: 1, created_at: at(day, hhmm).toISOString() });
const dayOffset = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

// Pengguna baru tanpa data
const empty = buildSnapshot('u1', [], today);
t('data kosong: tidak crash', () => assert.ok(empty));
t('data kosong: tidak mengarang angka penjualan', () => {
  const msgs = proactiveCandidates(empty, at(today, '09:00'), mem());
  for (const m of msgs) assert.ok(!/Rp\d/.test(m.text), `pesan memuat angka: ${m.text}`);
});
t('data kosong: bila bicara, tidak menyebut penjualan meningkat/menurun', () => {
  const msgs = proactiveCandidates(empty, at(today, '14:00'), mem());
  for (const m of msgs) assert.ok(!/meningkat|menurun|lebih rendah/i.test(m.text), m.text);
});

// Pengguna aktif 10 hari
const rows = [] as ReturnType<typeof tx>[];
for (let d = 1; d <= 10; d++) {
  rows.push(tx('penjualan', 'kue', 120000, dayOffset(d), '09:00'));
  rows.push(tx('penjualan', 'kue', 80000, dayOffset(d), '17:30'));
  rows.push(tx('biaya', 'beli tepung', 60000, dayOffset(d), '06:30'));
}
const active = buildSnapshot('u2', rows, today);
t('pengguna aktif: snapshot berisi riwayat kemarin', () => assert.ok(active.yesterdaySales.count > 0));
t('pengguna aktif: pagi ada pesan', () => assert.ok(pickProactiveMessage(active, at(today, '08:00'), mem())));

// Tidak diulang: tandai semua kandidat sebagai sudah dilihat
t('tidak mengulang pesan yang sama', () => {
  const seen: Record<string, string> = {};
  const seenIds = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const m = pickProactiveMessage(active, at(today, '09:30'), mem({ seen }));
    if (!m) break;
    assert.ok(!seenIds.has(m.id), `duplikat ${m.id}`);
    seenIds.add(m.id); seen[m.id] = today;
  }
});
t('pesan selalu punya teks tak kosong dan id', () => {
  for (const hh of ['06:00', '09:00', '13:00', '17:30', '19:00', '21:30', '23:30', '02:00']) {
    for (const c of proactiveCandidates(active, at(today, hh), mem())) { assert.ok(c.text.trim()); assert.ok(c.id); }
  }
});
t('tengah malam (02:00): tidak ada sapaan "Selamat pagi" yang salah', () => {
  for (const c of proactiveCandidates(active, at(today, '02:00'), mem())) assert.ok(!/selamat pagi/i.test(c.text), c.text);
});

// Transaksi belum dikonfirmasi / data tidak lengkap
t('keterangan null tidak membuat crash', () => {
  const bad = [{ id: 'x', jenis: 'biaya', keterangan: null, jumlah: '50000', qty: null, created_at: new Date().toISOString() }];
  const s = buildSnapshot('u3', bad as never, today);
  proactiveCandidates(s, at(today, '12:00'), mem());
});
t('jumlah string non-angka tidak membuat crash', () => {
  const bad = [{ id: 'y', jenis: 'penjualan', keterangan: 'kue', jumlah: 'abc', qty: 'x', created_at: new Date().toISOString() }];
  const s = buildSnapshot('u4', bad as never, today);
  proactiveCandidates(s, at(today, '12:00'), mem());
});

console.log(`\nLolos ${pass}, gagal ${fail}`);
process.exit(fail ? 1 : 0);
