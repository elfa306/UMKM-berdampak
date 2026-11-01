-- Profil usaha dan onboarding klasifikasi UMKM.
-- Jalankan SETELAH schema.sql, migration_v2.sql, migration_v3.sql, dan migration_v4.sql.
-- Aman dijalankan berulang kali. Tidak menghapus data profil yang sudah ada.

create table if not exists public.business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nama_usaha text not null,
  tanggal_mulai_usaha date not null,
  hari_buka_per_bulan smallint not null default 26
    check (hari_buka_per_bulan between 1 and 31),
  kebutuhan_modal numeric(14,0) not null check (kebutuhan_modal > 0),
  jenis_usaha text,
  bentuk_usaha text,
  bidang_usaha text,
  memiliki_persediaan boolean,
  metode_pembayaran text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tambahkan kolom jika business_profiles sudah dibuat oleh versi aplikasi sebelumnya.
alter table public.business_profiles
  add column if not exists jenis_usaha text,
  add column if not exists bentuk_usaha text,
  add column if not exists bidang_usaha text,
  add column if not exists memiliki_persediaan boolean,
  add column if not exists metode_pembayaran text,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Pastikan pilihan yang disimpan hanya berasal dari opsi aplikasi.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_profiles'::regclass
      and conname = 'business_profiles_jenis_usaha_check'
  ) then
    alter table public.business_profiles
      add constraint business_profiles_jenis_usaha_check
      check (jenis_usaha is null or jenis_usaha in ('retail', 'manufaktur', 'jasa', 'campuran'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_profiles'::regclass
      and conname = 'business_profiles_bentuk_usaha_check'
  ) then
    alter table public.business_profiles
      add constraint business_profiles_bentuk_usaha_check
      check (bentuk_usaha is null or bentuk_usaha in ('perorangan', 'pt_perorangan', 'cv', 'pt', 'koperasi', 'lainnya'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_profiles'::regclass
      and conname = 'business_profiles_metode_pembayaran_check'
  ) then
    alter table public.business_profiles
      add constraint business_profiles_metode_pembayaran_check
      check (metode_pembayaran is null or metode_pembayaran in (
        'gopay_macrodroid',
        'belibayar_sandbox_static',
        'belibayar_sandbox_dynamic',
        'manual'
      ));
  end if;
end $$;

alter table public.business_profiles enable row level security;
revoke all on table public.business_profiles from anon, authenticated;
grant select, insert, update on table public.business_profiles to authenticated;

-- Bersihkan kebijakan lama pada tabel ini agar tidak ada kebijakan permisif
-- yang tanpa sengaja memperluas akses lintas akun.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'business_profiles'
  loop
    execute format('drop policy if exists %I on public.business_profiles', p.policyname);
  end loop;
end $$;

create policy "business_profiles_select_own"
  on public.business_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "business_profiles_insert_own"
  on public.business_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "business_profiles_update_own"
  on public.business_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists business_profiles_onboarding_idx
  on public.business_profiles (onboarding_completed_at);
