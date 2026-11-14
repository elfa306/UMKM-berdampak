-- CAVA migration v19: idempotent, one-time confirmation tokens for Cashie actions.
-- Run after migration_v18_katalog_produk_tanpa_stok.sql.

begin;

create table if not exists public.cava_action_nonces (
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce uuid not null,
  created_at timestamptz not null default now(),
  constraint cava_action_nonces_pkey primary key (user_id, nonce)
);

alter table public.cava_action_nonces enable row level security;

revoke all on public.cava_action_nonces from public, anon;
grant insert on public.cava_action_nonces to authenticated;

drop policy if exists "Users can claim their own Cashie action confirmations" on public.cava_action_nonces;
create policy "Users can claim their own Cashie action confirmations"
  on public.cava_action_nonces
  for insert
  to authenticated
  with check (auth.uid() = user_id);

commit;
