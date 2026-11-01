import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://api.belibayar.id';

type BelibayarEnvelope<T> = {
  success?: boolean;
  messages?: string;
  data?: T;
  code?: string;
};

export type DynamicQrisResult = {
  reference: string;
  transaction_id?: string;
  qr_content?: string;
  qr_url?: string;
  qr_code?: string | null;
  amount: number;
  status: string;
  expired_at?: number;
  merchant_fee?: number | null;
  net_credit?: number | null;
  fee_bearer?: 'merchant' | 'customer' | null;
};

export type StaticQrisResult = {
  reference: string;
  merchant_reference: string | null;
  label: string;
  qr_content: string;
  status: 'active' | 'inactive';
  created_at: number;
  deactivated_at: number | null;
};

/**
 * Charge succeeded, but neither the create response nor the status inquiry
 * returned the QR payload. Keep the local order pending so a later webhook can
 * still be reconciled; do not silently cancel a possibly-created gateway txn.
 */
export class BelibayarQrPayloadUnavailableError extends Error {
  readonly gateway: DynamicQrisResult;
  readonly diagnostic: Record<string, unknown>;

  constructor(gateway: DynamicQrisResult, diagnostic: Record<string, unknown>) {
    super('Belibayar menerima transaksi tetapi belum mengembalikan data QR. Invoice dipertahankan dalam status menunggu.');
    this.name = 'BelibayarQrPayloadUnavailableError';
    this.gateway = gateway;
    this.diagnostic = diagnostic;
  }
}

function getConfig() {
  const apiKey = process.env.BELIBAYAR_SANDBOX_API_KEY?.trim();
  const secretKey = process.env.BELIBAYAR_SANDBOX_SECRET_KEY?.trim();
  const configuredBase = (process.env.BELIBAYAR_API_BASE_URL || DEFAULT_BASE_URL).trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBase);
  } catch {
    throw new Error('BELIBAYAR_API_BASE_URL tidak valid.');
  }

  if (baseUrl.protocol !== 'https:' || baseUrl.hostname !== 'api.belibayar.id') {
    throw new Error('Integrasi tahap ini hanya mengizinkan host HTTPS resmi api.belibayar.id.');
  }
  if (!apiKey || !apiKey.startsWith('byr_test_')) {
    throw new Error('BELIBAYAR_SANDBOX_API_KEY harus menggunakan kredensial byr_test_.');
  }
  if (!secretKey) throw new Error('BELIBAYAR_SANDBOX_SECRET_KEY belum diatur.');

  return { apiKey, secretKey, baseUrl: baseUrl.origin };
}

export function isBelibayarSandboxConfigured(): boolean {
  return Boolean(
    process.env.BELIBAYAR_SANDBOX_API_KEY?.startsWith('byr_test_') &&
    process.env.BELIBAYAR_SANDBOX_SECRET_KEY?.trim() &&
    process.env.BELIBAYAR_SANDBOX_WEBHOOK_SECRET?.trim(),
  );
}

export function getBelibayarWebhookSecret(): string {
  const secret = process.env.BELIBAYAR_SANDBOX_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error('BELIBAYAR_SANDBOX_WEBHOOK_SECRET belum diatur.');
  return secret;
}

export function verifyBelibayarWebhookSignature(rawBody: Buffer, signature: string): boolean {
  let secret: string;
  try {
    secret = getBelibayarWebhookSecret();
  } catch {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function postSandbox<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const { apiKey, secretKey, baseUrl } = getConfig();
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', secretKey).update(rawBody).digest('hex');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Signature': signature,
        'Content-Type': 'application/json',
      },
      body: rawBody,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Koneksi ke Belibayar Sandbox mengalami timeout. Coba periksa koneksi dan whitelist IP.');
    }
    throw new Error('Tidak dapat menghubungi Belibayar Sandbox. Periksa koneksi server.');
  }

  const envelope = await response.json().catch(() => null) as BelibayarEnvelope<T> | null;
  if (!response.ok || !envelope?.success || !envelope.data) {
    const providerMessage = typeof envelope?.messages === 'string' ? envelope.messages : '';
    const errorData = envelope?.data && typeof envelope.data === 'object'
      ? envelope.data as Record<string, unknown>
      : null;
    const code = typeof errorData?.code === 'string'
      ? errorData.code
      : (typeof envelope?.code === 'string' ? envelope.code : '');
    const detail = `${code} ${providerMessage}`.toLowerCase();
    if (response.status === 403 || detail.includes('ip_whitelist') || detail.includes('ip_not_whitelisted')) {
      throw new Error('Belibayar menolak IP server. Daftarkan IP egress server pada menu Kredensial Belibayar. Vercel default memakai IP dinamis.');
    }
    if (response.status === 401 || detail.includes('signature')) {
      throw new Error('Autentikasi Belibayar gagal. Periksa pasangan Sandbox API Key dan Secret Key.');
    }
    throw new Error(providerMessage || `Belibayar Sandbox mengembalikan HTTP ${response.status}.`);
  }
  return envelope.data;
}

/**
 * Belibayar's Inquiry Status uses legacy Direct API v1 signing:
 * canonical = ':' + unix timestamp. Sandbox is part of the signed path.
 * The inquiry response documents the same transaction fields as Charge,
 * including qr_content and qr_url, so use it as a recovery read when Charge
 * acknowledged the order but omitted the QR payload.
 */
async function getSandbox<T>(path: string): Promise<T> {
  const { apiKey, secretKey, baseUrl } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secretKey).update(`:${timestamp}`).digest('hex');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Inquiry status Belibayar Sandbox mengalami timeout.');
    }
    throw new Error('Tidak dapat menghubungi Inquiry Status Belibayar Sandbox.');
  }

  const envelope = await response.json().catch(() => null) as BelibayarEnvelope<T> | null;
  if (!response.ok || !envelope?.success || !envelope.data) {
    const providerMessage = typeof envelope?.messages === 'string' ? envelope.messages : '';
    const errorData = envelope?.data && typeof envelope.data === 'object'
      ? envelope.data as Record<string, unknown>
      : null;
    const code = typeof errorData?.code === 'string'
      ? errorData.code
      : (typeof envelope?.code === 'string' ? envelope.code : '');
    throw new Error(`Inquiry Status Belibayar HTTP ${response.status}${code ? ` ${code}` : ''}: ${providerMessage || 'gagal mengambil detail transaksi.'}`);
  }
  return envelope.data;
}

function normalizeDynamicQris(data: DynamicQrisResult): DynamicQrisResult {
  const row = data as DynamicQrisResult & { qr_code?: unknown };
  const qrContent = typeof row.qr_content === 'string' && row.qr_content.trim()
    ? row.qr_content.trim()
    : undefined;
  const documentedQrUrl = typeof row.qr_url === 'string' && row.qr_url.trim()
    ? row.qr_url.trim()
    : undefined;
  // Some provider responses expose the optional image URL as qr_code.
  // Accept it only as an HTTPS image URL; never treat an arbitrary value as QR content.
  const legacyQrUrl = typeof row.qr_code === 'string' && /^https:\/\//i.test(row.qr_code.trim())
    ? row.qr_code.trim()
    : undefined;
  return {
    ...data,
    qr_content: qrContent,
    qr_url: documentedQrUrl ?? legacyQrUrl,
  };
}

function classifyQrCode(value: unknown): {
  type: string;
  kind: string;
  nonempty: boolean;
  length: number;
  host?: string;
  dataMime?: string;
} {
  if (typeof value !== 'string') {
    return { type: value === null ? 'null' : typeof value, kind: 'not_string', nonempty: false, length: 0 };
  }

  const text = value.trim();
  if (!text) return { type: 'string', kind: 'empty_string', nonempty: false, length: 0 };
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return { type: 'string', kind: 'http_image_or_link', nonempty: true, length: text.length, host: url.hostname };
    } catch {
      return { type: 'string', kind: 'invalid_url', nonempty: true, length: text.length };
    }
  }
  const dataImage = text.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (dataImage) {
    return { type: 'string', kind: 'data_image_base64', nonempty: true, length: text.length, dataMime: dataImage[1].toLowerCase() };
  }
  if (text.startsWith('000201')) {
    return { type: 'string', kind: 'emv_qris_payload', nonempty: true, length: text.length };
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length > 100) {
    return { type: 'string', kind: 'base64_like_unknown', nonempty: true, length: text.length };
  }
  return { type: 'string', kind: 'other_string', nonempty: true, length: text.length };
}

function dynamicResponseDiagnostic(data: DynamicQrisResult | null, inquiry: DynamicQrisResult | null, inquiryError?: string) {
  const summarize = (value: DynamicQrisResult | null) => {
    if (!value) return null;
    const qrCodeInfo = classifyQrCode(value.qr_code);
    return {
      keys: Object.keys(value).sort(),
      reference: value.reference ?? null,
      transaction_id_present: Boolean(value.transaction_id),
      status: value.status ?? null,
      has_qr_content: typeof value.qr_content === 'string' && value.qr_content.trim().length > 0,
      qr_content_length: typeof value.qr_content === 'string' ? value.qr_content.trim().length : 0,
      has_qr_url: typeof value.qr_url === 'string' && value.qr_url.trim().length > 0,
      qr_url_host: typeof value.qr_url === 'string' && value.qr_url.trim()
        ? (() => { try { return new URL(value.qr_url as string).hostname; } catch { return 'invalid_url'; } })()
        : null,
      // Never log the QR payload or full image URL. Only safe shape metadata.
      qr_code: qrCodeInfo,
    };
  };
  return {
    create_response: summarize(data),
    inquiry_response: summarize(inquiry),
    inquiry_error: inquiryError ?? null,
  };
}

export async function createDynamicQris(input: {
  reference: string;
  amount: number;
  customerName: string;
}): Promise<DynamicQrisResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new Error('Nominal QRIS harus berupa bilangan bulat rupiah positif.');
  }
  // Match the exact minimal request shape that was previously accepted by
  // this merchant's Sandbox. The merchant-level Callback URL is configured
  // in Belibayar Credentials, so do not override it in this request.
  const payload = {
    reference: input.reference,
    amount: input.amount,
    pay_method: { method: 'qris' },
    static_qr: false,
    customer_name: 'Pelanggan Demo',
    customer_email: 'demo@umkmberdampak.my.id',
    expired_time: Math.floor(Date.now() / 1000) + 15 * 60,
  };
  const chargeData = normalizeDynamicQris(await postSandbox<DynamicQrisResult>(
    '/direct/v1/sandbox/payment/charge',
    payload,
  ));

  if (chargeData.reference !== input.reference || Number(chargeData.amount) !== input.amount || chargeData.status !== 'pending') {
    throw new Error('Respons QRIS dinamis Belibayar tidak sesuai dengan invoice.');
  }

  if (chargeData.qr_content || chargeData.qr_url) return chargeData;

  // The charge response has already acknowledged this reference as pending,
  // but omitted its QR. Query the same transaction instead of creating another.
  let inquiryData: DynamicQrisResult | null = null;
  let inquiryError: string | undefined;
  try {
    inquiryData = normalizeDynamicQris(await getSandbox<DynamicQrisResult>(
      `/direct/v1/sandbox/payment/status/${encodeURIComponent(input.reference)}`,
    ));
  } catch (error) {
    inquiryError = error instanceof Error ? error.message : 'Inquiry Status gagal.';
  }

  if (inquiryData) {
    const inquiryMatches = inquiryData.reference === input.reference
      && Number(inquiryData.amount) === input.amount
      && ['pending', 'paid', 'expired', 'cancelled'].includes(inquiryData.status);
    if (inquiryMatches && (inquiryData.qr_content || inquiryData.qr_url)) {
      return { ...chargeData, ...inquiryData };
    }
  }

  const merged: DynamicQrisResult = {
    ...chargeData,
    ...(inquiryData ?? {}),
    qr_content: inquiryData?.qr_content ?? chargeData.qr_content,
    qr_url: inquiryData?.qr_url ?? chargeData.qr_url,
  };
  throw new BelibayarQrPayloadUnavailableError(
    merged,
    dynamicResponseDiagnostic(chargeData, inquiryData, inquiryError),
  );
}

export async function simulateDynamicQris(reference: string, action: 'success' | 'expire'): Promise<Record<string, unknown>> {
  return postSandbox<Record<string, unknown>>('/direct/v1/sandbox/payment/simulate', { reference, action });
}

export async function createStaticQris(input: { reference: string; label: string }): Promise<StaticQrisResult> {
  const data = await postSandbox<StaticQrisResult>('/direct/v1/sandbox/qris/static', {
    label: input.label.slice(0, 100),
    reference: input.reference,
  });
  if (data.merchant_reference !== input.reference || !data.qr_content || data.status !== 'active') {
    throw new Error('Respons QRIS statis Belibayar tidak sesuai dengan permintaan.');
  }
  return data;
}

export async function simulateStaticQris(reference: string, amount: number): Promise<{ transaction_id: string; amount: number; fee: number; net_amount: number }> {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Nominal simulasi harus berupa bilangan bulat positif.');
  return postSandbox('/direct/v1/sandbox/qris/static/' + encodeURIComponent(reference) + '/simulate', { amount });
}
