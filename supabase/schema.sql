-- Jalankan di Supabase: SQL Editor > New query > Run

create table daily_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tanggal date not null,
  modal_harian numeric(14,0) not null check (modal_harian >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, tanggal)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nama text not null,
  harga numeric(14,0) not null check (harga > 0),
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references daily_sessions(id) on delete cascade,
  jenis text not null check (jenis in ('penjualan','biaya')),
  keterangan text not null,
  jumlah numeric(14,0) not null check (jumlah > 0),
  qty int not null default 1,
  metode text check (metode in ('tunai','qris')),
  created_at timestamptz not null default now()
);

-- Row Level Security: setiap pengguna hanya bisa melihat/mengubah datanya sendiri
alter table daily_sessions enable row level security;
alter table products enable row level security;
alter table transactions enable row level security;

create policy "own rows" on daily_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on products for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
