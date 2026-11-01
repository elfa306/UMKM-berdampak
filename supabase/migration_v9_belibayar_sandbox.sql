-- UMKM Berdampak - Tahap 6: Belibayar Sandbox QRIS
-- Jalankan SETELAH migration_v8_demo_pos.sql.
-- Migration ini hanya menambah skema DEMO; tidak mengubah tabel transaksi produksi.

alter table public.demo_payments
  add column if not exists external_reference text,
  add column if not exists qr_content text,
  add column if not exists qr_url text,
  add column if not exists expires_at timestamptz,
  add column if not exists merchant_id text,
  add column if not exists payment_channel text,
  add column if not exists merchant_fee numeric(14,2) check (merchant_fee is null or merchant_fee >= 0),
  add column if not exists net_credit numeric(14,2) check (net_credit is null or net_credit >= 0),
  add column if not exists fee_bearer text check (fee_bearer is null or fee_bearer in ('merchant', 'customer'));

create unique index if not exists demo_payments_provider_external_reference_uidx
  on public.demo_payments (provider, external_reference)
  where external_reference is not null;

create table if not exists public.demo_static_qris (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.demo_sessions(id) on delete cascade,
  provider_reference text not null unique,
  merchant_reference text not null unique,
  label text not null,
  qr_content text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists demo_static_qris_session_status_idx
  on public.demo_static_qris (session_id, status);

create index if not exists demo_payments_belibayar_tx_idx
  on public.demo_payments (external_transaction_id)
  where provider = 'belibayar_sandbox' and external_transaction_id is not null;

alter table public.demo_static_qris enable row level security;
revoke all on table public.demo_static_qris from public, anon, authenticated;
grant all on table public.demo_static_qris to service_role;

-- Webhook dinamis: proses status dan pengurangan stok secara atomik serta idempotent.
-- Pembayaran PAID yang datang terlambat setelah EXPIRED/CANCELLED tetap diterima.
-- Jika stok sudah tidak cukup, pembayaran tetap tercatat, tetapi stok ditandai untuk rekonsiliasi.
create or replace function public.apply_demo_belibayar_dynamic_webhook(
  p_reference text,
  p_transaction_id text,
  p_amount numeric,
  p_status text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.demo_orders%rowtype;
  v_payment public.demo_payments%rowtype;
  v_item record;
  v_new_stock numeric(14,3);
  v_inventory_changed boolean := false;
  v_inventory_shortfall boolean := false;
  v_has_physical_items boolean := false;
  v_paid_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;
  if p_reference is null or length(p_reference) < 8 or length(p_reference) > 64 then raise exception 'invalid_reference'; end if;
  if p_transaction_id is null or length(p_transaction_id) < 1 or length(p_transaction_id) > 64 then raise exception 'invalid_transaction_id'; end if;
  if p_status not in ('paid', 'expired', 'cancelled') then raise exception 'invalid_payment_status'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'invalid_payment_amount'; end if;

  select o.* into v_order
  from public.demo_payments p
  join public.demo_orders o on o.id = p.order_id and o.session_id = p.session_id
  where p.provider = 'belibayar_sandbox'
    and p.external_reference = p_reference
  limit 1
  for update of o;
  if not found then raise exception 'demo_order_reference_not_found'; end if;

  perform 1 from public.demo_sessions s
  where s.id = v_order.session_id
    and s.status in ('active', 'ended')
    and s.expires_at > now() - interval '8 days'
  for update;
  if not found then raise exception 'demo_session_not_available_for_webhook'; end if;

  select * into v_payment
  from public.demo_payments
  where session_id = v_order.session_id and order_id = v_order.id
  order by created_at desc
  limit 1
  for update;
  if not found then raise exception 'demo_payment_not_found'; end if;

  if round(p_amount, 2) <> round(v_order.total, 2) then
    raise exception 'payment_amount_mismatch';
  end if;

  if exists (
    select 1 from public.demo_payments other
    where other.provider = 'belibayar_sandbox'
      and other.external_transaction_id = p_transaction_id
      and other.id <> v_payment.id
  ) then
    raise exception 'duplicate_external_transaction';
  end if;

  if v_payment.external_transaction_id is not null and v_payment.external_transaction_id <> p_transaction_id then
    raise exception 'order_has_different_external_transaction';
  end if;

  v_paid_at := case
    when (p_payload->>'paid_at') ~ '^[0-9]+$'
      then to_timestamp((p_payload->>'paid_at')::numeric)
    else now()
  end;

  if p_status = 'paid' then
    if v_order.status = 'paid' then
      update public.demo_payments
      set external_transaction_id = p_transaction_id,
          raw_payload = p_payload,
          merchant_id = nullif(p_payload->>'merchant_id', ''),
          payment_channel = nullif(p_payload->>'payment_channel', ''),
          merchant_fee = nullif(p_payload->>'merchant_fee', '')::numeric,
          net_credit = nullif(p_payload->>'net_credit', '')::numeric,
          fee_bearer = case when p_payload->>'fee_bearer' in ('merchant', 'customer') then p_payload->>'fee_bearer' else null end
      where id = v_payment.id;
      return jsonb_build_object('ok', true, 'status', 'paid', 'idempotent', true, 'order_id', v_order.id);
    end if;

    -- Periksa seluruh baris terlebih dahulu. Jika satu produk tidak tersedia atau
    -- stok tidak cukup, jangan lakukan pengurangan parsial; pembayaran tetap PAID
    -- dan sesi ditandai agar stok dapat direkonsiliasi.
    select exists (
      select 1
      from public.demo_order_items i
      left join public.demo_products p on p.id = i.product_id and p.session_id = i.session_id
      where i.session_id = v_order.session_id
        and i.order_id = v_order.id
        and (p.id is null or (p.jenis_item <> 'service' and p.stok < i.qty))
    ) into v_inventory_shortfall;

    select exists (
      select 1
      from public.demo_order_items i
      join public.demo_products p on p.id = i.product_id and p.session_id = i.session_id
      where i.session_id = v_order.session_id and i.order_id = v_order.id
        and p.jenis_item <> 'service'
    ) into v_has_physical_items;

    if not v_inventory_shortfall then
      for v_item in
        select i.product_id, i.qty, p.jenis_item, p.nama
        from public.demo_order_items i
        join public.demo_products p on p.id = i.product_id and p.session_id = i.session_id
        where i.session_id = v_order.session_id and i.order_id = v_order.id
        order by i.product_id
        for update of p
      loop
        if v_item.jenis_item = 'service' then continue; end if;

        update public.demo_products
        set stok = stok - v_item.qty
        where id = v_item.product_id
          and session_id = v_order.session_id
          and stok >= v_item.qty
        returning stok into v_new_stock;

        if not found then
          -- Locks on the products plus the session-level lock should prevent this
          -- branch, but keep a safe reconciliation flag if data changes unexpectedly.
          v_inventory_shortfall := true;
        else
          insert into public.demo_inventory_movements (
            session_id, product_id, movement_type, quantity_delta, reference_id, note
          ) values (
            v_order.session_id, v_item.product_id, 'sale', -v_item.qty, v_order.id,
            'Pengurangan stok setelah webhook Belibayar Sandbox berstatus paid'
          );
          v_inventory_changed := true;
        end if;
      end loop;
    end if;

    update public.demo_orders
    set status = 'paid', paid_at = v_paid_at,
        metadata = metadata || jsonb_build_object(
          'belibayar_status', 'paid',
          'inventory_reconciliation_needed', v_inventory_shortfall
        )
    where id = v_order.id and session_id = v_order.session_id;

    update public.demo_payments
    set provider = 'belibayar_sandbox',
        external_reference = p_reference,
        external_transaction_id = p_transaction_id,
        amount = p_amount,
        status = 'paid',
        paid_at = v_paid_at,
        raw_payload = p_payload,
        merchant_id = nullif(p_payload->>'merchant_id', ''),
        payment_channel = nullif(p_payload->>'payment_channel', ''),
        merchant_fee = nullif(p_payload->>'merchant_fee', '')::numeric,
        net_credit = nullif(p_payload->>'net_credit', '')::numeric,
        fee_bearer = case when p_payload->>'fee_bearer' in ('merchant', 'customer') then p_payload->>'fee_bearer' else null end
    where id = v_payment.id;

    insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
    values (
      v_order.session_id, 'sale_paid', 'sale:' || v_order.id::text,
      jsonb_build_object('order_id', v_order.id, 'invoice_no', v_order.invoice_no, 'total', v_order.total, 'provider', 'belibayar_sandbox')
    ) on conflict (session_id, idempotency_key) do nothing;

    if v_inventory_changed then
      insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
      values (
        v_order.session_id, 'inventory_decreased', 'inventory-sale:' || v_order.id::text,
        jsonb_build_object('order_id', v_order.id, 'invoice_no', v_order.invoice_no, 'provider', 'belibayar_sandbox')
      ) on conflict (session_id, idempotency_key) do nothing;
    end if;

    return jsonb_build_object(
      'ok', true, 'status', 'paid', 'order_id', v_order.id,
      'inventory_changed', v_inventory_changed,
      'inventory_reconciliation_needed', v_inventory_shortfall
    );
  end if;

  -- Status non-final tidak pernah menurunkan pesanan yang sudah paid.
  if v_order.status = 'paid' then
    return jsonb_build_object('ok', true, 'status', 'paid', 'idempotent', true, 'order_id', v_order.id);
  end if;

  update public.demo_orders
  set status = case when p_status = 'expired' then 'expired' else 'cancelled' end,
      metadata = metadata || jsonb_build_object('belibayar_status', p_status)
  where id = v_order.id and session_id = v_order.session_id;

  update public.demo_payments
  set provider = 'belibayar_sandbox',
      external_reference = p_reference,
      external_transaction_id = p_transaction_id,
      amount = p_amount,
      status = case when p_status = 'expired' then 'expired' else 'failed' end,
      raw_payload = p_payload,
      merchant_id = nullif(p_payload->>'merchant_id', ''),
      payment_channel = nullif(p_payload->>'payment_channel', '')
  where id = v_payment.id;

  return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id);
end;
$$;

-- QRIS statis tidak membawa rincian SKU. Setiap pembayaran berhasil dibuat sebagai
-- transaksi penjualan tanpa rincian barang; stok tidak diubah dan HPP tidak diestimasi.
create or replace function public.record_demo_belibayar_static_payment(
  p_merchant_reference text,
  p_provider_reference text,
  p_transaction_id text,
  p_webhook_reference text,
  p_amount numeric,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.demo_static_qris%rowtype;
  v_session public.demo_sessions%rowtype;
  v_order public.demo_orders%rowtype;
  v_payment public.demo_payments%rowtype;
  v_invoice text;
  v_paid_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;
  if p_transaction_id is null or length(p_transaction_id) < 1 or length(p_transaction_id) > 64 then raise exception 'invalid_transaction_id'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'invalid_payment_amount'; end if;

  select * into v_qr
  from public.demo_static_qris
  where (p_merchant_reference is not null and merchant_reference = p_merchant_reference)
     or (p_provider_reference is not null and provider_reference = p_provider_reference)
  limit 1
  for update;
  if not found then raise exception 'demo_static_qr_not_found'; end if;

  select * into v_session
  from public.demo_sessions
  where id = v_qr.session_id and status in ('active', 'ended') and expires_at > now() - interval '8 days'
  for update;
  if not found then raise exception 'demo_session_not_available_for_webhook'; end if;

  select * into v_payment
  from public.demo_payments
  where provider = 'belibayar_sandbox' and external_transaction_id = p_transaction_id
  limit 1;
  if found then
    return jsonb_build_object('ok', true, 'status', 'paid', 'idempotent', true, 'order_id', v_payment.order_id);
  end if;

  v_invoice := 'QRIS-STATIC-' || upper(substr(md5(p_transaction_id), 1, 20));
  v_paid_at := case
    when (p_payload->>'paid_at') ~ '^[0-9]+$'
      then to_timestamp((p_payload->>'paid_at')::numeric)
    else now()
  end;

  insert into public.demo_orders (
    session_id, invoice_no, status, payment_method, payment_source,
    subtotal, discount, total, metadata, is_seeded, paid_at
  ) values (
    v_qr.session_id, v_invoice, 'paid', 'QRIS Statis (Belibayar Sandbox)', 'belibayar_sandbox',
    p_amount, 0, p_amount,
    jsonb_build_object(
      'origin', 'belibayar_sandbox_static_qris',
      'unallocated_static_qris', true,
      'inventory_effect', 'none',
      'note', 'QRIS statis tidak membawa rincian SKU; stok dan HPP tidak dihitung dari pembayaran ini.'
    ),
    false, v_paid_at
  ) returning * into v_order;

  insert into public.demo_payments (
    session_id, order_id, provider, external_reference, external_transaction_id,
    amount, status, raw_payload, paid_at, merchant_id, payment_channel,
    merchant_fee, net_credit, fee_bearer
  ) values (
    v_qr.session_id, v_order.id, 'belibayar_sandbox', p_webhook_reference,
    p_transaction_id, p_amount, 'paid', p_payload, v_paid_at,
    nullif(p_payload->>'merchant_id', ''), nullif(p_payload->>'payment_channel', ''),
    nullif(p_payload->>'merchant_fee', '')::numeric,
    nullif(p_payload->>'net_credit', '')::numeric,
    case when p_payload->>'fee_bearer' in ('merchant', 'customer') then p_payload->>'fee_bearer' else null end
  );

  insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
  values (
    v_qr.session_id, 'sale_paid', 'sale:' || v_order.id::text,
    jsonb_build_object(
      'order_id', v_order.id, 'invoice_no', v_order.invoice_no,
      'total', v_order.total, 'provider', 'belibayar_sandbox',
      'unallocated_static_qris', true
    )
  ) on conflict (session_id, idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id, 'invoice_no', v_order.invoice_no, 'inventory_changed', false);
end;
$$;

revoke all on function public.apply_demo_belibayar_dynamic_webhook(text, text, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_demo_belibayar_static_payment(text, text, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.apply_demo_belibayar_dynamic_webhook(text, text, numeric, text, jsonb) to service_role;
grant execute on function public.record_demo_belibayar_static_payment(text, text, text, text, numeric, jsonb) to service_role;


-- Pertahankan sesi yang sudah berakhir selama 8 hari agar callback pembayaran
-- terlambat (maksimal 7 hari menurut dokumentasi provider) tetap bisa dipetakan.
-- Setelah masa retensi, data demo dibersihkan melalui fungsi cleanup saat sesi baru dibuat.
create or replace function public.cleanup_expired_demo_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  delete from public.demo_sessions
  where expires_at < now() - interval '8 days'
     or (status = 'ended' and last_seen_at < now() - interval '8 days');
  get diagnostics v_deleted = row_count;

  delete from public.demo_session_rate_limits
  where updated_at < now() - interval '2 days';

  return v_deleted;
end;
$$;
revoke all on function public.cleanup_expired_demo_sessions() from public, anon, authenticated;
grant execute on function public.cleanup_expired_demo_sessions() to service_role;
