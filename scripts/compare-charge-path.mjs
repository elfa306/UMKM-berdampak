// scripts/compare-charge-path.mjs
import crypto from 'node:crypto';

const base = (process.env.BELIBAYAR_API_BASE_URL || 'https://api.belibayar.id').replace(/\/+$/, '');
const apiKey = process.env.BELIBAYAR_SANDBOX_API_KEY;
const secret = process.env.BELIBAYAR_SANDBOX_SECRET_KEY;
if (!apiKey?.startsWith('byr_test_')) throw new Error('Hanya boleh key byr_test_');

for (const path of ['/direct/v1/sandbox/payment/charge', '/direct/v1/payment/charge']) {
  const body = JSON.stringify({
    reference: `CMP${Date.now()}${path.includes('sandbox') ? 'S' : 'D'}`,
    amount: 25000,
    pay_method: { method: 'qris' },
    static_qr: false,
    customer_name: 'Uji Sandbox',
    customer_email: 'uji@example.com',
  });
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'X-Signature': crypto.createHmac('sha256', secret).update(body).digest('hex'),
      'Content-Type': 'application/json',
    },
    body,
  });
  const j = await res.json().catch(() => ({}));
  const d = j.data ?? {};
  console.log(path, res.status, {
    success: j.success, message: j.messages ?? j.message, code: d.code,
    status: d.status, qr_content_len: d.qr_content?.length ?? 0,
    qr_url_len: d.qr_url?.length ?? 0, qr_code_len: d.qr_code?.length ?? 0,
  });
}