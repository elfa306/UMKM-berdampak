-- Stage 7: penyatuan GoPay Merchant + MacroDroid ke alur pembayaran akun.
-- Jalankan setelah migration_v2.sql dan migration_v3.sql (serta migration tahap 1-6).
-- Aman dijalankan berulang kali; tidak menghapus token, inbox, atau transaksi lama.

-- Sumber pembayaran yang jelas untuk rekonsiliasi dan pelaporan.
alter table public.qris_inbox
  add column if not exists source text not null default 'gopay_macrodroid',
  add column if not exists notification_ts text;

alter table public.transactions
  add column if not exists payment_source text;

-- Pastikan nilai sumber pembayaran konsisten. NULL dipertahankan untuk transaksi historis.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_payment_source_check'
  ) then
    alter table public.transactions
      add constraint transactions_payment_source_check
      check (payment_source is null or payment_source in (
        'gopay_macrodroid', 'belibayar_sandbox', 'manual', 'cashier'
      ));
  end if;
end $$;

create index if not exists qris_inbox_user_received_idx
  on public.qris_inbox (user_id, received_at desc);

create index if not exists transactions_user_payment_source_idx
  on public.transactions (user_id, payment_source, created_at desc);

-- RPC server-only: menyimpan notifikasi, dan jika sesi harian sudah tersedia,
-- langsung membuat transaksi secara atomik. Payload MacroDroid lama tetap diterima oleh API.
create or replace function public.ingest_gopay_notification(
  p_user_id uuid,
  p_mutation_id text,
  p_amount numeric,
  p_note text default null,
  p_notification_ts text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbox_id uuid;
  v_existing_amount numeric(14,0);
  v_existing_posted boolean;
  v_session_id uuid;
  v_transaction_id uuid;
  v_duplicate boolean := false;
  v_note text;
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_id is null then raise exception 'invalid_user_id' using errcode = '22023'; end if;
  if p_mutation_id is null or length(p_mutation_id) < 8 or length(p_mutation_id) > 160 then
    raise exception 'invalid_mutation_id' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999999999 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  v_note := left(coalesce(nullif(trim(p_note), ''), 'GoPay Merchant'), 80);

  insert into public.qris_inbox (
    user_id, mutation_id, jumlah, catatan, source, notification_ts
  ) values (
    p_user_id, p_mutation_id, p_amount, v_note, 'gopay_macrodroid', nullif(p_notification_ts, '')
  )
  on conflict (user_id, mutation_id) do nothing
  returning id into v_inbox_id;

  if v_inbox_id is null then
    v_duplicate := true;
    select id, jumlah, posted
      into v_inbox_id, v_existing_amount, v_existing_posted
    from public.qris_inbox
    where user_id = p_user_id and mutation_id = p_mutation_id
    for update;

    if not found then raise exception 'inbox_upsert_failed'; end if;
    if v_existing_amount <> p_amount then
      raise exception 'duplicate_mutation_amount_mismatch' using errcode = '22023';
    end if;
    if v_existing_posted then
      return jsonb_build_object('ok', true, 'duplicate', true, 'posted', true, 'inbox_id', v_inbox_id);
    end if;
  end if;

  select id into v_session_id
  from public.daily_sessions
  where user_id = p_user_id and tanggal = v_day
  limit 1
  for update;

  if v_session_id is null then
    return jsonb_build_object(
      'ok', true, 'duplicate', v_duplicate, 'posted', false,
      'awaiting_daily_session', true, 'inbox_id', v_inbox_id
    );
  end if;

  insert into public.transactions (
    user_id, session_id, jenis, keterangan, jumlah, qty, metode, ref_id, payment_source
  ) values (
    p_user_id, v_session_id, 'penjualan', 'QRIS masuk · ' || v_note,
    p_amount, 1, 'qris', p_mutation_id, 'gopay_macrodroid'
  )
  on conflict (user_id, ref_id) where ref_id is not null do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id into v_transaction_id
    from public.transactions
    where user_id = p_user_id and ref_id = p_mutation_id
    limit 1;
  end if;

  update public.qris_inbox
  set posted = true
  where id = v_inbox_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true, 'duplicate', v_duplicate, 'posted', true,
    'awaiting_daily_session', false, 'inbox_id', v_inbox_id,
    'transaction_id', v_transaction_id
  );
end;
$$;

revoke all on function public.ingest_gopay_notification(uuid, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.ingest_gopay_notification(uuid, text, numeric, text, text) to service_role;

-- RPC akun: pindahkan inbox notifikasi yang tertahan untuk tanggal sesi yang sama.
-- Semua query dibatasi auth.uid(); pengguna tidak dapat memproses inbox milik akun lain.
create or replace function public.post_pending_gopay_notifications(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.daily_sessions%rowtype;
  v_item record;
  v_count integer := 0;
  v_tx_id uuid;
begin
  if v_user_id is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into v_session
  from public.daily_sessions
  where id = p_session_id and user_id = v_user_id
  for update;
  if not found then raise exception 'daily_session_not_found' using errcode = 'P0002'; end if;

  for v_item in
    select q.id, q.mutation_id, q.jumlah, q.catatan
    from public.qris_inbox q
    where q.user_id = v_user_id
      and q.posted = false
      and (q.received_at at time zone 'Asia/Jakarta')::date = v_session.tanggal
    order by q.received_at
    for update skip locked
  loop
    insert into public.transactions (
      user_id, session_id, jenis, keterangan, jumlah, qty, metode, ref_id, payment_source
    ) values (
      v_user_id, v_session.id, 'penjualan',
      'QRIS masuk · ' || left(coalesce(v_item.catatan, 'GoPay Merchant'), 40),
      v_item.jumlah, 1, 'qris', v_item.mutation_id, 'gopay_macrodroid'
    )
    on conflict (user_id, ref_id) where ref_id is not null do nothing
    returning id into v_tx_id;

    -- Jika conflict, transaksi sudah pernah dibuat; inbox tetap aman ditandai posted.
    update public.qris_inbox
    set posted = true
    where id = v_item.id and user_id = v_user_id;

    if v_tx_id is not null then v_count := v_count + 1; end if;
    v_tx_id := null;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.post_pending_gopay_notifications(uuid) from public, anon;
grant execute on function public.post_pending_gopay_notifications(uuid) to authenticated;

-- Realtime sudah diaktifkan di migration_v3; blok berikut menjaga tabel tetap terdaftar.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qris_inbox'
  ) then
    alter publication supabase_realtime add table public.qris_inbox;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;
