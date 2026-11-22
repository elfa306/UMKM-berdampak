'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, LoaderCircle, Volume2, VolumeX, X } from 'lucide-react';
import { CavaVMark } from './CavaLogo';
import { supabase } from '@/lib/supabase';
import { announceTransactionSaved, ensureTodaySession, type QuickSavedRow } from '@/lib/quickSession';
import { todayISO, rupiah } from '@/lib/accounting';
import { recordProactiveDismissed, useCashieProactive, type ProactiveAction, type ProactiveMessage } from '@/lib/cashieProactive';
import { jawabanKategori, kolomKategoriBelumAda, tandaiBiaya } from '@/lib/biayaBahan';
import { matchLocalExport } from '@/lib/cashieIntents';
import { captureUserPlan, currentMemoryUserId, planAcknowledgement, planReply, setPlanStatus } from '@/lib/cashieMemory';
import { formatJam, parseOperatingHours, saveOperatingHours, type JamOperasional } from '@/lib/jamOperasional';

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'thinking';
type Message = { id: string; role: 'user' | 'assistant'; content: string; provider?: 'groq' | 'gemini' | 'openrouter' };
type PendingTransaction = {
  type: 'transaction';
  jenis: 'penjualan' | 'biaya';
  keterangan: string;
  jumlah: number;
  qty: number;
  metode: 'tunai' | 'qris' | null;
};
type PendingTransactionDelete = { type: 'transaction_delete'; transaction_id: string; description: string; amount: number; date: string; jenis: 'penjualan' | 'biaya' };
type PendingOpeningBalanceSetup = { type: 'opening_balance_setup'; cash_amount: number; bank_amount: number };
type PendingStartDailySession = { type: 'start_daily_session'; date: string; modal_harian: number };
type PendingDailyModalSet = { type: 'daily_modal_set'; amount: number; date: string };
type PendingProductCreate = { type: 'product_create'; nama: string; sku: string | null; kategori: string; jenis_item: 'merchandise' | 'raw_material' | 'work_in_progress' | 'finished_good' | 'service'; satuan: string; harga: number; harga_pokok: number };
type PendingProductUpdate = { type: 'product_update'; product_id: string; product_name: string; changes: Partial<{ nama: string; sku: string | null; kategori: string; jenis_item: 'merchandise' | 'finished_good' | 'service'; satuan: string; harga: number; harga_pokok: number }> };
type PendingProductDelete = { type: 'product_delete'; product_id: string; product_name: string };
type PendingProductionRecipeCreate = { type: 'production_recipe_create'; name: string; output_product_id: string; output_product_name: string; output_qty: number; items: Array<{ product_id: string; product_name: string; qty: number }>; note: string | null };
type PendingProductionBatchComplete = { type: 'production_batch_complete'; recipe_id: string; recipe_name: string; batch_count: number; labor_cost: number; overhead_cost: number; note: string | null };
type PendingProfileUpdate = { type: 'profile_update'; changes: Partial<{ nama_usaha: string; tanggal_mulai_usaha: string; hari_buka_per_bulan: number; kebutuhan_modal: number; jenis_usaha: 'retail' | 'manufaktur' | 'jasa' | 'campuran'; bentuk_usaha: 'perorangan' | 'pt_perorangan' | 'cv' | 'pt' | 'koperasi' | 'lainnya'; bidang_usaha: string; memiliki_persediaan: boolean; metode_pembayaran: 'gopay_macrodroid' | 'manual' }> };
type PendingAccountingEntry = { type: 'accounting_entry'; kind: 'capital' | 'draw' | 'supplier_payment' | 'labor_payment' | 'overhead_payment'; amount: number; description: string; payment_account: '1000' | '1010' };
type PendingAction = PendingTransaction | PendingTransactionDelete | PendingOpeningBalanceSetup | PendingStartDailySession | PendingDailyModalSet | PendingProductCreate | PendingProductUpdate | PendingProductDelete | PendingProductionRecipeCreate | PendingProductionBatchComplete | PendingProfileUpdate | PendingAccountingEntry;
type ResponseKind = 'answer' | 'confirm' | 'success' | 'error';
type ResponseCard = { id: string; text: string; kind: ResponseKind };
type SpeechAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};
type SpeechCue = { display: string; start: number; end: number };
type CachedSpeech = { buffer: AudioBuffer; cues: SpeechCue[] };
type SpeechProgress = { text: string; visibleCount: number; activeIndex: number };
type CardActions = { id: string; actions: ProactiveAction[] };
type HoursProposal = { buka: string; tutup: string };
type HoursAwait = { until: number; partial: JamOperasional };
type PlanAwait = { until: number; planId: string };
type ClassifyAwait = { until: number; transactionId: string };
type Props = { variant?: 'mobile' | 'desktop' | 'global'; controlsVisible?: boolean; onManualRecord: (mode?: 'masuk' | 'keluar' | 'modal') => void };

const MAX_RECORDING_MS = 35_000;
const HOURS_AWAIT_MS = 15 * 60_000;
const PROACTIVE_CARD_MS = 22_000;
const CARD_ACTION_LABEL: Record<ProactiveAction, string> = {
  record_sale: 'Catat penjualan',
  record_expense: 'Catat pengeluaran',
  open_report: 'Lihat laporan',
  open_settings: 'Buka Pengaturan Usaha',
};
const TRANSACTION_WORDS = /\b(catat|beli|membeli|belanja|jual|terjual|bayar|rupiah|ribu|juta|rp)\b/;
const WAVEFORM_BAR_COUNT = 32;
const EMPTY_WAVEFORM = Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.06);

function audioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((mime) => MediaRecorder.isTypeSupported(mime));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses suara.';
  if (/permission|denied|notallowed/i.test(message)) return 'Izin mikrofon belum diberikan. Aktifkan izin mikrofon di browser.';
  if (/secure context|getusermedia|media devices/i.test(message)) return 'Mikrofon hanya bisa dipakai melalui localhost atau HTTPS.';
  if (/aborted due to timeout|timeouterror|signal timed out/i.test(message)) return 'Layanan AI sedang lambat. Coba tahan tombol V dan ucapkan lagi.';
  return message;
}

const NAV_ROUTES: Array<{ path: string; label: string; pattern: RegExp }> = [
  { path: '/kasir', label: 'Beranda', pattern: /\b(beranda|kasir)\b/ },
  { path: '/laporan', label: 'Riwayat dan Laporan', pattern: /\blaporan\b/ },
  { path: '/pembiayaan', label: 'Rekomendasi Pembiayaan', pattern: /\bpembiayaan\b/ },
  { path: '/inventaris', label: 'Katalog Produk', pattern: /\b(katalog|inventaris)\b/ },
  { path: '/harga', label: 'Cek Harga Bahan', pattern: /\bharga bahan\b|\bcek harga\b/ },
  { path: '/lainnya', label: 'Pengaturan dan Akun', pattern: /\bpengaturan dan akun\b/ },
  { path: '/pengaturan-usaha', label: 'Profil Usaha', pattern: /\b(profil usaha|pengaturan usaha)\b/ },
  { path: '/integrasi', label: 'Integrasi', pattern: /\bintegrasi\b/ },
  { path: '/riwayat', label: 'Riwayat', pattern: /\briwayat\b(?! dan laporan)/ },
  { path: '/statistik', label: 'Statistik', pattern: /\bstatistik\b/ },
  { path: '/kredit', label: 'Kredit', pattern: /\bkredit\b/ },
  { path: '/rekomendasi', label: 'Rekomendasi', pattern: /\brekomendasi\b(?! pembiayaan)/ },
];

// Jalan pintas tanpa LLM: hanya dipakai bila kalimat pendek, ada kata kerja buka/lihat,
// dan tepat satu halaman cocok. Selain itu perintah diteruskan ke LLM seperti biasa.
function matchLocalNavigation(raw: string): { path: string; label: string } | null {
  const text = raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!text || text.split(' ').length > 8) return null;
  if (!/\b(buka|bukakan|bukain|lihat|lihatkan|tampilkan|tunjukkan|tunjukin|menuju|pergi ke|ke halaman)\b/.test(text)) return null;
  if (/\b(demo|catat|ubah|hapus|tambah|batal|simpan|bayar|unduh|ekspor|export|download|excel|bulan|form|manual|dan|lalu|terus|kemudian)\b|\d/.test(text.replace('pengaturan dan akun', 'pengaturan_akun').replace('riwayat dan laporan', 'riwayat_laporan'))) return null;
  const matches = NAV_ROUTES.filter((route) => route.pattern.test(text));
  return matches.length === 1 ? { path: matches[0].path, label: matches[0].label } : null;
}


function confirmationChoice(raw: string): 'yes' | 'no' | 'unclear' {
  const normalized = raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'unclear';

  const words = normalized.split(' ');
  if (words.some((word) => ['batal', 'batalkan', 'no'].includes(word))) return 'no';
  // Frasa koreksi adalah revisi proposal, bukan jawaban ya/tidak.
  if (/\b(bukan|maksud saya|maksudnya|yang benar|seharusnya|ralat|koreksi|ganti jadi|ubah jadi)\b/.test(normalized)) return 'unclear';
  const negativeWords = new Set(['tidak', 'enggak', 'nggak', 'ngga', 'gak', 'ga', 'ndak', 'jangan', 'belum', 'nanti', 'engga']);
  if (words.some((word) => negativeWords.has(word))) return 'no';

  // Terima frasa alami setelah persetujuan: "ya tambahkan", "iya boleh", "oke langsung catat".
  const affirmativeLead = new Set([
    'ya', 'yaa', 'iya', 'iyaa', 'iyah', 'yoi', 'oke', 'ok', 'setuju', 'boleh',
    'siap', 'baik', 'tolong', 'lanjut', 'lanjutkan', 'silakan', 'benar', 'betul',
    'tentu', 'gas', 'sip', 'yes', 'catat', 'simpan', 'tambahkan', 'tambah',
    'tambahin', 'proses', 'jalankan', 'lakukan', 'langsung', 'jadi',
  ]);
  if (affirmativeLead.has(words[0]) && words.length <= 16) return 'yes';
  return 'unclear';
}

function transactionConfirmation(items: PendingTransaction[]): string {
  const total = items.reduce((sum, item) => sum + item.jumlah, 0);
  const sameKind = items.every((item) => item.jenis === items[0]?.jenis);
  const kindLabel = items[0]?.jenis === 'biaya' ? 'pengeluaran' : 'penjualan';
  const details = items.map((item) => {
    const quantity = item.qty > 1 ? `${item.qty} unit ` : '';
    const method = item.metode ? ` (${item.metode === 'qris' ? 'QRIS' : 'tunai'})` : '';
    return `${quantity}${item.keterangan} ${rupiah(item.jumlah)}${method}`;
  });
  const joined = details.length < 2 ? details[0] : `${details.slice(0, -1).join(', ')} dan ${details[details.length - 1]}`;
  if (sameKind && items.length === 1) return `Baik, saya catat ${kindLabel} ${joined}. Langsung saya catat?`;
  if (sameKind) return `Baik, saya catat ${kindLabel}: ${joined}, total ${rupiah(total)}. Langsung saya catat?`;
  return `Baik, saya siapkan ${joined}, total ${rupiah(total)}. Langsung saya catat?`;
}


function actionConfirmation(actions: PendingAction[]): string {
  if (actions.every((action) => action.type === 'transaction')) {
    return transactionConfirmation(actions as PendingTransaction[]);
  }
  const action = actions[0];
  if (!action) return 'Saya belum punya tindakan untuk dikonfirmasi.';
  if (action.type === 'transaction') return transactionConfirmation([action]);
  if (action.type === 'transaction_delete') return `Saya akan membatalkan transaksi ${action.jenis === 'biaya' ? 'pengeluaran' : 'penjualan'} ${action.description} sebesar ${rupiah(action.amount)} tanggal ${action.date}. Jika transaksi berasal dari kasir, pembatalan juga menyesuaikan stok atau pembayaran terkait. Apakah saya lanjutkan?`;
  if (action.type === 'opening_balance_setup') return `Saya akan menetapkan saldo awal satu kali: kas ${rupiah(action.cash_amount)} dan bank/QRIS ${rupiah(action.bank_amount)}. Setelah disimpan, saldo awal tidak dapat diatur ulang melalui Cashie. Boleh saya simpan?`;
  if (action.type === 'daily_modal_set') return `Saya akan menyimpan modal harian ${rupiah(action.amount)} untuk ${action.date}. Ini hanya alokasi harian dan tidak menambah saldo kas atau bank. Boleh saya simpan?`;
  if (action.type === 'start_daily_session') return `Saya akan membuka aktivitas harian tanggal ${action.date} dengan modal harian ${rupiah(action.modal_harian)}. Boleh saya mulai?`;
  if (action.type === 'product_create') {
    const kind = action.jenis_item === 'raw_material' ? 'bahan baku' : action.jenis_item === 'work_in_progress' ? 'barang dalam proses' : action.jenis_item === 'service' ? 'jasa' : action.jenis_item === 'finished_good' ? 'produk sendiri' : 'barang dagangan';
    const stockNote = action.jenis_item === 'raw_material' || action.jenis_item === 'work_in_progress' ? ' Pelacakan stok akan diaktifkan.' : '';
    const priceNote = action.jenis_item === 'raw_material' || action.jenis_item === 'work_in_progress' ? ` Harga pokok ${rupiah(action.harga_pokok)}.` : ` Harga jual ${rupiah(action.harga)}, harga pokok ${rupiah(action.harga_pokok)}.`;
    return `Saya akan menambahkan ${action.nama} sebagai ${kind}.${priceNote}${stockNote} Langsung saya tambahkan?`;
  }
  if (action.type === 'product_update') {
    const pieces: string[] = [];
    if (action.changes.nama) pieces.push(`nama menjadi ${action.changes.nama}`);
    if (action.changes.harga !== undefined) pieces.push(`harga jual ${rupiah(action.changes.harga)}`);
    if (action.changes.harga_pokok !== undefined) pieces.push(`harga pokok ${rupiah(action.changes.harga_pokok)}`);
    if (action.changes.kategori) pieces.push(`kategori ${action.changes.kategori}`);
    if (action.changes.satuan) pieces.push(`satuan ${action.changes.satuan}`);
    if (action.changes.jenis_item) pieces.push(`jenis ${action.changes.jenis_item}`);
    if (action.changes.sku !== undefined) pieces.push(`SKU ${action.changes.sku || 'dikosongkan'}`);
    return `Saya akan mengubah ${action.product_name}: ${pieces.join(', ')}. Boleh saya lanjutkan?`;
  }
  if (action.type === 'production_recipe_create') {
    const ingredients = action.items.map((item) => `${item.product_name} ${item.qty}`).join(', ');
    return `Saya akan membuat resep ${action.name}, menghasilkan ${action.output_qty} ${action.output_product_name}, dengan bahan ${ingredients}. Boleh saya simpan resepnya?`;
  }
  if (action.type === 'production_batch_complete') {
    return `Saya akan menyelesaikan ${action.batch_count} batch resep ${action.recipe_name}. Stok bahan baku akan berkurang dan stok produk jadi bertambah. Biaya tenaga kerja ${rupiah(action.labor_cost)} dan overhead ${rupiah(action.overhead_cost)}. Langsung proses?`;
  }
  if (action.type === 'profile_update') {
    const labels: Record<string, string> = { nama_usaha: 'nama usaha', tanggal_mulai_usaha: 'tanggal mulai usaha', hari_buka_per_bulan: 'hari buka per bulan', kebutuhan_modal: 'kebutuhan modal', jenis_usaha: 'jenis usaha', bentuk_usaha: 'bentuk usaha', bidang_usaha: 'bidang usaha', memiliki_persediaan: 'kepemilikan persediaan', metode_pembayaran: 'metode pembayaran' };
    const values = Object.entries(action.changes).map(([key, value]) => `${labels[key] ?? key} menjadi ${key === 'kebutuhan_modal' ? rupiah(Number(value)) : key === 'memiliki_persediaan' ? (value ? 'ya' : 'tidak') : String(value)}`);
    return `Saya akan memperbarui profil usaha: ${values.join(', ')}. Boleh saya simpan?`;
  }
  if (action.type === 'accounting_entry') {
    const labels: Record<PendingAccountingEntry['kind'], string> = { capital: 'setoran modal', draw: 'pengambilan pribadi', supplier_payment: 'pembayaran pemasok', labor_payment: 'pembayaran tenaga kerja', overhead_payment: 'pembayaran overhead' };
    const account = action.payment_account === '1010' ? 'rekening bank' : 'kas tunai';
    return `Saya akan mencatat ${labels[action.kind]} ${action.description} sebesar ${rupiah(action.amount)} dari ${account}. Langsung saya catat?`;
  }
  return `Saya akan menonaktifkan ${action.product_name} dari katalog aktif. Riwayat transaksi lama tetap tersimpan. Lanjutkan?`;
}

function speechFriendlyText(text: string): string {
  return text.replace(/Rp\s?([\d]+(?:\.[\d]{3})*)([,.!?;:]?)/giu, (_match, digits: string, punctuation: string) => `${digits.replace(/\./g, '')} rupiah${punctuation}`);
}

/** Keep visible words intact while matching currency phrases to their spoken form. */
function speechDisplayChunks(text: string): Array<{ display: string; spoken: string }> {
  const chunks: Array<{ display: string; spoken: string }> = [];
  const pushPlainWords = (value: string) => {
    for (const word of value.match(/\S+/gu) ?? []) chunks.push({ display: word, spoken: word });
  };
  const currencyPattern = /Rp\s?([\d]+(?:\.[\d]{3})*)([,.!?;:]?)/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = currencyPattern.exec(text)) !== null) {
    pushPlainWords(text.slice(cursor, match.index));
    const digits = match[1].replace(/\./gu, '');
    const punctuation = match[2] || '';
    chunks.push({ display: match[0], spoken: digits ? `${digits} rupiah${punctuation}` : match[0] });
    cursor = match.index + match[0].length;
  }
  pushPlainWords(text.slice(cursor));
  return chunks;
}

function buildSpeechCues(text: string, alignment: SpeechAlignment | null | undefined, duration: number): SpeechCue[] {
  const chunks = speechDisplayChunks(text);
  if (!chunks.length) return [];

  const characters = Array.isArray(alignment?.characters) ? alignment.characters : [];
  const starts = Array.isArray(alignment?.character_start_times_seconds) ? alignment.character_start_times_seconds : [];
  const ends = Array.isArray(alignment?.character_end_times_seconds) ? alignment.character_end_times_seconds : [];
  const alignedText = characters.join('');
  const cues: SpeechCue[] = [];
  let searchFrom = 0;
  let allMatched = characters.length > 0 && starts.length === characters.length && ends.length === characters.length;

  if (allMatched) {
    for (const chunk of chunks) {
      const index = alignedText.indexOf(chunk.spoken, searchFrom);
      if (index < 0) {
        allMatched = false;
        break;
      }
      const lastIndex = index + chunk.spoken.length - 1;
      const start = starts[index];
      const end = ends[lastIndex];
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        allMatched = false;
        break;
      }
      cues.push({ display: chunk.display, start, end });
      searchFrom = lastIndex + 1;
    }
  }

  if (allMatched && cues.length === chunks.length) return cues;

  // Fallback for text normalization differences: reveal each word proportionally to audio duration.
  const safeDuration = Math.max(0.25, duration || 0.25);
  const weights = chunks.map((chunk) => Math.max(2, chunk.spoken.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;
  return chunks.map((chunk, index) => {
    const start = safeDuration * consumed / totalWeight;
    consumed += weights[index];
    const end = safeDuration * consumed / totalWeight;
    return { display: chunk.display, start, end };
  });
}

function decodeBase64Audio(encoded: string): ArrayBuffer {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** Mengalirkan kata demi kata saat tidak ada suara (suara dimatikan atau diblokir browser). */
function useWordTypewriter(text: string, active: boolean, wordsPerSecond = 3.6) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const total = speechDisplayChunks(text).length;
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current + 1 >= total) window.clearInterval(timer);
        return Math.min(total, current + 1);
      });
    }, Math.round(1000 / wordsPerSecond));
    return () => window.clearInterval(timer);
  }, [text, active, wordsPerSecond]);
  return count;
}

type CashieMood = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Maskot Cashie dengan gerak berbeda tiap keadaan: mendengarkan, berpikir, berbicara. */
function CashieMascotFigure({ mood, priority }: { mood: CashieMood; priority: boolean }) {
  const reduce = useReducedMotion();
  const loop = (duration: number) => ({ duration, repeat: Infinity, ease: 'easeInOut' as const });
  const animate = reduce || mood === 'idle'
    ? { y: 0, rotate: 0, scale: 1 }
    : mood === 'listening'
      ? { y: [0, -2, 0], rotate: [0, -3, 0], scale: [1, 1.04, 1] }
      : mood === 'thinking'
        ? { y: 0, rotate: [-5, 5, -5], scale: 1 }
        : { y: [0, -5, 0, -3, 0], rotate: 0, scale: [1, 1.03, 1, 1.02, 1] };
  const transition = reduce || mood === 'idle' ? { duration: 0.25 } : loop(mood === 'listening' ? 1.4 : mood === 'thinking' ? 1.9 : 0.9);
  return (
    <motion.div
      className="relative mb-0 h-[96px] w-[72px] shrink-0 drop-shadow-[0_8px_12px_rgba(16,58,87,0.16)]"
      style={{ transformOrigin: '50% 100%' }}
      animate={animate}
      transition={transition}
      aria-hidden="true"
    >
      {mood === 'listening' && !reduce && (
        <motion.span className="absolute inset-x-2 bottom-0 top-3 rounded-full border-2 border-[#4FA37A]/60" animate={{ opacity: [0.7, 0], scale: [0.9, 1.25] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}/>
      )}
      {mood === 'thinking' && (
        <span className="absolute -top-1 right-0 flex gap-[3px] rounded-full bg-white px-1.5 py-1 shadow">
          {[0, 1, 2].map((dot) => (
            <motion.span key={dot} className="h-1.5 w-1.5 rounded-full bg-[#103A57]" animate={reduce ? { opacity: 0.8 } : { opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.18 }}/>
          ))}
        </span>
      )}
      <Image src="/cashie-mascot.webp" alt="" fill sizes="72px" className="object-contain object-bottom" priority={priority}/>
    </motion.div>
  );
}

export default function CavaVoiceAssistant({ variant = 'mobile', controlsVisible = true, onManualRecord }: Props) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [busySending, setBusySending] = useState(false);
  const [busySaving, setBusySaving] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  // Teks jawaban ditahan sampai suara mulai (holdId); bila suara tidak ada, teks mengalir sendiri (typeId).
  const [holdId, setHoldId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [response, setResponse] = useState<ResponseCard | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [loadingSpeech, setLoadingSpeech] = useState(false);
  const [speechProgress, setSpeechProgress] = useState<SpeechProgress | null>(null);
  const [micLevels, setMicLevels] = useState<number[]>(EMPTY_WAVEFORM);
  const [userSaid, setUserSaid] = useState<string | null>(null);
  const [cardActions, setCardActions] = useState<CardActions | null>(null);
  const [hoursProposal, setHoursProposal] = useState<HoursProposal | null>(null);

  const phaseRef = useRef<Phase>('idle');
  const hoursProposalRef = useRef<HoursProposal | null>(null);
  const hoursAwaitRef = useRef<HoursAwait | null>(null);
  const proactiveIdRef = useRef<string | null>(null);
  const planAwaitRef = useRef<PlanAwait | null>(null);
  const classifyAwaitRef = useRef<ClassifyAwait | null>(null);
  const historyRef = useRef<Message[]>([]);
  const pendingRef = useRef<PendingAction[]>([]);
  const pendingTokenRef = useRef<string | null>(null);
  const voiceEnabledRef = useRef(true);
  const lastSpokenTextRef = useRef<string | null>(null);
  const pendingGreetingCleanupRef = useRef<(() => void) | null>(null);
  const busySendingRef = useRef(false);
  const savingRef = useRef(false);
  const pressedRef = useRef(false);
  const cancelledRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseRef = useRef<ResponseCard | null>(null);
  const stickyResponseRef = useRef(false);
  const activeSpeechTextRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCacheRef = useRef<Map<string, CachedSpeech>>(new Map());
  const speechFrameRef = useRef<number | null>(null);
  const speechRequestRef = useRef(0);
  const activeTurnRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceGestureStartedRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const keyboardPressRef = useRef(false);
  const tapClickPendingRef = useRef(false);
  const ignoreNextClickRef = useRef(false);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const waveformLastPaintRef = useRef(0);
  const waveformLevelsRef = useRef<number[]>(EMPTY_WAVEFORM);

  const setPendingItems = useCallback((items: PendingAction[], actionToken: string | null = null) => {
    pendingRef.current = items;
    pendingTokenRef.current = actionToken;
    setPending(items);
  }, []);

  const setHoursProposalState = useCallback((value: HoursProposal | null) => {
    hoursProposalRef.current = value;
    setHoursProposal(value);
  }, []);

  const scheduleResponseDismiss = useCallback((card: ResponseCard, delay: number) => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
    responseTimerRef.current = setTimeout(() => {
      if (responseRef.current?.id !== card.id) return;
      if (activeSpeechTextRef.current === card.text || stickyResponseRef.current) return;
      responseRef.current = null;
      setResponse(null);
      setUserSaid(null);
    }, delay);
  }, []);

  const clearResponse = useCallback(() => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    responseRef.current = null;
    stickyResponseRef.current = false;
    setResponse(null);
  }, []);

  const showResponse = useCallback((text: string, kind: ResponseKind, sticky = false, delay = 11_000) => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
    const next: ResponseCard = { id: crypto.randomUUID(), text, kind };
    responseRef.current = next;
    stickyResponseRef.current = sticky;
    lastSpokenTextRef.current = null;
    setHoldId(null);
    setTypeId(null);
    if (kind !== 'error') {
      if (voiceEnabledRef.current) {
        // Teks belum ditampilkan: tunggu suara mulai agar teks mengalir bersama suara.
        setHoldId(next.id);
        window.setTimeout(() => {
          setHoldId((current) => (current === next.id ? null : current));
          if (responseRef.current?.id === next.id && lastSpokenTextRef.current !== text) setTypeId(next.id);
        }, 900);
      } else {
        setTypeId(next.id);
      }
    }
    setResponse(next);
    if (!sticky) scheduleResponseDismiss(next, delay);
  }, [scheduleResponseDismiss]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopMicVisualizer = useCallback(() => {
    if (waveformFrameRef.current !== null) cancelAnimationFrame(waveformFrameRef.current);
    waveformFrameRef.current = null;
    waveformLastPaintRef.current = 0;
    try { micSourceRef.current?.disconnect(); } catch { /* node sudah terputus */ }
    try { micAnalyserRef.current?.disconnect(); } catch { /* node sudah terputus */ }
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    waveformLevelsRef.current = EMPTY_WAVEFORM;
    setMicLevels(EMPTY_WAVEFORM);
  }, []);

  const startMicVisualizer = useCallback((stream: MediaStream) => {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    try {
      const context = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);

      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      micAnalyserRef.current = analyser;
      micSourceRef.current = source;
      const samples = new Uint8Array(analyser.fftSize);
      const groupSize = Math.floor(samples.length / WAVEFORM_BAR_COUNT);
      waveformLastPaintRef.current = 0;

      const draw = (time: number) => {
        if (!micAnalyserRef.current) return;
        if (time - waveformLastPaintRef.current >= 42) {
          analyser.getByteTimeDomainData(samples);
          const previous = waveformLevelsRef.current;
          const next = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
            const start = index * groupSize;
            let energy = 0;
            for (let sampleIndex = start; sampleIndex < start + groupSize; sampleIndex += 1) {
              const centered = (samples[sampleIndex] - 128) / 128;
              energy += centered * centered;
            }
            const rms = Math.sqrt(energy / groupSize);
            const target = Math.max(0.055, Math.min(1, rms * 4.8));
            return previous[index] * 0.38 + target * 0.62;
          });
          waveformLevelsRef.current = next;
          setMicLevels(next);
          waveformLastPaintRef.current = time;
        }
        waveformFrameRef.current = requestAnimationFrame(draw);
      };
      waveformFrameRef.current = requestAnimationFrame(draw);
    } catch (error) {
      // Gagal membuat visualizer tidak boleh menggagalkan perekaman suara.
      console.warn('Cashie microphone visualizer unavailable:', error);
    }
  }, []);

  const stopTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    timerRef.current = null;
    tickRef.current = null;
  }, []);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session?.access_token) throw new Error('Masuk ke akun CAVA terlebih dahulu untuk memakai asisten suara.');
    return data.session.access_token;
  }, []);

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') audioContextRef.current = new window.AudioContext();
      if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume().catch(() => undefined);
    } catch { /* fallback ke suara bawaan perangkat */ }
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    speechRequestRef.current += 1;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if (speechFrameRef.current !== null) cancelAnimationFrame(speechFrameRef.current);
    speechFrameRef.current = null;
    try { audioSourceRef.current?.stop(); } catch { /* audio mungkin sudah selesai */ }
    audioSourceRef.current = null;
    const interruptedText = activeSpeechTextRef.current;
    activeSpeechTextRef.current = null;
    const currentCard = responseRef.current;
    if (interruptedText && currentCard?.text === interruptedText && !stickyResponseRef.current) {
      scheduleResponseDismiss(currentCard, 5_000);
    }
    setSpeaking(false);
    setLoadingSpeech(false);
    setSpeechProgress(null);
  }, [scheduleResponseDismiss]);

  const speakText = useCallback(async (id: string, text: string) => {
    if (!text.trim() || !voiceEnabledRef.current) return;
    unlockAudio();
    stopCurrentSpeech();
    activeSpeechTextRef.current = text;
    lastSpokenTextRef.current = text;
    const requestId = speechRequestRef.current;
    const controller = new AbortController();
    speechAbortRef.current = controller;
    setSpeechProgress({ text, visibleCount: 0, activeIndex: -1 });
    setLoadingSpeech(true);

    const playClip = async (clip: CachedSpeech, context: AudioContext) => {
      if (context.state === 'suspended') {
        // Browser dapat memblokir suara sebelum ada sentuhan; jangan menggantung selamanya.
        await Promise.race([context.resume().catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 1200))]);
      }
      if (speechRequestRef.current !== requestId) return;
      if (context.state !== 'running') throw new Error('Pemutar suara belum diizinkan browser.');
      const source = context.createBufferSource();
      source.buffer = clip.buffer;
      source.connect(context.destination);
      const startedAt = context.currentTime;
      audioSourceRef.current = source;
      setLoadingSpeech(false);
      setSpeaking(true);

      source.onended = () => {
        if (audioSourceRef.current !== source) return;
        audioSourceRef.current = null;
        if (speechFrameRef.current !== null) cancelAnimationFrame(speechFrameRef.current);
        speechFrameRef.current = null;
        setSpeaking(false);
        setSpeechProgress({ text, visibleCount: clip.cues.length, activeIndex: -1 });
        if (activeSpeechTextRef.current === text) activeSpeechTextRef.current = null;
        const finishedCard = responseRef.current;
        if (finishedCard?.text === text && !stickyResponseRef.current) {
          scheduleResponseDismiss(finishedCard, 5_000);
        }
      };

      const updateProgress = () => {
        if (audioSourceRef.current !== source) return;
        const elapsed = Math.max(0, context.currentTime - startedAt);
        let visibleCount = 0;
        let activeIndex = -1;
        for (let index = 0; index < clip.cues.length; index += 1) {
          const cue = clip.cues[index];
          if (elapsed >= cue.start) visibleCount = index + 1;
          if (elapsed >= cue.start && elapsed < cue.end + 0.06) activeIndex = index;
        }
        setSpeechProgress((current) => {
          if (current?.text === text && current.visibleCount === visibleCount && current.activeIndex === activeIndex) return current;
          return { text, visibleCount, activeIndex };
        });
        if (elapsed < clip.buffer.duration && audioSourceRef.current === source) {
          speechFrameRef.current = requestAnimationFrame(updateProgress);
        }
      };

      source.start(0);
      updateProgress();
    };

    const context = audioContextRef.current;
    const cached = audioCacheRef.current.get(text);
    if (cached && context) {
      try {
        await playClip(cached, context);
        return;
      } catch { /* buat ulang audio di server */ }
    }

    try {
      const token = await getAccessToken();
      if (speechRequestRef.current !== requestId) return;
      const result = await fetch('/api/ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ text: speechFriendlyText(text) }),
        signal: controller.signal,
      });
      const body = await result.json().catch(() => null) as {
        error?: string;
        audio_base64?: string;
        alignment?: SpeechAlignment | null;
      } | null;
      if (speechAbortRef.current === controller) speechAbortRef.current = null;
      if (!result.ok) throw new Error(body?.error || 'Suara CAVA belum dapat dibuat.');
      if (!body?.audio_base64) throw new Error('ElevenLabs tidak mengembalikan audio. Silakan coba putar ulang.');
      if (speechRequestRef.current !== requestId) return;
      const activeContext = audioContextRef.current;
      if (!activeContext) throw new Error('Pemutar suara belum tersedia.');
      const decoded = await activeContext.decodeAudioData(decodeBase64Audio(body.audio_base64));
      const clip: CachedSpeech = {
        buffer: decoded,
        cues: buildSpeechCues(text, body.alignment, decoded.duration),
      };
      if (audioCacheRef.current.size >= 40) {
        const oldest = audioCacheRef.current.keys().next().value;
        if (oldest !== undefined) audioCacheRef.current.delete(oldest);
      }
      audioCacheRef.current.set(text, clip);
      if (speechRequestRef.current !== requestId) return;
      await playClip(clip, activeContext);
    } catch (error) {
      if (speechRequestRef.current !== requestId) return;
      if (speechAbortRef.current === controller) speechAbortRef.current = null;
      setLoadingSpeech(false);
      setSpeaking(false);
      setSpeechProgress(null);
      activeSpeechTextRef.current = null;
      const message = error instanceof Error ? error.message : 'Suara ElevenLabs belum tersedia.';
      const currentCard = responseRef.current;
      if (currentCard?.text === text) {
        // Teks jawaban (mis. konfirmasi transaksi) tetap tampil, mengalir sendiri; suara saja yang gagal.
        setHoldId(null);
        setTypeId(currentCard.id);
        console.warn('[CAVA] Suara tidak tersedia:', message);
        if (!stickyResponseRef.current) scheduleResponseDismiss(currentCard, 8_000);
      } else {
        showResponse(message, 'error', true);
      }
    }
  }, [getAccessToken, scheduleResponseDismiss, showResponse, stopCurrentSpeech, unlockAudio]);

  const saveTransactions = useCallback(async () => {
    const items = pendingRef.current.filter((item): item is PendingTransaction => item.type === 'transaction');
    if (!items.length || savingRef.current) return;
    savingRef.current = true;
    setBusySaving(true);
    showResponse('Baik, saya catat sekarang.', 'success', true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
      const sessionId = await ensureTodaySession(todayISO());
      if (!sessionId) throw new Error('Buka Beranda dan selesaikan saldo awal harian sebelum mencatat transaksi.');

      const payload = items.map((item) => ({
        session_id: sessionId,
        user_id: authData.user.id,
        jenis: item.jenis,
        keterangan: item.keterangan.trim(),
        jumlah: item.jumlah,
        qty: item.qty,
        metode: item.metode,
      }));
      // Biaya bahan dibedakan dari biaya operasional; sebelum migration v21 dijalankan, simpan tanpa kategori.
      let { data, error: insertError } = await supabase.from('transactions').insert(tandaiBiaya(payload)).select('*');
      if (insertError && kolomKategoriBelumAda(insertError.message)) ({ data, error: insertError } = await supabase.from('transactions').insert(payload).select('*'));
      if (insertError || !data) throw new Error(insertError?.message || 'Transaksi belum berhasil disimpan.');

      const rows = (data as QuickSavedRow[]).map((row) => ({ ...row, jumlah: Number(row.jumlah) }));
      announceTransactionSaved({ guest: false, rows });
      const total = rows.reduce((sum, row) => sum + Number(row.jumlah), 0);
      setPendingItems([]);
      const detail = rows.length === 1 ? `${rows[0].keterangan} ${rupiah(total)}` : `${rows.length} transaksi dengan total ${rupiah(total)}`;
      const successText = `Sudah saya catat: ${detail}.`;
      const successMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: successText };
      historyRef.current = [...historyRef.current, successMessage].slice(-12);
      showResponse(successText, 'success');
      if (voiceEnabledRef.current) void speakText(successMessage.id, successText);
    } catch (err) {
      const message = shortError(err);
      showResponse(message, 'error', true);
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), message);
    } finally {
      savingRef.current = false;
      setBusySaving(false);
    }
  }, [setPendingItems, showResponse, speakText]);

  const executePendingAppAction = useCallback(async () => {
    if (savingRef.current) return;
    const actions = pendingRef.current;
    const actionToken = pendingTokenRef.current;
    const hasSupportedAction = actions.length === 1 && ['product_create', 'product_update', 'product_delete', 'production_recipe_create', 'production_batch_complete', 'profile_update', 'accounting_entry', 'transaction_delete', 'opening_balance_setup', 'start_daily_session', 'daily_modal_set'].includes(actions[0]?.type);
    if (!hasSupportedAction || !actionToken) throw new Error('Izin tindakan tidak tersedia atau sudah kedaluwarsa. Ulangi perintahnya.');

    savingRef.current = true;
    setBusySaving(true);
    showResponse('Baik, saya jalankan perubahan yang sudah kamu setujui.', 'success', true);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ actionToken }),
      });
      const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      if (!response.ok) throw new Error(body?.error || 'Perubahan belum berhasil dijalankan.');
      const successText = body?.message || 'Perubahan berhasil dijalankan.';
      setPendingItems([]);
      announceTransactionSaved(); // muat ulang Beranda agar saldo dan ringkasan sinkron
      const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: successText };
      historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
      showResponse(successText, 'success');
      if (voiceEnabledRef.current) void speakText(assistantMessage.id, successText);
    } catch (error) {
      const errorText = shortError(error);
      if (/kedaluwarsa|izin tindakan tidak valid|sudah kedaluwarsa/i.test(errorText)) setPendingItems([]);
      showResponse(errorText, 'error', true);
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), errorText);
    } finally {
      savingRef.current = false;
      setBusySaving(false);
    }
  }, [getAccessToken, setPendingItems, showResponse, speakText]);

  const downloadAccountingReport = useCallback(async (month: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusySaving(true);
    showResponse(`Baik, saya siapkan laporan akuntansi bulan ${month}.`, 'answer', true);
    try {
      const token = await getAccessToken();
      const reportResponse = await fetch(`/api/akuntansi/export?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin', cache: 'no-store',
      });
      if (!reportResponse.ok) {
        const reportError = await reportResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(reportError?.error || 'Laporan akuntansi gagal diunduh.');
      }
      const blob = await reportResponse.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `CAVA-Akuntansi-${month}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      const successText = `Laporan akuntansi ${month} berhasil diunduh.`;
      const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: successText };
      historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
      showResponse(successText, 'success');
      if (voiceEnabledRef.current) void speakText(assistantMessage.id, successText);
    } catch (error) {
      const errorText = shortError(error);
      showResponse(errorText, 'error', true);
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), errorText);
    } finally {
      savingRef.current = false;
      setBusySaving(false);
    }
  }, [getAccessToken, showResponse, speakText]);

  const executePendingActions = useCallback(async () => {
    const items = pendingRef.current;
    if (!items.length) return;
    if (items.every((item) => item.type === 'transaction')) {
      await saveTransactions();
      return;
    }
    await executePendingAppAction();
  }, [executePendingAppAction, saveTransactions]);

  const handleConfirmation = useCallback(async (raw: string) => {
    const items = pendingRef.current;
    if (!items.length) return false;
    const choice = confirmationChoice(raw);
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: raw };
    historyRef.current = [...historyRef.current, userMessage].slice(-12);

    if (choice === 'yes') {
      await executePendingActions();
      return true;
    }
    if (choice === 'no') {
      setPendingItems([]);
      const cancelText = 'Baik, saya batalkan. Tidak ada perubahan yang dilakukan.';
      const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: cancelText };
      historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
      showResponse(cancelText, 'answer');
      if (voiceEnabledRef.current) void speakText(assistantMessage.id, cancelText);
      return true;
    }

    const clarifyText = 'Saya belum menangkap jawabannya. Ucapkan “ya” untuk melanjutkan atau “tidak” untuk membatalkan.';
    showResponse(clarifyText, 'confirm', true);
    if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), clarifyText);
    return true;
  }, [executePendingActions, setPendingItems, showResponse, speakText]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || busySendingRef.current) return;
    const turnId = ++activeTurnRef.current;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    busySendingRef.current = true;
    setBusySending(true);
    setPhase('thinking');
    clearResponse();

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: message };
    const previous = historyRef.current.slice(-4).map(({ role, content }) => ({ role, content }));
    historyRef.current = [...historyRef.current, userMessage].slice(-12);

    try {
      const localRoute = matchLocalNavigation(message);
      if (localRoute) {
        setPendingItems([]);
        router.push(localRoute.path);
        const text = `Baik, saya buka ${localRoute.label}.`;
        const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: text };
        historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
        showResponse(text, 'answer');
        if (voiceEnabledRef.current) void speakText(assistantMessage.id, text);
        return;
      }

      const localExport = matchLocalExport(message, todayISO());
      if (localExport) {
        setPendingItems([]);
        if (localExport.openReport) router.push('/laporan');
        await downloadAccountingReport(localExport.month);
        return;
      }

      const token = await getAccessToken();
      if (turnId !== activeTurnRef.current) return;
      const result = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ message, history: previous }),
        signal: controller.signal,
      });
      if (turnId !== activeTurnRef.current) return;
      const body = await result.json();
      if (turnId !== activeTurnRef.current) return;
      if (!result.ok) throw new Error(body.error || 'CAVA belum dapat menjawab.');

      const provider: Message['provider'] = body.provider === 'openrouter' ? 'openrouter' : body.provider === 'gemini' ? 'gemini' : 'groq';
      const rawActions = Array.isArray(body.actions) ? body.actions as Array<Record<string, unknown>> : [];
      const nonTransactionActions = rawActions.filter((item) => item?.type !== 'transaction');
      const isOpenAndExport = rawActions.length === 2
        && rawActions.some((item) => item?.type === 'navigate' && item.path === '/laporan')
        && rawActions.some((item) => item?.type === 'accounting_report_export');
      if (!isOpenAndExport && (nonTransactionActions.length > 1 || (nonTransactionActions.length === 1 && rawActions.length > 1))) {
        throw new Error('Satu perintah hanya boleh menjalankan satu tindakan. Coba pisahkan permintaannya.');
      }
      if (isOpenAndExport) {
        const exportAction = rawActions.find((item) => item?.type === 'accounting_report_export');
        if (typeof exportAction?.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(exportAction.month)) {
          setPendingItems([]);
          router.push('/laporan');
          await downloadAccountingReport(exportAction.month);
          return;
        }
      }
      const allowedPaths = new Set(['/kasir', '/laporan', '/pembiayaan', '/inventaris', '/harga', '/lainnya', '/pengaturan-usaha', '/integrasi', '/riwayat', '/statistik', '/kredit', '/rekomendasi', '/demo', '/demo/akuntansi', '/demo/analisis', '/demo/inventaris', '/demo/kasir', '/demo/persiapan', '/demo/produksi', '/demo/ruang']);
      const navigateAction = rawActions.find((item) => item?.type === 'navigate' && typeof item.path === 'string' && allowedPaths.has(item.path));
      const manualAction = rawActions.find((item) => item?.type === 'open_manual_record');
      const labels: Record<string, string> = { '/kasir': 'Beranda', '/laporan': 'Riwayat dan Laporan', '/pembiayaan': 'Rekomendasi Pembiayaan', '/inventaris': 'Katalog Produk', '/harga': 'Cek Harga Bahan', '/lainnya': 'Pengaturan dan Akun', '/pengaturan-usaha': 'Profil Usaha', '/integrasi': 'Integrasi', '/riwayat': 'Riwayat', '/statistik': 'Statistik', '/kredit': 'Kredit', '/rekomendasi': 'Rekomendasi', '/demo': 'Ruang Demo', '/demo/akuntansi': 'Demo Akuntansi', '/demo/analisis': 'Demo Analisis', '/demo/inventaris': 'Demo Inventaris', '/demo/kasir': 'Demo Kasir', '/demo/persiapan': 'Persiapan Demo', '/demo/produksi': 'Demo Produksi', '/demo/ruang': 'Ruang Demo Interaktif' };

      // Read-only actions do not require a second approval: the user's spoken request is sufficient.
      if (rawActions.length === 1 && navigateAction) {
        setPendingItems([]);
        router.push(navigateAction.path as string);
        const text = `Baik, saya buka ${labels[navigateAction.path as string] || 'halaman tujuan'}.`;
        const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: text, provider };
        historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
        showResponse(text, 'answer');
        if (voiceEnabledRef.current) void speakText(assistantMessage.id, text);
        return;
      }
      if (rawActions.length === 1 && manualAction) {
        setPendingItems([]);
        const mode = manualAction.mode === 'keluar' || manualAction.mode === 'modal' ? manualAction.mode : 'masuk';
        onManualRecord(mode);
        const text = 'Baik, form Catat Manual saya buka.';
        const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: text, provider };
        historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
        showResponse(text, 'answer');
        if (voiceEnabledRef.current) void speakText(assistantMessage.id, text);
        return;
      }
      const reportAction = rawActions.length === 1 ? rawActions.find((item) => item?.type === 'accounting_report_export' && typeof item.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)) : undefined;
      if (reportAction) {
        setPendingItems([]);
        await downloadAccountingReport(reportAction.month as string);
        return;
      }

      const actions = rawActions.filter((item) => item?.type === 'transaction' || item?.type === 'transaction_delete' || item?.type === 'opening_balance_setup' || item?.type === 'start_daily_session' || item?.type === 'daily_modal_set' || item?.type === 'product_create' || item?.type === 'product_update' || item?.type === 'product_delete' || item?.type === 'production_recipe_create' || item?.type === 'production_batch_complete' || item?.type === 'profile_update' || item?.type === 'accounting_entry') as PendingAction[];
      const transactionActions = actions.filter((item): item is PendingTransaction => item.type === 'transaction');
      const appActions = actions.filter((item) => item.type !== 'transaction');
      const validTransactions = transactionActions.filter((item) =>
        (item.jenis === 'biaya' || item.jenis === 'penjualan') && typeof item.keterangan === 'string' && item.keterangan.trim() &&
        Number.isSafeInteger(item.jumlah) && item.jumlah > 0 && Number.isSafeInteger(item.qty) && item.qty > 0 &&
        (item.metode === null || item.metode === 'tunai' || item.metode === 'qris'),
      ).slice(0, 5);
      const hasValidAppAction = appActions.length === 1 && typeof body.actionToken === 'string' && body.actionToken.length > 40;
      let pendingActions: PendingAction[] = [];
      if (validTransactions.length) {
        pendingActions = validTransactions;
      } else if (hasValidAppAction) {
        pendingActions = appActions as PendingAction[];
      }

      if (pendingActions.length) {
        setPendingItems(pendingActions, hasValidAppAction && !validTransactions.length && !navigateAction && !manualAction ? body.actionToken as string : null);
        const confirmText = actionConfirmation(pendingActions);
        const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: confirmText, provider };
        historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
        showResponse(confirmText, 'confirm', true);
        if (voiceEnabledRef.current) void speakText(assistantMessage.id, confirmText);
      } else {
        const reply = typeof body.reply === 'string' && body.reply.trim() ? body.reply.trim() : 'Maaf, saya belum bisa membantu. Coba ulangi dengan singkat.';
        const firstSentence = reply.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() || reply;
        const replyWords = firstSentence.split(/\s+/);
        const conciseReply = replyWords.length > 24 ? `${replyWords.slice(0, 23).join(' ')}.` : firstSentence;
        const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: conciseReply, provider };
        historyRef.current = [...historyRef.current, assistantMessage].slice(-12);
        showResponse(conciseReply, 'answer');
        if (voiceEnabledRef.current) void speakText(assistantMessage.id, conciseReply);
      }
    } catch (err) {
      if (controller.signal.aborted || turnId !== activeTurnRef.current) return;
      const messageText = shortError(err);
      showResponse(messageText, 'error');
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), messageText);
    } finally {
      if (turnId === activeTurnRef.current) {
        if (chatAbortRef.current === controller) chatAbortRef.current = null;
        busySendingRef.current = false;
        setBusySending(false);
        setPhase('idle');
      }
    }
  }, [clearResponse, downloadAccountingReport, getAccessToken, onManualRecord, router, setPendingItems, showResponse, speakText]);

  const revisePendingAction = useCallback(async (raw: string) => {
    const currentProposal = pendingRef.current;
    if (!currentProposal.length || busySendingRef.current || savingRef.current) return;
    const turnId = ++activeTurnRef.current;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    busySendingRef.current = true;
    setBusySending(true);
    setPhase('thinking');
    stopCurrentSpeech();
    clearResponse();
    const previous = historyRef.current.slice(-4).map(({ role, content }) => ({ role, content }));
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: raw };
    historyRef.current = [...historyRef.current, userMessage].slice(-12);
    try {
      const token = await getAccessToken();
      if (turnId !== activeTurnRef.current) return;
      const result = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          message: raw,
          history: previous,
          mode: 'revise_pending_action',
          pendingAction: currentProposal,
          pendingActionToken: pendingTokenRef.current,
        }),
      });
      if (turnId !== activeTurnRef.current) return;
      const body = await result.json().catch(() => null) as {
        error?: string;
        reply?: string;
        actions?: Array<Record<string, unknown>>;
        actionToken?: string | null;
        provider?: string;
      } | null;
      if (!result.ok) throw new Error(body?.error || 'Koreksi belum dapat diproses.');
      if (turnId !== activeTurnRef.current) return;
      const rawActions = Array.isArray(body?.actions) ? body.actions : [];
      const currentIsTransactions = currentProposal.every((item) => item.type === 'transaction');
      let revised: PendingAction[] = [];
      if (rawActions.length) {
        if (currentIsTransactions) {
          if (rawActions.length !== currentProposal.length || rawActions.some((item) => item?.type !== 'transaction')) {
            throw new Error('Saya belum bisa memastikan rincian transaksi yang perlu dikoreksi. Sebutkan bagian yang ingin diganti.');
          }
          revised = rawActions.map((item, index) => ({ ...currentProposal[index], ...item })) as PendingAction[];
        } else {
          if (currentProposal.length !== 1 || rawActions.length !== 1 || rawActions[0]?.type !== currentProposal[0].type) {
            throw new Error('Koreksi ini mengubah jenis tindakan. Sebutkan kembali bagian yang ingin diperbaiki agar saya tidak salah menjalankan.');
          }
          const next = rawActions[0] as unknown as PendingAction;
          const previousAction = currentProposal[0];
          if (previousAction.type === 'profile_update' && next.type === 'profile_update') {
            revised = [{ ...next, changes: { ...previousAction.changes, ...next.changes } }];
          } else if (previousAction.type === 'product_update' && next.type === 'product_update') {
            revised = [{ ...next, changes: { ...previousAction.changes, ...next.changes } }];
          } else {
            revised = [next];
          }
        }
      }
      if (!revised.length) {
        const clarification = typeof body?.reply === 'string' && body.reply.trim()
          ? body.reply.trim().split(/(?<=[.!?])\s+/)[0].slice(0, 220)
          : 'Saya menangkap kamu sedang mengoreksi. Bagian mana dari rincian tadi yang perlu diganti?';
        const clarificationMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: clarification };
        historyRef.current = [...historyRef.current, clarificationMessage].slice(-12);
        showResponse(clarification, 'answer', true);
        if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), clarification);
        return;
      }
      const isOnlyTransactions = revised.every((item) => item.type === 'transaction');
      const actionToken = typeof body?.actionToken === 'string' && body.actionToken.length > 40 ? body.actionToken : null;
      if (!isOnlyTransactions && !actionToken) throw new Error('Proposal koreksi belum memiliki izin konfirmasi yang valid. Silakan ulangi koreksinya.');
      setPendingItems(revised, isOnlyTransactions ? null : actionToken);
      const confirmationText = `Saya koreksi. ${actionConfirmation(revised)}`;
      const confirmationMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: confirmationText,
        provider: body?.provider === 'gemini' ? 'gemini' : body?.provider === 'openrouter' ? 'openrouter' : 'groq',
      };
      historyRef.current = [...historyRef.current, confirmationMessage].slice(-12);
      showResponse(confirmationText, 'confirm', true);
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), confirmationText);
    } catch (error) {
      if (controller.signal.aborted || turnId !== activeTurnRef.current) return;
      const message = shortError(error);
      showResponse(message, 'error', true);
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), message);
    } finally {
      if (turnId === activeTurnRef.current) {
        if (chatAbortRef.current === controller) chatAbortRef.current = null;
        busySendingRef.current = false;
        setBusySending(false);
        setPhase('idle');
      }
    }
  }, [clearResponse, getAccessToken, setPendingItems, showResponse, speakText, stopCurrentSpeech]);

  const sayAnswer = useCallback((text: string, kind: ResponseKind = 'answer', sticky = false) => {
    const message: Message = { id: crypto.randomUUID(), role: 'assistant', content: text };
    historyRef.current = [...historyRef.current, message].slice(-12);
    showResponse(text, kind, sticky);
    if (voiceEnabledRef.current) void speakText(message.id, text);
  }, [showResponse, speakText]);

  const confirmHours = useCallback(async () => {
    const proposal = hoursProposalRef.current;
    if (!proposal || savingRef.current) return;
    savingRef.current = true;
    setBusySaving(true);
    try {
      const result = await saveOperatingHours(proposal.buka, proposal.tutup);
      if (result.ok) {
        setHoursProposalState(null);
        hoursAwaitRef.current = null;
        sayAnswer(`Siap, jam usahamu sudah saya catat: buka jam ${formatJam(proposal.buka)}, tutup jam ${formatJam(proposal.tutup)}. Saya akan menemani sesuai jam itu.`, 'success');
      } else {
        sayAnswer(result.message, 'error', true);
      }
    } finally {
      savingRef.current = false;
      setBusySaving(false);
    }
  }, [sayAnswer, setHoursProposalState]);

  const rejectHours = useCallback(() => {
    setHoursProposalState(null);
    hoursAwaitRef.current = { until: Date.now() + HOURS_AWAIT_MS, partial: { buka: null, tutup: null } };
    sayAnswer('Baik. Tahan tombol V lalu sebutkan jam buka dan jam tutup yang benar, atau atur langsung di Pengaturan Usaha.');
    const id = responseRef.current?.id;
    if (id) setCardActions({ id, actions: ['open_settings'] });
  }, [sayAnswer, setHoursProposalState]);

  /** Jawaban lisan tentang jam usaha ("buka jam 8 pagi, tutup jam 5 sore"). Mengembalikan true bila sudah ditangani. */
  const handleHoursSpeech = useCallback(async (raw: string): Promise<boolean> => {
    const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!text || TRANSACTION_WORDS.test(text)) return false;
    const proposal = hoursProposalRef.current;
    const awaiting = hoursAwaitRef.current && hoursAwaitRef.current.until > Date.now() ? hoursAwaitRef.current : null;
    const mentionsHours = /\b(buka|tutup|operasional)/.test(text) && /\b(jam|pukul)\b/.test(text);
    if (!proposal && !awaiting && !mentionsHours) return false;

    if (proposal) {
      const choice = confirmationChoice(raw);
      if (choice === 'yes') { await confirmHours(); return true; }
      if (choice === 'no') { rejectHours(); return true; }
    }

    const partial = awaiting?.partial ?? { buka: null, tutup: null };
    let candidate = text;
    if (!/\b(buka|mulai|tutup|selesai|closing|open)(nya)?\b/.test(text)) {
      if (partial.buka && !partial.tutup) candidate = `tutup ${text}`;
      else if (partial.tutup && !partial.buka) candidate = `buka ${text}`;
    }
    const parsed = parseOperatingHours(candidate);
    if (!parsed) {
      if (awaiting && confirmationChoice(raw) === 'no' && text.split(' ').length <= 4) {
        hoursAwaitRef.current = null;
        sayAnswer('Baik, tidak apa-apa. Kamu bisa mengatur jam usaha kapan saja di Pengaturan Usaha.');
        return true;
      }
      return false;
    }

    const buka = parsed.buka ?? partial.buka;
    const tutup = parsed.tutup ?? partial.tutup;
    hoursAwaitRef.current = { until: Date.now() + HOURS_AWAIT_MS, partial: { buka, tutup } };
    if (buka && tutup) {
      setHoursProposalState({ buka, tutup });
      sayAnswer(`Saya catat usahamu buka jam ${formatJam(buka)} dan tutup jam ${formatJam(tutup)}. Sudah benar?`, 'confirm', true);
    } else if (buka) {
      sayAnswer(`Oke, buka jam ${formatJam(buka)}. Lalu tutupnya jam berapa?`);
    } else if (tutup) {
      sayAnswer(`Oke, tutup jam ${formatJam(tutup)}. Lalu bukanya jam berapa?`);
    }
    return true;
  }, [confirmHours, rejectHours, sayAnswer, setHoursProposalState]);

  const handleRecognizedText = useCallback(async (text: string) => {
    if (pendingRef.current.length) {
      const choice = confirmationChoice(text);
      if (choice === 'yes' || choice === 'no') {
        try { await handleConfirmation(text); } finally { setPhase('idle'); }
      } else {
        await revisePendingAction(text);
      }
      return;
    }
    if (await handleHoursSpeech(text)) {
      setPhase('idle');
      return;
    }
    const classify = classifyAwaitRef.current && classifyAwaitRef.current.until > Date.now() ? classifyAwaitRef.current : null;
    const category = classify ? jawabanKategori(text) : null;
    if (classify && category) {
      classifyAwaitRef.current = null;
      const { error } = await supabase.rpc('set_transaction_expense_category', {
        p_transaction_id: classify.transactionId,
        p_kategori: category.kategori,
        p_produk: category.produk,
      });
      if (error) {
        sayAnswer(/set_transaction_expense_category|function/i.test(error.message)
          ? 'Pengelompokan biaya belum aktif di database. Jalankan supabase/migration_v21_biaya_bahan_produksi.sql dulu ya.'
          : 'Maaf, kategori biayanya belum berhasil disimpan. Coba lagi sebentar lagi.', 'error');
      } else {
        announceTransactionSaved();
        sayAnswer(category.kategori === 'bahan_produksi'
          ? `Siap, saya catat sebagai biaya bahan produksi${category.produk ? ` untuk ${category.produk}` : ''}.`
          : 'Siap, saya catat sebagai biaya operasional.');
      }
      setPhase('idle');
      return;
    }
    const followUp = planAwaitRef.current && planAwaitRef.current.until > Date.now() ? planAwaitRef.current : null;
    const reply = followUp ? planReply(text) : null;
    if (followUp && reply) {
      planAwaitRef.current = null;
      const userId = await currentMemoryUserId();
      if (userId) setPlanStatus(userId, followUp.planId, reply === 'keep' ? 'open' : reply === 'done' ? 'done' : 'dropped');
      sayAnswer(reply === 'done'
        ? 'Mantap, saya tandai sudah selesai. Kalau ada yang perlu dicatat dari itu, ceritakan saja ya.'
        : reply === 'drop'
          ? 'Baik, saya hapus dari rencana. Tidak apa-apa.'
          : 'Siap! Kalau sudah dikerjakan, ceritakan saja ya, nanti saya bantu catat.');
      setPhase('idle');
      return;
    }
    // Rencana yang disebut pemilik ("besok mau beli bahan") diingat untuk ditindaklanjuti, tanpa menghentikan percakapan.
    // Bila ucapan murni rencana, Cashie cukup menanggapi sebagai teman: tidak membuka form dan tidak memanggil AI.
    const planKind = await captureUserPlan(text, todayISO());
    if (planKind) {
      historyRef.current = [...historyRef.current, { id: crypto.randomUUID(), role: 'user', content: text } as Message].slice(-12);
      sayAnswer(planAcknowledgement(planKind), 'answer');
      setPhase('idle');
      return;
    }
    await sendMessage(text);
  }, [handleConfirmation, handleHoursSpeech, revisePendingAction, sayAnswer, sendMessage]);

  const processAudio = useCallback(async (blob: Blob, mime: string) => {
    const turnId = ++activeTurnRef.current;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    try {
      const token = await getAccessToken();
      if (turnId !== activeTurnRef.current) return;
      const form = new FormData();
      const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `cava-voice.${extension}`);
      const result = await fetch('/api/ai/transcribe', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin', cache: 'no-store', body: form, signal: controller.signal,
      });
      if (turnId !== activeTurnRef.current) return;
      const body = await result.json();
      if (turnId !== activeTurnRef.current) return;
      if (!result.ok) throw new Error(body.error || 'Suara belum berhasil dikenali.');
      const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
      if (!transcript) throw new Error('Ucapan belum terdengar jelas. Silakan coba lagi.');
      setUserSaid(transcript);
      await handleRecognizedText(transcript);
    } catch (err) {
      if (controller.signal.aborted || turnId !== activeTurnRef.current) return;
      const message = shortError(err);
      showResponse(message, 'error');
      if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), message);
      setPhase('idle');
    } finally {
      if (turnId === activeTurnRef.current) {
        if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
        setPhase('idle');
      }
    }
  }, [getAccessToken, handleRecognizedText, showResponse, speakText]);

  const beginRecording = useCallback(async () => {
    const canInterrupt = phase === 'thinking' || phase === 'transcribing' || speaking || loadingSpeech;
    if ((phase !== 'idle' && !canInterrupt) || busySaving || savingRef.current) return;
    if (canInterrupt) {
      activeTurnRef.current += 1;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      busySendingRef.current = false;
      setBusySending(false);
      setPhase('idle');
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const message = 'Browser ini belum mendukung perekaman suara. Coba Chrome melalui localhost.';
      showResponse(message, 'error');
      return;
    }

    stopCurrentSpeech();
    clearResponse();
    setSeconds(0);
    setPhase('requesting');
    pressedRef.current = true;
    cancelledRef.current = false;

    try {
      await getAccessToken();
      if (!pressedRef.current || cancelledRef.current) { setPhase('idle'); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      if (!pressedRef.current || cancelledRef.current) { stopTracks(); setPhase('idle'); return; }

      const mimeType = audioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = () => {
        cancelledRef.current = true;
        const message = 'Perekaman terganggu. Periksa mikrofon lalu coba lagi.';
        setPhase('idle'); showResponse(message, 'error'); stopMicVisualizer(); stopTracks();
      };
      recorder.onstop = () => {
        stopTimers(); stopMicVisualizer(); stopTracks(); recorderRef.current = null;
        const wasCancelled = cancelledRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (wasCancelled) { setPhase('idle'); return; }
        if (Date.now() - startedAtRef.current < 450 || blob.size < 1200) {
          const message = 'Ucapkan perintah sedikit lebih lama, lalu lepaskan tombol V.';
          setPhase('idle'); showResponse(message, 'error'); return;
        }
        setPhase('transcribing');
        void processAudio(blob, blob.type || mimeType || 'audio/webm');
      };
      recorder.start(250);
      startMicVisualizer(stream);
      setPhase('recording');
      tickRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      timerRef.current = setTimeout(() => {
        pressedRef.current = false;
        const activeRecorder = recorderRef.current;
        if (activeRecorder?.state === 'recording') activeRecorder.stop();
      }, MAX_RECORDING_MS);
    } catch (err) {
      pressedRef.current = false;
      stopTracks(); stopTimers(); setPhase('idle');
      const message = shortError(err);
      showResponse(message, 'error');
    }
  }, [busySaving, clearResponse, getAccessToken, loadingSpeech, phase, processAudio, showResponse, speaking, startMicVisualizer, stopCurrentSpeech, stopTimers, stopTracks, stopMicVisualizer]);

  const finishRecording = useCallback((cancel = false) => {
    pressedRef.current = false;
    cancelledRef.current = cancel;
    if (phase === 'requesting') { if (cancel) setPhase('idle'); return; }
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      stopTimers();
      setPhase(cancel ? 'idle' : 'transcribing');
      recorder.stop();
    }
  }, [phase, stopTimers]);

  const cancelCurrentTurn = useCallback(() => {
    // A database write already in progress cannot be rolled back by dismissing the card.
    if (savingRef.current) return;
    // Menutup kartu proaktif dihitung sebagai "jangan ganggu dulu": dua kali, Cashie diam sepanjang hari.
    if (proactiveIdRef.current && responseRef.current?.id === proactiveIdRef.current) recordProactiveDismissed();
    proactiveIdRef.current = null;
    hoursAwaitRef.current = null;
    setHoursProposalState(null);
    activeTurnRef.current += 1;
    cancelledRef.current = true;
    pressedRef.current = false;
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = null;
    voiceGestureStartedRef.current = false;
    pointerActiveRef.current = false;
    keyboardPressRef.current = false;
    tapClickPendingRef.current = false;
    ignoreNextClickRef.current = false;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    stopCurrentSpeech();
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      stopTimers();
      try { recorder.stop(); } catch { /* recorder mungkin sudah berhenti */ }
    } else {
      stopTimers();
      stopMicVisualizer();
      stopTracks();
    }
    busySendingRef.current = false;
    setBusySending(false);
    setPendingItems([]);
    clearResponse();
    setUserSaid(null);
    setPhase('idle');
  }, [clearResponse, setHoursProposalState, setPendingItems, stopCurrentSpeech, stopMicVisualizer, stopTimers, stopTracks]);

  const startPressGesture = useCallback(() => {
    if (gestureTimerRef.current || pointerActiveRef.current && voiceGestureStartedRef.current) return;
    tapClickPendingRef.current = false;
    ignoreNextClickRef.current = false;
    voiceGestureStartedRef.current = false;
    pressedRef.current = true;
    cancelledRef.current = false;
    gestureTimerRef.current = setTimeout(() => {
      gestureTimerRef.current = null;
      voiceGestureStartedRef.current = true;
      // Pointer akan menghasilkan click setelah pointerup; click itu harus diabaikan
      // karena gesture panjang sudah dipakai sebagai perintah suara.
      ignoreNextClickRef.current = true;
      void beginRecording();
    }, 280);
  }, [beginRecording]);

  const finishPressGesture = useCallback((cancel = false) => {
    if (gestureTimerRef.current) {
      clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = null;
    }
    const startedVoice = voiceGestureStartedRef.current;
    voiceGestureStartedRef.current = false;
    if (startedVoice) {
      ignoreNextClickRef.current = true;
      finishRecording(cancel);
      return;
    }
    pressedRef.current = false;
    cancelledRef.current = cancel;
    if (!cancel) tapClickPendingRef.current = true;
  }, [finishRecording]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    const canBargeIn = phase === 'thinking' || phase === 'transcribing' || speaking || loadingSpeech;
    if (event.button !== 0 || pointerActiveRef.current || (phase !== 'idle' && !canBargeIn) || (isBusy && !canBargeIn) || busySaving) return;
    unlockAudio();
    pointerActiveRef.current = true;
    // Jangan preventDefault di pointerdown: browser perlu menyelesaikan click
    // setelah pointerup agar modal manual tidak tertutup oleh event yang sama.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* tidak didukung */ }
    startPressGesture();
  };

  const handlePointerUp = () => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    finishPressGesture(false);
  };

  const handlePointerCancel = () => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    tapClickPendingRef.current = false;
    finishPressGesture(true);
    // Pointer-cancel tidak menghasilkan click; jangan sampai mengabaikan tap berikutnya.
    ignoreNextClickRef.current = false;
  };

  const handleButtonClick = () => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      tapClickPendingRef.current = false;
      return;
    }
    if (tapClickPendingRef.current) {
      tapClickPendingRef.current = false;
      onManualRecord();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const canBargeIn = phase === 'thinking' || phase === 'transcribing' || speaking || loadingSpeech;
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat && !keyboardPressRef.current && (phase === 'idle' || canBargeIn) && (!isBusy || canBargeIn) && !busySaving) {
      unlockAudio();
      event.preventDefault();
      keyboardPressRef.current = true;
      startPressGesture();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === ' ' || event.key === 'Enter') && keyboardPressRef.current) {
      event.preventDefault();
      keyboardPressRef.current = false;
      finishPressGesture(false);
      // Keyboard sudah ditangani di keyup dan tidak memerlukan click sintetis.
      ignoreNextClickRef.current = false;
      if (tapClickPendingRef.current) {
        tapClickPendingRef.current = false;
        onManualRecord();
      }
    }
  };

  const cancelPending = useCallback(() => {
    setPendingItems([]);
    const text = 'Baik, saya batalkan. Tidak ada perubahan yang dilakukan.';
    showResponse(text, 'answer');
    if (voiceEnabledRef.current) void speakText(crypto.randomUUID(), text);
  }, [setPendingItems, showResponse, speakText]);

  const confirmPending = useCallback(() => { void executePendingActions(); }, [executePendingActions]);

  const toggleVoice = () => {
    const enabled = !voiceEnabledRef.current;
    voiceEnabledRef.current = enabled;
    setVoiceEnabled(enabled);
    if (!enabled) stopCurrentSpeech();
    else if (response) void speakText(response.id, response.text);
  };

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Cashie hanya bicara saat benar-benar sedang diam: tidak merekam, tidak berpikir, tidak ada kartu atau konfirmasi terbuka.
  const canProactiveInterrupt = useCallback(() => (
    phaseRef.current === 'idle'
    && !responseRef.current
    && !pendingRef.current.length
    && !hoursProposalRef.current
    && !busySendingRef.current
    && !savingRef.current
    && !activeSpeechTextRef.current
    && !pressedRef.current
    && !pointerActiveRef.current
  ), []);

  const waitForAudioRunning = useCallback(async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (audioContextRef.current?.state === 'running') return true;
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    return audioContextRef.current?.state === 'running';
  }, []);

  const presentProactive = useCallback((message: ProactiveMessage, withVoice: boolean) => {
    const askHours = message.intent?.type === 'ask_hours' ? message.intent : null;
    const suggestion = askHours?.suggestion ?? null;
    // Kartu "benar begitu?" tetap tampil sampai dijawab, supaya tombol Ya tidak hilang sendiri.
    if (suggestion) {
      setHoursProposalState({ buka: suggestion.buka, tutup: suggestion.tutup });
      showResponse(message.text, 'confirm', true);
    } else {
      showResponse(message.text, 'answer', false, PROACTIVE_CARD_MS);
    }
    const id = responseRef.current?.id ?? null;
    // Menutup sapaan pembuka tidak dianggap menolak pesan proaktif.
    proactiveIdRef.current = message.greeting ? null : id;
    if (id && message.actions.length) setCardActions({ id, actions: message.actions });
    historyRef.current = [...historyRef.current, { id: crypto.randomUUID(), role: 'assistant' as const, content: message.text }].slice(-12);
    if (message.intent?.type === 'classify_expense') classifyAwaitRef.current = { until: Date.now() + HOURS_AWAIT_MS, transactionId: message.intent.transactionId };
    if (message.intent?.type === 'plan_followup') planAwaitRef.current = { until: Date.now() + HOURS_AWAIT_MS, planId: message.intent.planId };
    if (askHours) {
      hoursAwaitRef.current = {
        until: Date.now() + HOURS_AWAIT_MS,
        partial: { buka: suggestion?.buka ?? null, tutup: suggestion?.tutup ?? null },
      };
    }
    if (withVoice && voiceEnabledRef.current) void speakText(id ?? crypto.randomUUID(), message.text);
  }, [setHoursProposalState, showResponse, speakText]);

  // Browser baru mengizinkan suara setelah pengguna menyentuh halaman. Bila sapaan pembuka terblokir,
  // Cashie menunggu sentuhan pertama lalu menyapa dengan suara.
  const deferGreetingUntilGesture = useCallback((message: ProactiveMessage) => {
    pendingGreetingCleanupRef.current?.();
    const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
    let expiry = 0;
    const cleanup = () => {
      for (const name of events) window.removeEventListener(name, onGesture, true);
      if (expiry) window.clearTimeout(expiry);
      pendingGreetingCleanupRef.current = null;
    };
    function onGesture() {
      cleanup();
      unlockAudio(); // harus dipanggil di dalam sentuhan itu sendiri
      window.setTimeout(() => {
        if (!canProactiveInterrupt() || document.querySelector('[aria-modal="true"]')) return;
        presentProactive(message, true);
      }, 450);
    }
    for (const name of events) window.addEventListener(name, onGesture, true);
    expiry = window.setTimeout(cleanup, 10 * 60_000);
    pendingGreetingCleanupRef.current = cleanup;
  }, [canProactiveInterrupt, presentProactive, unlockAudio]);

  const deliverProactive = useCallback((message: ProactiveMessage) => {
    if (!voiceEnabledRef.current) { presentProactive(message, false); return; }
    unlockAudio();
    void waitForAudioRunning(700).then((running) => {
      if (running) presentProactive(message, true);
      else if (message.greeting) deferGreetingUntilGesture(message);
      else presentProactive(message, false);
    });
  }, [deferGreetingUntilGesture, presentProactive, unlockAudio, waitForAudioRunning]);

  const runCardAction = useCallback((action: ProactiveAction) => {
    stopCurrentSpeech();
    clearResponse();
    if (action === 'record_sale') onManualRecord('masuk');
    else if (action === 'record_expense') onManualRecord('keluar');
    else if (action === 'open_report') router.push('/laporan');
    else router.push('/pengaturan-usaha');
  }, [clearResponse, onManualRecord, router, stopCurrentSpeech]);

  useCashieProactive({
    enabled: variant === 'global' && controlsVisible,
    canInterrupt: canProactiveInterrupt,
    deliver: deliverProactive,
  });

  useEffect(() => () => {
    pendingGreetingCleanupRef.current?.();
    speechRequestRef.current += 1;
    if (speechFrameRef.current !== null) cancelAnimationFrame(speechFrameRef.current);
    speechFrameRef.current = null;
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = null;
    voiceGestureStartedRef.current = false;
    pointerActiveRef.current = false;
    keyboardPressRef.current = false;
    tapClickPendingRef.current = false;
    ignoreNextClickRef.current = false;
    cancelledRef.current = true;
    pressedRef.current = false;
    chatAbortRef.current?.abort();
    transcriptionAbortRef.current?.abort();
    speechAbortRef.current?.abort();
    stopTimers();
    stopMicVisualizer();
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    stopTracks();
    try { audioSourceRef.current?.stop(); } catch { /* audio sudah selesai */ }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    audioCacheRef.current.clear();
  }, [stopTimers, stopTracks, stopMicVisualizer]);

  const isActive = phase === 'requesting' || phase === 'recording';
  const isBusy = phase === 'transcribing' || phase === 'thinking' || busySending || busySaving;
  const hasVisibleCard = phase !== 'idle' || response !== null || pending.length > 0;
  const currentText = phase === 'requesting' ? 'Menghubungkan mikrofon…'
    : phase === 'recording' ? `Mendengarkan… ${seconds} detik. Lepaskan tombol V untuk mengirim.`
    : phase === 'transcribing' ? 'Memahami perintah suara…'
    : phase === 'thinking' ? 'Cashie sedang menyiapkan jawaban…'
    : response?.text ?? (pending.length ? 'Menunggu konfirmasi. Ucapkan ya atau tidak.' : '');
  const progressiveChunks = response ? speechDisplayChunks(response.text) : [];
  const isPreparingResponseAudio = Boolean(response && voiceEnabled && loadingSpeech && speechProgress?.text === response.text);
  const textOnHold = Boolean(response && voiceEnabled && holdId === response.id);
  const typewriterActive = Boolean(response && typeId === response.id);
  const typedCount = useWordTypewriter(response?.text ?? '', typewriterActive);
  const isPlayingResponseAudio = Boolean(response && voiceEnabled && speaking && speechProgress?.text === response.text);

  return (
    <>
      {(variant === 'mobile' || variant === 'global') && controlsVisible && (
        <div className={variant === 'global' ? 'fixed bottom-[calc(8px+env(safe-area-inset-bottom))] left-1/2 z-[55] flex -translate-x-1/2 flex-col items-center lg:hidden' : 'flex flex-col items-center'}>
          <button
            type="button"
            onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel} onClick={handleButtonClick}
            onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="Ketuk untuk Catat manual, atau tahan untuk berbicara dengan Cashie"
            aria-pressed={phase === 'recording'}
            className={`-mt-7 flex h-14 items-center justify-center gap-2 rounded-full bg-[#103A57] text-white shadow-[0_8px_18px_rgba(16,58,87,0.35)] ring-4 ring-white transition-[width,background-color] duration-200 touch-none select-none ${isActive ? 'w-[124px] px-3' : 'w-14'}`}
          >
            {isActive ? <><CavaVMark size={22}/><span className="flex h-6 items-center gap-[2px]" aria-hidden="true">{micLevels.slice(5, 21).map((level, index) => <span key={index} className="w-[2px] rounded-full bg-white/90" style={{ height: `${Math.max(4, 4 + level * 18)}px` }} />)}</span></> : <CavaVMark size={28}/>}
          </button>
          <span className="mt-0.5 py-1 text-[10px] font-extrabold text-[#103A57]">Catat</span>
        </div>
      )}
      {(variant === 'desktop' || variant === 'global') && controlsVisible && (
        <div className={variant === 'global' ? 'fixed left-5 top-[88px] z-[55] hidden w-56 lg:block' : 'w-full'}>
          <button
            type="button"
            onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel} onClick={handleButtonClick}
            onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="Ketuk untuk Catat manual, atau tahan untuk berbicara dengan Cashie"
            aria-pressed={phase === 'recording'}
            className={`w-full rounded-xl px-4 py-3 font-extrabold text-xs flex items-center justify-center gap-2.5 transition-all touch-none select-none ${isActive ? 'bg-[#103A57] text-white' : 'bg-[#CEE5D6] hover:bg-white text-[#103A57]'}`}
          >
            {isActive ? <><CavaVMark size={18}/><span className="flex h-6 items-center gap-[3px]" aria-hidden="true">{micLevels.slice(4, 28).map((level, index) => <span key={index} className="w-[2px] rounded-full bg-current" style={{ height: `${Math.max(4, 4 + level * 18)}px` }} />)}</span></> : <><CavaVMark size={18}/>Catat</>}
          </button>
        </div>
      )}

      <AnimatePresence>
        {hasVisibleCard && (
          <motion.aside
            initial={reduceMotion ? false : { opacity: 0, y: 58, scale: 0.16 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 58, scale: 0.16 }}
            transition={{ type: 'spring', stiffness: 330, damping: 27, mass: 0.72 }}
            style={{ transformOrigin: '50% 100%' }}
            className="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-3 right-3 z-[70] mx-auto flex w-auto max-w-[460px] items-end justify-end gap-2 origin-bottom lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0 lg:w-[min(460px,calc(100vw-300px))] lg:max-w-[460px]"
          >
            <div
              className="max-h-[min(54vh,430px)] min-w-0 w-[min(276px,calc(100vw-112px))] overflow-y-auto rounded-[20px] rounded-br-md border border-[#103A57]/10 bg-white/95 p-3 shadow-[0_14px_38px_rgba(16,58,87,0.18)] backdrop-blur-sm"
              role="status"
              aria-live="polite"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-extrabold tracking-wide text-[#103A57]">Cashie</span>
                  {isBusy && <span className="h-1.5 w-1.5 rounded-full bg-[#307B8E] animate-pulse" />}
                </div>
                {response?.kind === 'confirm' && <span className="rounded-full bg-[#FFF4D9] px-2 py-0.5 text-[9px] font-bold text-[#805600]">Konfirmasi</span>}
              </div>
              {userSaid && (phase === 'thinking' || phase === 'transcribing' || response !== null) && (
                <p className="mb-1.5 text-[10px] font-semibold leading-snug text-[#66808A]">Kamu: “{userSaid}”</p>
              )}
              {(isPreparingResponseAudio || textOnHold || (isPlayingResponseAudio && (speechProgress?.visibleCount ?? 0) === 0)) ? (
                <p className="flex h-[22px] items-center gap-1" role="status" aria-label="Cashie sedang menyiapkan suara">
                  {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#307B8E]" style={{ animationDelay: `${dot * 160}ms` }} />)}
                </p>
              ) : isPlayingResponseAudio ? (
                <p className="text-[12px] leading-[1.75] text-[#24475A]" aria-label="Teks jawaban Cashie mengikuti suara yang sedang diputar">
                  {progressiveChunks.slice(0, speechProgress?.visibleCount ?? 0).map((chunk, index) => (
                    <span
                      key={`${index}-${chunk.display}`}
                      className={speechProgress?.activeIndex === index ? 'rounded bg-[#DCEFE5] px-0.5 font-extrabold text-[#103A57] transition-colors' : ''}
                    >{index > 0 ? ' ' : ''}{chunk.display}</span>
                  ))}
                </p>
              ) : typewriterActive && typedCount < progressiveChunks.length ? (
                <p className="text-[12px] leading-[1.75] text-[#24475A]">
                  {progressiveChunks.slice(0, typedCount).map((chunk, index) => <span key={`${index}-${chunk.display}`}>{index > 0 ? ' ' : ''}{chunk.display}</span>)}
                </p>
              ) : (
                <p className="text-[12px] leading-[1.55] text-[#24475A]">{currentText}</p>
              )}
              {phase === 'recording' && (
                <div className="mt-2 rounded-xl bg-[#EEF5F1] px-3 py-2" role="img" aria-label="Gelombang suara bergerak mengikuti volume mikrofon">
                  <div className="flex h-9 items-center justify-center gap-[3px] overflow-hidden">
                    {micLevels.map((level, index) => (
                      <span
                        key={index}
                        className="cashie-wave-bar w-[3px] shrink-0 rounded-full bg-[#307B8E]"
                        style={{ height: `${Math.max(4, 4 + level * 32)}px`, opacity: 0.55 + level * 0.45 }}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-center text-[9px] font-bold text-[#66808A]">Dengarkan saya</p>
                </div>
              )}
              {pending.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" onClick={confirmPending} disabled={busySaving || !pending.length || (pending.some((item) => ['product_create','product_update','product_delete','production_recipe_create','production_batch_complete','profile_update','accounting_entry','transaction_delete','opening_balance_setup','start_daily_session','daily_modal_set'].includes(item.type)) && !pendingTokenRef.current)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#103A57] px-3 py-2 text-[10px] font-extrabold text-white disabled:opacity-50">
                    {busySaving ? <LoaderCircle size={12} className="animate-spin"/> : <Check size={12}/>} {pending.every((item) => item.type === 'transaction') ? 'Ya, catat' : 'Ya, lanjutkan'}
                  </button>
                  <button type="button" onClick={cancelPending} disabled={busySaving} className="rounded-lg border border-[#D6E3DC] px-3 py-2 text-[10px] font-bold text-[#456273] disabled:opacity-50">Tidak, batalkan</button>
                </div>
              )}
              {hoursProposal && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void confirmHours()} disabled={busySaving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#103A57] px-3 py-2 text-[10px] font-extrabold text-white disabled:opacity-50">
                    {busySaving ? <LoaderCircle size={12} className="animate-spin"/> : <Check size={12}/>} Ya, benar
                  </button>
                  <button type="button" onClick={rejectHours} disabled={busySaving} className="rounded-lg border border-[#D6E3DC] px-3 py-2 text-[10px] font-bold text-[#456273] disabled:opacity-50">Bukan, ubah</button>
                </div>
              )}
              {cardActions && response && cardActions.id === response.id && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {cardActions.actions.map((action) => (
                    <button key={action} type="button" onClick={() => runCardAction(action)} className="rounded-full bg-[#EEF5F1] px-2.5 py-1.5 text-[10px] font-extrabold text-[#103A57] hover:bg-[#DCEFE5]">
                      {CARD_ACTION_LABEL[action]}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#EAF0EC] pt-2">
                <button type="button" onClick={toggleVoice} aria-label={voiceEnabled ? 'Matikan suara jawaban' : 'Aktifkan suara jawaban'} className="inline-flex items-center gap-1 text-[9px] font-bold text-[#66808A]">
                  {voiceEnabled ? <Volume2 size={13}/> : <VolumeX size={13}/>} {voiceEnabled ? 'Suara aktif' : 'Suara mati'}
                </button>
                <button type="button" disabled={!response || loadingSpeech || isBusy} onClick={() => { if (response) void speakText(response.id, response.text); }} className="inline-flex items-center gap-1 text-[9px] font-bold text-[#66808A] disabled:opacity-40">
                  {loadingSpeech ? <LoaderCircle size={12} className="animate-spin"/> : <Volume2 size={12}/>} {speaking ? 'Memutar' : 'Ulangi'}
                </button>
                <button type="button" onClick={cancelCurrentTurn} disabled={busySaving} title={busySaving ? 'Perubahan sedang disimpan dan tidak dapat dibatalkan dari sini.' : 'Batalkan proses Cashie'} aria-label={busySaving ? 'Perubahan sedang disimpan' : 'Tutup pesan Cashie'} className="ml-auto grid h-6 w-6 place-items-center rounded-full text-[#78909A] hover:bg-[#F0F5F2] disabled:cursor-not-allowed disabled:opacity-40"><X size={13}/></button>
              </div>
            </div>
            <CashieMascotFigure mood={isActive ? 'listening' : isBusy ? 'thinking' : speaking ? 'speaking' : 'idle'} priority={isActive}/>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
