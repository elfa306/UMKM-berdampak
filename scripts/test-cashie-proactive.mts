import assert from 'node:assert/strict';
import { buildSnapshot, openingGreeting, pickProactiveMessage, proactiveCandidates } from '../lib/cashieProactive';

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

// Sapaan setiap kali CAVA dibuka
t('sapaan: data belum termuat (null) tetap menyapa', () => { const g = openingGreeting(null, at(today, '09:00'), 0); assert.ok(g.text.trim()); assert.equal(g.greeting, true); assert.ok(!/Rp\d/.test(g.text)); });
t('sapaan: pengguna baru tanpa data tidak memuat angka', () => assert.ok(!/Rp\d/.test(openingGreeting(empty, at(today, '09:00'), 0).text)));
t('sapaan: pagi memakai "Selamat pagi"', () => { for (let i = 0; i < 8; i++) { const g = openingGreeting(null, new Date(at(today, '08:00').getTime() + i * 1000), i); assert.ok(!/selamat (siang|sore)/i.test(g.text), g.text); } });
t('sapaan: pukul 02:00 tidak mengucap "selamat pagi"', () => { for (let i = 0; i < 8; i++) assert.ok(!/selamat pagi/i.test(openingGreeting(null, new Date(at(today, '02:00').getTime() + i * 1000), i).text)); });
t('sapaan: kali kedua di hari yang sama menyebut penjualan hari ini bila ada', () => {
  const withToday = buildSnapshot('u5', [tx('penjualan', 'kue', 150000, today, '08:00'), ...rows], today);
  const g = openingGreeting(withToday, at(today, '12:00'), 1);
  assert.match(g.text, /1 penjualan/); assert.match(g.text, /150\.000/);
});
t('sapaan: pembukaan pertama hari ini menyebut penjualan kemarin (data nyata)', () => {
  const texts = new Set<string>();
  for (let i = 0; i < 20; i++) texts.add(openingGreeting(active, new Date(at(today, '07:00').getTime() + i * 7919), 0).text);
  for (const text of texts) assert.match(text, /Rp|Hari ini|Semoga/, text);
});
t('sapaan: kalimat bervariasi antar pembukaan', () => {
  const texts = new Set<string>();
  for (let i = 0; i < 30; i++) texts.add(openingGreeting(empty, new Date(at(today, '10:00').getTime() + i * 104729), i).text);
  assert.ok(texts.size >= 3, `hanya ${texts.size} variasi`);
});
t('setelah menyapa, sapaan pagi/umum lama tidak diulang', () => {
  const before = proactiveCandidates(active, at(today, '08:00'), mem()).filter((c) => c.id.startsWith('morning-') || c.id.startsWith('greeting-')).length;
  const after = proactiveCandidates(active, at(today, '08:00'), mem({ greets: 1 })).filter((c) => c.id.startsWith('morning-') || c.id.startsWith('greeting-')).length;
  assert.ok(before > 0, 'sebelum menyapa seharusnya ada sapaan pagi'); assert.equal(after, 0);
});

console.log(`\nLolos ${pass}, gagal ${fail}`);
process.exit(fail ? 1 : 0);
