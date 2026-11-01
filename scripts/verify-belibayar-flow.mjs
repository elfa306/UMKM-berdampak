import crypto from 'node:crypto';

const baseUrl = (process.env.BELIBAYAR_API_BASE_URL || 'https://api.belibayar.id').replace(/\/+$/, '');
const apiKey = process.env.BELIBAYAR_SANDBOX_API_KEY;
const secretKey = process.env.BELIBAYAR_SANDBOX_SECRET_KEY;
const reference = process.argv[2];
const action = process.argv[3] || 'success';

function fail(message, code = 1) {
  console.error(`\nGAGAL: ${message}`);
  process.exit(code);
}

function sign(value) {
  return crypto.createHmac('sha256', secretKey).update(value, 'utf8').digest('hex');
}

function safeSummary(json) {
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  return {
    success: json?.success ?? null,
    message: json?.messages ?? json?.message ?? null,
    code: data?.code ?? json?.code ?? null,
    reference: data?.reference ?? data?.transaction?.reference ?? null,
    transaction_id: data?.transaction_id ?? data?.transaction?.transaction_id ?? null,
    status: data?.status ?? data?.transaction?.status ?? null,
    has_qr_content: typeof data?.qr_content === 'string' && data.qr_content.length > 0,
    has_qr_url: typeof data?.qr_url === 'string' && data.qr_url.length > 0,
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { success: false, messages: `Respons bukan JSON (HTTP ${response.status})`, raw_length: text.length };
  }
}

async function inquiry(label) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = `/direct/v1/sandbox/payment/status/${encodeURIComponent(reference)}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'X-Api-Key': apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': sign(`:${timestamp}`),
      'Accept': 'application/json',
    },
  });
  const json = await readJson(response);
  console.log(`\n[${label}] HTTP ${response.status}`);
  console.log(JSON.stringify(safeSummary(json), null, 2));
  return { httpStatus: response.status, json, summary: safeSummary(json) };
}

async function simulate() {
  const body = JSON.stringify({ reference, action });
  const response = await fetch(`${baseUrl}/direct/v1/sandbox/payment/simulate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'X-Signature': sign(body),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
  });
  const json = await readJson(response);
  console.log(`\n[SIMULATE ${action}] HTTP ${response.status}`);
  console.log(JSON.stringify(safeSummary(json), null, 2));
  return { httpStatus: response.status, json, summary: safeSummary(json) };
}

if (!apiKey || !secretKey) {
  fail('BELIBAYAR_SANDBOX_API_KEY dan BELIBAYAR_SANDBOX_SECRET_KEY wajib diisi di .env.local.');
}
if (!apiKey.startsWith('byr_test_')) {
  fail('API Key bukan key Sandbox (awalan yang diharapkan: byr_test_). Periksa pasangan key di .env.local.');
}
if (!reference || !/^[A-Za-z0-9_-]{3,255}$/.test(reference)) {
  fail('Masukkan reference Belibayar yang tepat sebagai argumen pertama. Jangan gunakan UUID order lokal atau transaction_id.');
}
if (!['success', 'expire'].includes(action)) {
  fail('Action hanya boleh success atau expire.');
}

console.log('BELIBAYAR SANDBOX — PEMERIKSAAN END-TO-END');
console.log(`Base URL : ${baseUrl}`);
console.log(`Reference: ${reference}`);
console.log(`Action   : ${action}`);
console.log('Kredensial tidak akan dicetak. QR payload juga tidak dicetak.');

const before = await inquiry('INQUIRY SEBELUM SIMULASI');
if (before.httpStatus < 200 || before.httpStatus >= 300 || before.json?.success !== true) {
  fail('Inquiry tidak menemukan transaksi. Pastikan reference, API Key byr_test_, Secret Key Sandbox, dan merchant/environment sama. Simulasi dihentikan agar tidak menambah kebingungan.');
}
if (before.summary.reference && before.summary.reference !== reference) {
  fail(`Reference respons (${before.summary.reference}) tidak sama dengan reference yang diminta. Simulasi dihentikan.`);
}
if (before.summary.status && before.summary.status !== 'pending') {
  console.log(`\nTransaksi sudah berstatus ${before.summary.status}; tidak perlu disimulasikan lagi.`);
  process.exit(0);
}

const simulated = await simulate();
if (simulated.httpStatus < 200 || simulated.httpStatus >= 300 || simulated.json?.success !== true) {
  if (simulated.summary.code === 'NOT_FOUND' && before.httpStatus >= 200 && before.httpStatus < 300) {
    fail('Inquiry berhasil menemukan reference yang sama, tetapi endpoint simulate mengembalikan NOT_FOUND. Ini menunjukkan inkonsistensi pada sisi Sandbox Belibayar atau pemetaan internal endpoint simulate; simpan output ini untuk tim dukungan Belibayar.');
  }
  fail('Endpoint simulasi menolak permintaan. Simpan HTTP status, messages, dan data.code untuk pemeriksaan berikutnya.');
}

const after = await inquiry('INQUIRY SETELAH SIMULASI');
if (after.summary.status === 'paid') {
  console.log('\nBERHASIL: transaksi sekarang PAID. Periksa Vercel Function Logs untuk memastikan webhook mencapai /api/webhooks/belibayar dan database demo diperbarui.');
} else {
  console.log('\nSIMULASI DITERIMA, tetapi inquiry belum menunjukkan PAID. Tunggu sebentar lalu jalankan ulang inquiry; jangan mengirim simulasi berulang kali.');
}
