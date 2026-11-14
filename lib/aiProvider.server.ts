export type ProviderName = 'groq' | 'gemini' | 'openrouter';
export type ChatRole = 'user' | 'assistant';
export type ChatTurn = { role: ChatRole; content: string };

export type ProposedTransaction = {
  type: 'transaction';
  jenis: 'penjualan' | 'biaya';
  keterangan: string;
  jumlah: number;
  qty: number;
  metode: 'tunai' | 'qris' | null;
};

export type NavigateAction = { type: 'navigate'; path: string; label: string };
export type OpenManualRecordAction = { type: 'open_manual_record'; mode: 'masuk' | 'keluar' | 'modal' };
export type ProductKind = 'merchandise' | 'raw_material' | 'work_in_progress' | 'finished_good' | 'service';
export type ProductCreateAction = {
  type: 'product_create'; nama: string; sku: string | null; kategori: string;
  jenis_item: ProductKind; satuan: string; harga: number; harga_pokok: number;
};
export type ProductUpdateAction = {
  type: 'product_update'; product_id: string; product_name: string;
  changes: Partial<{ nama: string; sku: string | null; kategori: string; jenis_item: ProductKind; satuan: string; harga: number; harga_pokok: number }>;
};
export type ProductDeleteAction = { type: 'product_delete'; product_id: string; product_name: string };
export type ProductionRecipeCreateAction = {
  type: 'production_recipe_create'; name: string; output_product_id: string; output_product_name: string;
  output_qty: number; items: Array<{ product_id: string; product_name: string; qty: number }>; note: string | null;
};
export type ProductionBatchCompleteAction = {
  type: 'production_batch_complete'; recipe_id: string; recipe_name: string; batch_count: number;
  labor_cost: number; overhead_cost: number; note: string | null;
};
export type ProfileUpdateAction = { type: 'profile_update'; changes: Partial<{
  nama_usaha: string; tanggal_mulai_usaha: string; hari_buka_per_bulan: number; kebutuhan_modal: number;
  jenis_usaha: 'retail' | 'manufaktur' | 'jasa' | 'campuran';
  bentuk_usaha: 'perorangan' | 'pt_perorangan' | 'cv' | 'pt' | 'koperasi' | 'lainnya';
  bidang_usaha: string; memiliki_persediaan: boolean; metode_pembayaran: 'gopay_macrodroid' | 'manual';
}> };
export type AccountingEntryAction = { type: 'accounting_entry'; kind: 'capital' | 'draw' | 'supplier_payment' | 'labor_payment' | 'overhead_payment'; amount: number; description: string; payment_account: '1000' | '1010' };
export type TransactionDeleteAction = { type: 'transaction_delete'; transaction_id: string; description: string; amount: number; date: string; jenis: 'penjualan' | 'biaya' };
export type OpeningBalanceSetupAction = { type: 'opening_balance_setup'; cash_amount: number; bank_amount: number };
export type StartDailySessionAction = { type: 'start_daily_session'; date: string; modal_harian: number };
export type DailyModalSetAction = { type: 'daily_modal_set'; amount: number; date: string };
export type AccountingReportExportAction = { type: 'accounting_report_export'; month: string };
// Semua tindakan terkonfirmasi ditandatangani server dan hanya dapat dieksekusi satu kali.
export type AssistantMutationAction = ProductCreateAction | ProductUpdateAction | ProductDeleteAction | ProductionRecipeCreateAction | ProductionBatchCompleteAction | ProfileUpdateAction | AccountingEntryAction | TransactionDeleteAction | OpeningBalanceSetupAction | StartDailySessionAction | DailyModalSetAction;
export type AssistantAction = ProposedTransaction | NavigateAction | OpenManualRecordAction | AccountingReportExportAction | AssistantMutationAction;

export type AssistantResult = {
  reply: string;
  actions: AssistantAction[];
};

class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

// Anggaran waktu per permintaan. Harus lebih kecil dari `maxDuration` route masing-masing
// (chat = 30 dtk, transcribe = 60 dtk) supaya fallback ke Gemini/OpenRouter sempat berjalan.
const CHAT_BUDGET_MS = 26_000;
const TRANSCRIBE_BUDGET_MS = 50_000;
// Groq biasanya menjawab dalam hitungan detik; bila diam lebih dari ini, langsung pindah ke Gemini.
const GROQ_CHAT_MS = 9_000;
const GROQ_TRANSCRIBE_MS = 12_000;
const MIN_FALLBACK_MS = 4_000;

export const TIMEOUT_MESSAGE = 'Layanan AI sedang lambat. Coba tahan tombol V dan ucapkan lagi.';

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /aborted due to timeout/i.test(error.message));
}

/** Ubah pesan error teknis (mis. "The operation was aborted due to timeout") menjadi pesan yang layak ditampilkan. */
export function publicAiError(error: unknown, fallback: string): string {
  if (isTimeoutError(error)) return TIMEOUT_MESSAGE;
  if (error instanceof Error && /^fetch failed$/i.test(error.message)) return 'Koneksi ke layanan AI terputus. Coba lagi sebentar.';
  return error instanceof Error ? error.message : fallback;
}

async function timed<T>(label: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await task();
    console.info(`[CAVA AI] ${label} ok ${Date.now() - startedAt}ms`);
    return value;
  } catch (error) {
    console.warn(`[CAVA AI] ${label} gagal ${Date.now() - startedAt}ms:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    throw isTimeoutError(error) ? new ProviderError(TIMEOUT_MESSAGE, 408) : error;
  }
}

function canFallback(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true;
  // 413 = permintaan melebihi batas token Groq; Gemini punya jendela konteks jauh lebih besar.
  return error.status === 408 || error.status === 413 || error.status === 429 || (error.status !== undefined && error.status >= 500);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.warn('[CAVA AI] JSON tidak valid dari AI:', clean.slice(0, 200));
    throw new Error('Jawaban AI belum utuh. Coba ucapkan lagi.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Format jawaban AI tidak valid.');
  }
  return parsed as Record<string, unknown>;
}

async function groqChat(system: string, history: ChatTurn[], message: string, timeoutMs: number): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new ProviderError('GROQ_API_KEY belum diatur.');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    if (response.status === 429 || response.status === 413) {
      const detail = await response.text().catch(() => '');
      console.warn(`[CAVA AI] Groq ${response.status} detail:`, detail.slice(0, 300), '| retry-after:', response.headers.get('retry-after'));
    }
    throw new ProviderError(`Groq mengembalikan HTTP ${response.status}.`, response.status);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Groq tidak memberikan jawaban.');
  return content;
}

/** Opsional: batasi "thinking" Gemini agar cepat. Isi GEMINI_THINKING_LEVEL (mis. low) ATAU GEMINI_THINKING_BUDGET (angka; 0 = mati) di .env.local. */
function geminiThinkingConfig(): { thinkingConfig?: Record<string, string | number> } {
  const level = process.env.GEMINI_THINKING_LEVEL?.trim();
  if (level) return { thinkingConfig: { thinkingLevel: level } };
  const budget = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (budget && Number.isFinite(Number(budget))) return { thinkingConfig: { thinkingBudget: Number(budget) } };
  return {};
}

async function geminiChat(system: string, history: ChatTurn[], message: string, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('GEMINI_API_KEY belum diatur.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const contents = [
    ...history.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 0.2,
        // Token "berpikir" ikut dihitung dari batas ini pada model thinking, jadi beri ruang lebih besar.
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        ...geminiThinkingConfig(),
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new ProviderError(`Gemini mengembalikan HTTP ${response.status}.`, response.status);
  const data = await response.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const usage = data?.usageMetadata;
  console.info(`[CAVA AI] gemini finishReason=${finishReason} thoughts=${usage?.thoughtsTokenCount ?? '-'} output=${usage?.candidatesTokenCount ?? '-'}`);
  if (finishReason === 'MAX_TOKENS') throw new Error('Jawaban AI terpotong. Coba ucapkan lagi dengan perintah yang lebih singkat.');
  const content = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('');
  if (typeof content !== 'string' || !content.trim()) throw new Error('Gemini tidak memberikan jawaban.');
  return content;
}

async function openRouterChat(system: string, history: ChatTurn[], message: string, timeoutMs: number): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ProviderError('OPENROUTER_API_KEY belum diatur.');
  const model = process.env.OPENROUTER_MODEL || 'openrouter/free';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'CAVA - Cash Value' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ],
      max_tokens: 1800,
      // Hanya rute ke endpoint yang mendukung JSON mode dan parameter yang diminta.
      provider: { require_parameters: true },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.warn(`[CAVA AI] OpenRouter HTTP ${response.status}:`, detail.slice(0, 500));
    if (response.status === 401) {
      throw new ProviderError('API key OpenRouter tidak valid. Periksa OPENROUTER_API_KEY di Vercel.', 401);
    }
    if (response.status === 402) {
      throw new ProviderError('OpenRouter menolak permintaan karena saldo atau konfigurasi akun. Pastikan model menggunakan openrouter/free.', 402);
    }
    if (response.status === 429) {
      throw new ProviderError('Batas permintaan OpenRouter Free tercapai atau model sedang sibuk. Coba lagi nanti.', 429);
    }
    throw new ProviderError(`OpenRouter mengembalikan HTTP ${response.status}.`, response.status);
  }

  const data = await response.json();
  if (data?.error) {
    const apiMessage = typeof data.error.message === 'string' ? data.error.message.slice(0, 240) : 'respons memuat objek error';
    console.warn('[CAVA AI] OpenRouter response error:', { code: data.error.code ?? null, message: apiMessage });
    throw new ProviderError(`OpenRouter mengembalikan error: ${apiMessage}`, Number(data.error.code) || 502);
  }

  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const assistantMessage = choice?.message;
  const rawContent = assistantMessage?.content;
  const content = typeof rawContent === 'string'
    ? rawContent.trim()
    : Array.isArray(rawContent)
      ? rawContent.map((part: unknown) => {
          if (typeof part === 'string') return part;
          if (!part || typeof part !== 'object') return '';
          const item = part as { type?: string; text?: string };
          // Jangan mengubah blok reasoning menjadi jawaban yang ditampilkan kepada pengguna.
          return (!item.type || item.type === 'text' || item.type === 'output_text') && typeof item.text === 'string'
            ? item.text
            : '';
        }).join('').trim()
      : '';

  if (!content) {
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'tidak tersedia';
    const messageKeys = assistantMessage && typeof assistantMessage === 'object' ? Object.keys(assistantMessage) : [];
    const hasReasoning = Boolean(assistantMessage?.reasoning || assistantMessage?.reasoning_content || assistantMessage?.reasoning_details);
    const hasRefusal = typeof assistantMessage?.refusal === 'string' && assistantMessage.refusal.length > 0;

    // Log hanya metadata respons, bukan prompt atau isi percakapan yang bisa berisi data keuangan UMKM.
    console.warn('[CAVA AI] OpenRouter tidak mengirim teks jawaban:', {
      model: data?.model ?? model,
      finishReason,
      nativeFinishReason: choice?.native_finish_reason ?? null,
      messageKeys,
      contentType: Array.isArray(rawContent) ? 'array' : typeof rawContent,
      hasReasoning,
      hasRefusal,
      completionTokens: data?.usage?.completion_tokens ?? null,
    });

    if (hasRefusal) throw new ProviderError('Model OpenRouter menolak permintaan ini. Coba sampaikan perintah dengan cara berbeda.', 502);
    if (finishReason === 'length') throw new ProviderError('Jawaban OpenRouter terpotong sebelum teks selesai. Coba perintah yang lebih singkat.', 502);
    if (hasReasoning) throw new ProviderError('Model OpenRouter hanya mengirim proses internal tanpa jawaban akhir. Coba ulangi perintah.', 502);
    throw new ProviderError(`OpenRouter tidak mengirim teks jawaban (finish_reason: ${finishReason}). Coba lagi atau periksa Runtime Logs Vercel.`, 502);
  }

  console.info(`[CAVA AI] OpenRouter model=${data?.model ?? model} finish_reason=${choice?.finish_reason ?? '-'}`);
  return content;
}

export async function generateAssistantReply(
  system: string,
  history: ChatTurn[],
  message: string,
): Promise<{ result: AssistantResult; provider: ProviderName }> {
  let raw = '';
  let provider: ProviderName = 'groq';
  let lastError: unknown;
  const deadline = Date.now() + CHAT_BUDGET_MS;
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  // Urutan provider chat: Groq utama, Gemini cadangan pertama, OpenRouter Free cadangan terakhir.
  if (hasGroq) {
    try {
      const groqMs = hasGemini || hasOpenRouter ? GROQ_CHAT_MS : CHAT_BUDGET_MS;
      raw = await timed('chat groq', () => groqChat(system, history, message, groqMs));
      provider = 'groq';
    } catch (error) {
      lastError = error;
      if (!canFallback(error)) throw error;
    }
  }

  if (!raw && hasGemini) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_FALLBACK_MS) throw new ProviderError(TIMEOUT_MESSAGE, 408);
    // Bila OpenRouter juga aktif, sisakan hingga 8 detik untuk provider terakhir.
    // Jika sisa waktu terlalu sempit, langsung gunakan OpenRouter daripada menghabiskan budget pada Gemini.
    if (!hasOpenRouter || remaining >= MIN_FALLBACK_MS * 3) {
      const geminiTimeout = hasOpenRouter ? remaining - 8_000 : remaining;
      try {
        raw = await timed('chat gemini', () => geminiChat(system, history, message, geminiTimeout));
        provider = 'gemini';
      } catch (error) {
        lastError = error;
        if (!canFallback(error)) throw error;
      }
    }
  }

  if (!raw && hasOpenRouter) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_FALLBACK_MS) throw new ProviderError(TIMEOUT_MESSAGE, 408);
    raw = await timed('chat openrouter', () => openRouterChat(system, history, message, remaining));
    provider = 'openrouter';
  }

  if (!raw) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Atur GROQ_API_KEY, GEMINI_API_KEY, atau OPENROUTER_API_KEY untuk mengaktifkan AI.');
  }

  const parsed = parseJsonObject(raw);
  let reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 1800) : '';
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const allowedRoutes = new Map<string, string>([
    ['/kasir', 'Beranda'], ['/laporan', 'Riwayat dan Laporan'], ['/pembiayaan', 'Rekomendasi Pembiayaan'],
    ['/inventaris', 'Katalog Produk'], ['/harga', 'Cek Harga Bahan'], ['/lainnya', 'Pengaturan dan Akun'],
    ['/pengaturan-usaha', 'Profil Usaha'], ['/integrasi', 'Integrasi'], ['/riwayat', 'Riwayat'],
    ['/statistik', 'Statistik'], ['/kredit', 'Kredit'], ['/rekomendasi', 'Rekomendasi'],
    ['/demo', 'Ruang Demo'], ['/demo/akuntansi', 'Demo Akuntansi'], ['/demo/analisis', 'Demo Analisis'],
    ['/demo/inventaris', 'Demo Inventaris'], ['/demo/kasir', 'Demo Kasir'], ['/demo/persiapan', 'Persiapan Demo'],
    ['/demo/produksi', 'Demo Produksi'], ['/demo/ruang', 'Ruang Demo Interaktif'],
  ]);
  const productKinds = new Set<ProductKind>(['merchandise', 'raw_material', 'work_in_progress', 'finished_good', 'service']);
  const catalogProductKinds = new Set<ProductKind>(['merchandise', 'finished_good', 'service']);
  const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
  const validPrice = (value: unknown, allowZero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= 100_000_000_000;

  const actions: AssistantAction[] = rawActions.slice(0, 6).flatMap((item): AssistantAction[] => {
    if (!item || typeof item !== 'object') return [];
    const action = item as Record<string, unknown>;

    if (action.type === 'navigate') {
      const path = typeof action.path === 'string' ? action.path : '';
      const label = allowedRoutes.get(path);
      return label ? [{ type: 'navigate', path, label }] : [];
    }
    if (action.type === 'open_manual_record') {
      const mode = action.mode === 'keluar' || action.mode === 'modal' ? action.mode : 'masuk';
      return [{ type: 'open_manual_record', mode }];
    }
    if (action.type === 'transaction') {
      const jenis = action.jenis;
      const jumlah = Number(action.jumlah);
      const keterangan = typeof action.keterangan === 'string' ? action.keterangan.trim().slice(0, 120) : '';
      const metode = action.metode === 'tunai' || action.metode === 'qris' ? action.metode : null;
      const qty = action.qty === undefined ? 1 : Number(action.qty);
      if ((jenis !== 'penjualan' && jenis !== 'biaya') || !validPrice(jumlah) || !Number.isSafeInteger(qty) || qty < 1 || qty > 100_000 || !keterangan) return [];
      return [{ type: 'transaction', jenis, jumlah, qty, keterangan, metode }];
    }
    if (action.type === 'transaction_delete') {
      const transactionId = action.transaction_id;
      const description = action.description;
      const amount = Number(action.amount);
      const date = action.date;
      const jenis = action.jenis;
      if (!validUuid(transactionId) || !validText(description, 120) || !validPrice(amount) ||
          typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          (jenis !== 'penjualan' && jenis !== 'biaya')) return [];
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return [];
      return [{ type: 'transaction_delete', transaction_id: transactionId, description: description.trim(), amount, date, jenis }];
    }
    if (action.type === 'opening_balance_setup') {
      const cash = Number(action.cash_amount);
      const bank = Number(action.bank_amount);
      if (!validPrice(cash, true) || !validPrice(bank, true)) return [];
      return [{ type: 'opening_balance_setup', cash_amount: cash, bank_amount: bank }];
    }
    if (action.type === 'daily_modal_set') {
      const amount = Number(action.amount);
      const date = action.date;
      if (!validPrice(amount, true) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return [];
      return [{ type: 'daily_modal_set', amount, date }];
    }
    if (action.type === 'start_daily_session') {
      const date = action.date;
      const modalHarian = Number(action.modal_harian);
      if (!validPrice(modalHarian, true) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return [];
      return [{ type: 'start_daily_session', date, modal_harian: modalHarian }];
    }
    if (action.type === 'accounting_report_export') {
      const month = action.month;
      if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
      return [{ type: 'accounting_report_export', month }];
    }
    if (action.type === 'product_create') {
      const rawName = action.nama;
      const jenis = action.jenis_item;
      const harga = Number(action.harga);
      const hargaPokok = Number(action.harga_pokok);
      if (!validText(rawName, 100) || rawName.trim().length < 2 || !productKinds.has(jenis as ProductKind) || !validPrice(harga, jenis === 'raw_material' || jenis === 'work_in_progress') || !validPrice(hargaPokok, true)) return [];
      const rawSku = action.sku;
      const sku = rawSku === null || rawSku === undefined || rawSku === '' ? null : (validText(rawSku, 32) ? rawSku.trim() : undefined);
      if (sku === undefined) return [];
      const rawCategory = action.kategori;
      const rawUnit = action.satuan;
      return [{
        type: 'product_create', nama: rawName.trim(), sku,
        kategori: validText(rawCategory, 40) ? rawCategory.trim() : 'Umum',
        jenis_item: jenis as ProductKind,
        satuan: validText(rawUnit, 20) ? rawUnit.trim() : 'pcs',
        harga, harga_pokok: hargaPokok,
      }];
    }
    if (action.type === 'product_update') {
      const productId = action.product_id;
      const productName = action.product_name;
      if (!validUuid(productId) || !validText(productName, 100)) return [];
      const changes: ProductUpdateAction['changes'] = {};
      const rawName = action.nama;
      const rawSku = action.sku;
      const rawCategory = action.kategori;
      const rawUnit = action.satuan;
      if (rawName !== undefined && validText(rawName, 100) && rawName.trim().length >= 2) changes.nama = rawName.trim();
      if (rawSku !== undefined) {
        if (rawSku === null || rawSku === '') changes.sku = null;
        else if (validText(rawSku, 32)) changes.sku = rawSku.trim();
        else return [];
      }
      if (rawCategory !== undefined && validText(rawCategory, 40)) changes.kategori = rawCategory.trim();
      if (action.jenis_item !== undefined && catalogProductKinds.has(action.jenis_item as ProductKind)) changes.jenis_item = action.jenis_item as ProductKind;
      if (rawUnit !== undefined && validText(rawUnit, 20)) changes.satuan = rawUnit.trim();
      if (action.harga !== undefined && validPrice(Number(action.harga))) changes.harga = Number(action.harga);
      if (action.harga_pokok !== undefined && validPrice(Number(action.harga_pokok), true)) changes.harga_pokok = Number(action.harga_pokok);
      if (!Object.keys(changes).length) return [];
      return [{ type: 'product_update', product_id: productId, product_name: productName.trim(), changes }];
    }
    if (action.type === 'product_delete') {
      const productId = action.product_id;
      const productName = action.product_name;
      if (!validUuid(productId) || !validText(productName, 100)) return [];
      return [{ type: 'product_delete', product_id: productId, product_name: productName.trim() }];
    }
    if (action.type === 'production_recipe_create') {
      const name = action.name;
      const outputProductId = action.output_product_id;
      const outputProductName = action.output_product_name;
      const outputQty = Number(action.output_qty);
      if (!validText(name, 120) || !validUuid(outputProductId) || !validText(outputProductName, 100) || !Number.isFinite(outputQty) || outputQty <= 0 || outputQty > 1_000_000) return [];
      if (!Array.isArray(action.items) || action.items.length < 1 || action.items.length > 30) return [];
      const items: Array<{ product_id: string; product_name: string; qty: number }> = [];
      for (const rawItem of action.items) {
        if (!rawItem || typeof rawItem !== 'object') return [];
        const row = rawItem as Record<string, unknown>;
        const productId = row.product_id;
        const productName = row.product_name;
        const qty = Number(row.qty);
        if (!validUuid(productId) || !validText(productName, 100) || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return [];
        items.push({ product_id: productId, product_name: productName.trim(), qty });
      }
      const note = typeof action.note === 'string' ? action.note.trim().slice(0, 500) : null;
      return [{ type: 'production_recipe_create', name: name.trim(), output_product_id: outputProductId, output_product_name: outputProductName.trim(), output_qty: outputQty, items, note: note || null }];
    }
    if (action.type === 'production_batch_complete') {
      const recipeId = action.recipe_id;
      const recipeName = action.recipe_name;
      const batchCount = Number(action.batch_count);
      const laborCost = action.labor_cost === undefined ? 0 : Number(action.labor_cost);
      const overheadCost = action.overhead_cost === undefined ? 0 : Number(action.overhead_cost);
      if (!validUuid(recipeId) || !validText(recipeName, 120) || !Number.isFinite(batchCount) || batchCount <= 0 || batchCount > 10_000 || !validPrice(laborCost, true) || !validPrice(overheadCost, true)) return [];
      const note = typeof action.note === 'string' ? action.note.trim().slice(0, 500) : null;
      return [{ type: 'production_batch_complete', recipe_id: recipeId, recipe_name: recipeName.trim(), batch_count: batchCount, labor_cost: laborCost, overhead_cost: overheadCost, note: note || null }];
    }
    if (action.type === 'accounting_entry') {
      const allowedKinds = new Set(['capital', 'draw', 'supplier_payment', 'labor_payment', 'overhead_payment']);
      const kind = action.kind;
      const amount = Number(action.amount);
      const description = action.description;
      if (typeof kind !== 'string' || !allowedKinds.has(kind) || !validPrice(amount) || !validText(description, 250)) return [];
      const paymentAccount = action.payment_account === '1010' ? '1010' : action.payment_account === '1000' || action.payment_account === undefined ? '1000' : null;
      if (!paymentAccount) return [];
      return [{ type: 'accounting_entry', kind: kind as 'capital' | 'draw' | 'supplier_payment' | 'labor_payment' | 'overhead_payment', amount, description: description.trim(), payment_account: paymentAccount }];
    }
    if (action.type === 'profile_update') {
      if (!action.changes || typeof action.changes !== 'object' || Array.isArray(action.changes)) return [];
      const raw = action.changes as Record<string, unknown>;
      const changes: ProfileUpdateAction['changes'] = {};
      if (raw.nama_usaha !== undefined && validText(raw.nama_usaha, 100) && raw.nama_usaha.trim().length >= 2) changes.nama_usaha = raw.nama_usaha.trim();
      if (raw.tanggal_mulai_usaha !== undefined && typeof raw.tanggal_mulai_usaha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.tanggal_mulai_usaha)) {
        const parsedDate = new Date(`${raw.tanggal_mulai_usaha}T00:00:00Z`);
        if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === raw.tanggal_mulai_usaha) {
          changes.tanggal_mulai_usaha = raw.tanggal_mulai_usaha;
        } else return [];
      }
      if (raw.hari_buka_per_bulan !== undefined && Number.isInteger(raw.hari_buka_per_bulan) && Number(raw.hari_buka_per_bulan) >= 1 && Number(raw.hari_buka_per_bulan) <= 31) changes.hari_buka_per_bulan = Number(raw.hari_buka_per_bulan);
      if (raw.kebutuhan_modal !== undefined && validPrice(raw.kebutuhan_modal)) changes.kebutuhan_modal = raw.kebutuhan_modal;
      if (raw.jenis_usaha !== undefined && ['retail', 'manufaktur', 'jasa', 'campuran'].includes(String(raw.jenis_usaha))) changes.jenis_usaha = raw.jenis_usaha as ProfileUpdateAction['changes']['jenis_usaha'];
      if (raw.bentuk_usaha !== undefined && ['perorangan', 'pt_perorangan', 'cv', 'pt', 'koperasi', 'lainnya'].includes(String(raw.bentuk_usaha))) changes.bentuk_usaha = raw.bentuk_usaha as ProfileUpdateAction['changes']['bentuk_usaha'];
      if (raw.bidang_usaha !== undefined && validText(raw.bidang_usaha, 120)) changes.bidang_usaha = raw.bidang_usaha.trim();
      if (typeof raw.memiliki_persediaan === 'boolean') changes.memiliki_persediaan = raw.memiliki_persediaan;
      if (raw.metode_pembayaran === 'gopay_macrodroid' || raw.metode_pembayaran === 'manual') changes.metode_pembayaran = raw.metode_pembayaran;
      if (!Object.keys(changes).length) return [];
      return [{ type: 'profile_update', changes }];
    }
    return [];
  });

  // Jangan biarkan AI mengaku sudah mencatat bila tidak ada aksi valid yang bisa dijalankan.
  const NOT_SAVED_REPLY = 'Belum ada yang tersimpan. Sebutkan jenis, keterangan, dan nominalnya dengan jelas, lalu coba lagi.';
  const claimsDone = /\bsaya\s+(sudah\s+)?(catat|simpan|hapus|batalkan|tambah|ubah)|\b(berhasil|sudah)\s+(saya\s+)?(di)?(catat|simpan|hapus|batalkan)/i.test(reply);
  if ((rawActions.length > 0 && actions.length === 0) || (rawActions.length === 0 && claimsDone)) {
    if (rawActions.length > 0) console.warn('[CAVA AI] semua aksi dibuang karena tidak valid:', JSON.stringify(rawActions).slice(0, 300));
    reply = NOT_SAVED_REPLY;
  }

  // Keep each voice turn atomic: transactions may be batched together, but other
  // action categories must never be mixed or silently prioritized on the client.
  const categoryOf = (action: AssistantAction): string => {
    if (action.type === 'transaction') return 'transactions';
    if (action.type === 'navigate') return 'navigation';
    if (action.type === 'open_manual_record') return 'manual_record';
    return 'app_mutation';
  };
  const categories = new Set(actions.map(categoryOf));
  const appMutations = actions.filter((action) => categoryOf(action) === 'app_mutation');
  const actionCountInvalid =
    (categories.has('transactions') && actions.filter((action) => action.type === 'transaction').length > 5) ||
    (categories.has('navigation') && actions.length !== 1) ||
    (categories.has('manual_record') && actions.length !== 1) ||
    appMutations.length > 1;
  if (categories.size > 1 || actionCountInvalid) {
    actions.length = 0;
    reply = 'Saya bisa menjalankan satu jenis tindakan dalam satu waktu. Sebutkan tindakan yang ingin didahulukan.';
  }

  return {
    result: { reply: reply || 'Saya belum bisa menyusun jawaban. Coba jelaskan sedikit lebih spesifik.', actions },
    provider,
  };
}

async function groqTranscribe(audio: File, timeoutMs: number): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new ProviderError('GROQ_API_KEY belum diatur.');
  const form = new FormData();
  form.append('file', audio, audio.name || 'cava-voice.webm');
  form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'id');
  form.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new ProviderError(`Transkripsi Groq gagal (HTTP ${response.status}).`, response.status);
  const data = await response.json();
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('Suara belum berhasil dikenali. Coba bicara sedikit lebih jelas.');
  return text;
}

async function geminiTranscribe(audio: File, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('GEMINI_API_KEY belum diatur.');
  const model = process.env.GEMINI_TRANSCRIPTION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const bytes = Buffer.from(await audio.arrayBuffer());
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'Transkripsikan audio ini secara akurat dalam bahasa Indonesia. Pertahankan angka, nominal rupiah, nama produk, dan maksud pembicara. Balas hanya teks transkripsinya, tanpa penjelasan tambahan.' },
        { inlineData: { mimeType: audio.type || 'audio/webm', data: bytes.toString('base64') } },
      ] }],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new ProviderError(`Transkripsi Gemini gagal (HTTP ${response.status}).`, response.status);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('').trim();
  if (typeof text !== 'string' || !text) throw new Error('Gemini belum bisa mengenali audio.');
  return text;
}

export async function transcribeWithFallback(audio: File): Promise<{ transcript: string; provider: ProviderName }> {
  let groqError: unknown;
  const deadline = Date.now() + TRANSCRIBE_BUDGET_MS;
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  if (process.env.GROQ_API_KEY) {
    try {
      const groqMs = hasGemini ? GROQ_TRANSCRIBE_MS : TRANSCRIBE_BUDGET_MS;
      return { transcript: await timed('transkripsi groq', () => groqTranscribe(audio, groqMs)), provider: 'groq' };
    } catch (error) {
      groqError = error;
      if (!canFallback(error)) throw error;
    }
  }
  if (hasGemini) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_FALLBACK_MS) throw new ProviderError(TIMEOUT_MESSAGE, 408);
    return { transcript: await timed('transkripsi gemini', () => geminiTranscribe(audio, remaining)), provider: 'gemini' };
  }
  throw groqError instanceof Error ? groqError : new Error('Atur GROQ_API_KEY atau GEMINI_API_KEY untuk mengaktifkan transkripsi.');
}
