import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AssistantMutationAction, AssistantAction } from '@/lib/aiProvider.server';

type SignedProposal = { uid: string; actions: AssistantMutationAction[]; exp: number; nonce: string };

function secret(): string {
  const value = process.env.CAVA_ACTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value.length < 24) throw new Error('Kunci penandatanganan tindakan CAVA belum dikonfigurasi.');
  return value;
}

/** Signs one allowed mutation. Read-only navigation and queries never need a token. */
export function signAssistantActions(userId: string, actions: AssistantAction[]): string | null {
  const mutations = actions.filter((action): action is AssistantMutationAction =>
    action.type === 'product_create' || action.type === 'product_update' || action.type === 'product_delete' ||
    action.type === 'production_recipe_create' || action.type === 'production_batch_complete' ||
    action.type === 'profile_update' || action.type === 'accounting_entry' || action.type === 'transaction_delete' ||
    action.type === 'opening_balance_setup' || action.type === 'start_daily_session' || action.type === 'daily_modal_set',
  );
  if (!mutations.length) return null;
  if (mutations.length > 1) throw new Error('Satu perintah hanya boleh memuat satu perubahan data terstruktur.');

  const proposal: SignedProposal = {
    uid: userId,
    actions: mutations,
    exp: Date.now() + 3 * 60 * 1000,
    nonce: randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(proposal)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAssistantActionToken(token: unknown, userId: string): SignedProposal | null {
  if (typeof token !== 'string' || token.length > 24_000) return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;

  const expected = createHmac('sha256', secret()).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const proposal = parsed as Partial<SignedProposal>;
  if (proposal.uid !== userId || !Number.isFinite(proposal.exp) || Number(proposal.exp) < Date.now() || typeof proposal.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(proposal.nonce)) return null;
  if (!Array.isArray(proposal.actions) || proposal.actions.length !== 1) return null;
  const action = proposal.actions[0] as Record<string, unknown>;
  if (!['product_create', 'product_update', 'product_delete', 'production_recipe_create', 'production_batch_complete', 'profile_update', 'accounting_entry', 'transaction_delete', 'opening_balance_setup', 'start_daily_session', 'daily_modal_set'].includes(String(action?.type))) return null;
  return proposal as SignedProposal;
}
