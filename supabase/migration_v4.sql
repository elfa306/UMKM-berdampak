-- Jalankan SETELAH schema.sql, migration_v2.sql, migration_v3.sql (SQL Editor > New query > Run)
-- Aman dijalankan berulang kali.
-- Menyimpan harga median bahan baku per hari, supaya halaman Cek Harga bisa menampilkan "naik/turun X%".

create table if not exists public.harga_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bahan text not null,
  tanggal date not null,
  harga_median numeric(14,0) not null check (harga_median > 0),
  harga_termurah numeric(14,0),
  created_at timestamptz not null default now(),
  unique (user_id, bahan, tanggal)
);

alter table public.harga_snapshot enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'harga_snapshot') then
    create policy "own rows" on public.harga_snapshot
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

create index if not exists harga_snapshot_idx on public.harga_snapshot (user_id, bahan, tanggal desc);
