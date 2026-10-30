-- Jalankan SETELAH schema.sql dan migration_v2.sql (SQL Editor > New query > Run)
-- Aman dijalankan berulang kali.

-- 1) Aktifkan Realtime untuk tabel yang dipantau layar Kasir.
--    Event INSERT tetap mengikuti RLS: tiap pengguna hanya menerima baris miliknya sendiri.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qris_inbox') then
    alter publication supabase_realtime add table public.qris_inbox;
  end if;
end $$;

-- 2) Tabel token MacroDroid. Kode di repo (app/api/gopay & halaman Integrasi) sudah memakainya,
--    tetapi belum ada di schema.sql / migration_v2.sql. Jika tabel ini SUDAH ada di proyek Anda,
--    bagian ini tidak mengubah apa pun.
create table if not exists public.webhook_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.webhook_tokens enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'webhook_tokens') then
    create policy "own rows" on public.webhook_tokens
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- 3) Percepat query rapor 30 hari & riwayat
create index if not exists transactions_session_idx on public.transactions (session_id, created_at);
create index if not exists daily_sessions_user_tgl_idx on public.daily_sessions (user_id, tanggal desc);
