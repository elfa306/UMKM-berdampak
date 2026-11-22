-- Migration v20: jam buka dan jam tutup usaha.
-- Dipakai Cashie untuk menemani pemilik usaha di waktu yang pas (sapaan pagi, menjelang tutup, rekap).
-- Kolom bersifat opsional; aplikasi tetap berjalan bila kolom ini belum diisi.
-- Jalankan di Supabase Dashboard -> SQL Editor.

alter table public.business_profiles
  add column if not exists jam_buka text,
  add column if not exists jam_tutup text;

alter table public.business_profiles drop constraint if exists business_profiles_jam_buka_format;
alter table public.business_profiles drop constraint if exists business_profiles_jam_tutup_format;

alter table public.business_profiles
  add constraint business_profiles_jam_buka_format
    check (jam_buka is null or jam_buka ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint business_profiles_jam_tutup_format
    check (jam_tutup is null or jam_tutup ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

comment on column public.business_profiles.jam_buka is 'Jam buka usaha (WIB), format HH:MM';
comment on column public.business_profiles.jam_tutup is 'Jam tutup usaha (WIB), format HH:MM';
