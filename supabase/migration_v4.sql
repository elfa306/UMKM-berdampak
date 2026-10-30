-- Jalankan SETELAH schema.sql, migration_v2.sql, dan migration_v3.sql.
-- Satu baris profil untuk setiap akun Supabase Auth.

create table if not exists public.business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nama_usaha text not null,
  tanggal_mulai_usaha date not null,
  hari_buka_per_bulan smallint not null default 26
    check (hari_buka_per_bulan between 1 and 31),
  kebutuhan_modal numeric(14,0) not null
    check (kebutuhan_modal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_profiles enable row level security;

revoke all on table public.business_profiles from anon, authenticated;
grant select, insert, update on public.business_profiles to authenticated;

-- Pisahkan kebijakan agar operasi upsert (insert/update) dapat melewati RLS
-- hanya untuk baris milik akun yang sedang login.
drop policy if exists "business_profiles_select_own" on public.business_profiles;
create policy "business_profiles_select_own"
  on public.business_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "business_profiles_insert_own" on public.business_profiles;
create policy "business_profiles_insert_own"
  on public.business_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "business_profiles_update_own" on public.business_profiles;
create policy "business_profiles_update_own"
  on public.business_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
