-- Jalankan SETELAH schema.sql (SQL Editor > New query > Run)

-- 1) Penanda transaksi otomatis (QRIS) agar tidak tercatat dobel
alter table transactions add column if not exists ref_id text;
create unique index if not exists transactions_ref_unique on transactions (user_id, ref_id) where ref_id is not null;

-- 2) Kotak masuk pembayaran QRIS dari webhook Moota (ditulis oleh server, dibaca/diperbarui pemilik)
create table if not exists qris_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null,
  jumlah numeric(14,0) not null check (jumlah > 0),
  catatan text,
  received_at timestamptz not null default now(),
  posted boolean not null default false,
  unique (user_id, mutation_id)
);
alter table qris_inbox enable row level security;
create policy "own read" on qris_inbox for select using (user_id = auth.uid());
create policy "own update" on qris_inbox for update using (user_id = auth.uid()) with check (user_id = auth.uid());
