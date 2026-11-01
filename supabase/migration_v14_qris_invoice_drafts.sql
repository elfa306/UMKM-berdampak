-- Migration v14: draft invoice QRIS untuk kasir akun utama.
-- Invoice ini hanya menyimpan keranjang/preview; tidak membuat transaksi, jurnal, atau mutasi stok.
-- Tidak ada status paid karena QRIS contoh yang ditampilkan aplikasi tidak dapat menerima pembayaran.

create table if not exists public.qris_invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.daily_sessions(id) on delete cascade,
  invoice_no text not null check (char_length(invoice_no) between 8 and 60),
  total numeric(14,0) not null check (total > 0),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  status text not null default 'pending' check (status in ('pending', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, invoice_no)
);

create index if not exists qris_invoice_drafts_user_session_created_idx
  on public.qris_invoice_drafts (user_id, session_id, created_at desc);

-- Satu invoice QRIS terbuka per akun dan sesi harian agar notifikasi nominal tidak ambigu.
create unique index if not exists qris_invoice_drafts_one_pending_per_session
  on public.qris_invoice_drafts (user_id, session_id)
  where status = 'pending';

alter table public.qris_invoice_drafts enable row level security;

drop policy if exists qris_invoice_drafts_owner_all on public.qris_invoice_drafts;
create policy qris_invoice_drafts_owner_all
  on public.qris_invoice_drafts
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.daily_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.daily_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.qris_invoice_drafts to authenticated;

comment on table public.qris_invoice_drafts is
  'Draft invoice QRIS contoh. Tidak membuktikan pembayaran dan tidak membuat transaksi akuntansi.';
