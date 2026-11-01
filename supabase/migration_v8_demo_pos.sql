-- UMKM Berdampak - Tahap 5: POS / Kasir Interactive Demo
-- Jalankan setelah migration_v6_demo_sessions.sql dan migration_v7_demo_dashboard.sql.
-- Fungsi hanya boleh dipanggil backend Next.js menggunakan SUPABASE_SERVICE_ROLE_KEY.
-- Tidak mengubah tabel transaksi produksi.

create index if not exists demo_orders_session_status_date_idx
  on public.demo_orders (session_id, status, created_at desc);

create index if not exists demo_order_items_session_product_idx
  on public.demo_order_items (session_id, product_id, order_id);

create index if not exists demo_payments_session_order_idx
  on public.demo_payments (session_id, order_id, created_at desc);

-- Membuat produk/layanan demo dan mutasi stok awal dalam satu transaksi.
create or replace function public.create_demo_pos_product(
  p_session_id uuid,
  p_sku text,
  p_name text,
  p_category text,
  p_item_type text,
  p_unit text,
  p_sale_price numeric,
  p_unit_cost numeric,
  p_stock numeric,
  p_min_stock numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.demo_sessions%rowtype;
  v_product public.demo_products%rowtype;
  v_sku text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  select * into v_session
  from public.demo_sessions
  where id = p_session_id and status = 'active' and expires_at > now()
  for update;
  if not found then raise exception 'demo_session_expired'; end if;

  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 80 then
    raise exception 'invalid_product_name';
  end if;
  if p_item_type is null or p_item_type not in ('merchandise', 'finished_good', 'service', 'raw_material', 'work_in_progress') then
    raise exception 'invalid_product_type';
  end if;
  if coalesce(p_sale_price, -1) < 0 or coalesce(p_unit_cost, -1) < 0
    or coalesce(p_stock, -1) < 0 or coalesce(p_min_stock, -1) < 0 then
    raise exception 'invalid_product_amount';
  end if;
  if p_sale_price > 100000000000 or p_unit_cost > 100000000000 or p_stock > 100000000 or p_min_stock > 100000000 then
    raise exception 'product_amount_too_large';
  end if;
  if p_item_type = 'service' and coalesce(p_stock, 0) <> 0 then
    raise exception 'service_stock_must_be_zero';
  end if;
  if p_item_type in ('merchandise', 'finished_good', 'service') and coalesce(p_sale_price, 0) <= 0 then
    raise exception 'sale_price_required';
  end if;

  v_sku := nullif(left(btrim(coalesce(p_sku, '')), 32), '');
  if v_sku is null then
    v_sku := 'DEMO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  insert into public.demo_products (
    session_id, sku, nama, kategori, jenis_item, satuan,
    harga_jual, harga_pokok, stok, stok_minimum, aktif
  ) values (
    p_session_id, v_sku, btrim(p_name), left(coalesce(nullif(btrim(p_category), ''), 'Umum'), 40),
    p_item_type, left(coalesce(nullif(btrim(p_unit), ''), 'unit'), 20),
    round(coalesce(p_sale_price, 0), 2), round(coalesce(p_unit_cost, 0), 2),
    round(coalesce(p_stock, 0), 3), round(coalesce(p_min_stock, 0), 3), true
  ) returning * into v_product;

  if v_product.stok > 0 then
    insert into public.demo_inventory_movements (
      session_id, product_id, movement_type, quantity_delta, note
    ) values (
      p_session_id, v_product.id, 'opening', v_product.stok, 'Stok awal produk baru dari POS demo'
    );
  end if;

  insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
  values (
    p_session_id,
    'product_created',
    'product:' || v_product.id::text,
    jsonb_build_object('product_id', v_product.id, 'sku', v_product.sku, 'name', v_product.nama)
  ) on conflict (session_id, idempotency_key) do nothing;

  return to_jsonb(v_product);
end;
$$;

-- Membuat invoice pending dan snapshot item berdasarkan harga dari database.
-- Harga/biaya dari browser tidak pernah dipercaya.
create or replace function public.create_demo_pos_order(
  p_session_id uuid,
  p_items jsonb,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.demo_sessions%rowtype;
  v_product public.demo_products%rowtype;
  v_order public.demo_orders%rowtype;
  v_payment public.demo_payments%rowtype;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_subtotal numeric(14,2) := 0;
  v_line_total numeric(14,2);
  v_total numeric(14,2) := 0;
  v_invoice text;
  v_lines jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_method_label text;
  v_source text;
  v_provider text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  -- Serialisasi aktivitas POS per sesi untuk mencegah benturan stok.
  select * into v_session
  from public.demo_sessions
  where id = p_session_id and status = 'active' and expires_at > now()
  for update;
  if not found then raise exception 'demo_session_expired'; end if;

  if p_payment_method is null or p_payment_method not in ('cash', 'qris') then raise exception 'invalid_payment_method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_order_items';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_order_items';
  end if;

  if (select count(*) from (
    select value->>'productId' as product_id
    from jsonb_array_elements(p_items)
    group by value->>'productId'
  ) grouped) <> jsonb_array_length(p_items) then
    raise exception 'duplicate_product_lines';
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_line->>'productId')::uuid;
      v_qty := (v_line->>'qty')::numeric;
    exception when others then
      raise exception 'invalid_order_line';
    end;

    if v_qty is null or v_qty <= 0 or v_qty > 1000 or round(v_qty, 3) <> v_qty then
      raise exception 'invalid_quantity';
    end if;

    select * into v_product
    from public.demo_products
    where id = v_product_id and session_id = p_session_id and aktif = true
    for update;
    if not found then raise exception 'product_not_found'; end if;

    if v_product.jenis_item not in ('merchandise', 'finished_good', 'service') then
      raise exception 'item_not_for_sale';
    end if;
    if v_product.harga_jual <= 0 then raise exception 'invalid_sale_price'; end if;
    if v_product.jenis_item <> 'service' and v_product.stok < v_qty then
      raise exception 'insufficient_stock:%:%', v_product.nama, v_product.stok;
    end if;

    v_line_total := round(v_product.harga_jual * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.nama,
      'unit', v_product.satuan,
      'itemType', v_product.jenis_item,
      'qty', v_qty,
      'unitPrice', v_product.harga_jual,
      'unitCost', v_product.harga_pokok,
      'subtotal', v_line_total
    ));
    v_count := v_count + 1;
  end loop;

  v_total := round(v_subtotal, 2);
  v_invoice := 'DEMO-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  if p_payment_method = 'cash' then
    v_method_label := 'Tunai';
    v_source := 'cash_simulation';
    v_provider := 'cash_simulation';
  else
    v_method_label := 'QRIS (simulasi internal)';
    v_source := 'manual_demo';
    v_provider := 'manual_demo';
  end if;

  insert into public.demo_orders (
    session_id, invoice_no, status, payment_method, payment_source,
    subtotal, discount, total, metadata, is_seeded
  ) values (
    p_session_id, v_invoice, 'pending', v_method_label, v_source,
    v_subtotal, 0, v_total,
    jsonb_build_object('origin', 'interactive_demo_pos', 'payment_method', p_payment_method, 'line_count', v_count),
    false
  ) returning * into v_order;

  insert into public.demo_order_items (
    session_id, order_id, product_id, nama_snapshot, satuan_snapshot,
    qty, harga_jual, harga_pokok, subtotal
  )
  select
    p_session_id, v_order.id, (line->>'productId')::uuid, line->>'name', line->>'unit',
    (line->>'qty')::numeric, (line->>'unitPrice')::numeric,
    (line->>'unitCost')::numeric, (line->>'subtotal')::numeric
  from jsonb_array_elements(v_lines) as item(line);

  insert into public.demo_payments (
    session_id, order_id, provider, amount, status, raw_payload
  ) values (
    p_session_id, v_order.id, v_provider, v_total, 'pending',
    jsonb_build_object('source', 'pos_demo', 'method', p_payment_method)
  ) returning * into v_payment;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'payment', to_jsonb(v_payment),
    'items', v_lines
  );
end;
$$;

-- Penyelesaian pembayaran atomik: stok baru berkurang ketika pembayaran dikonfirmasi.
-- Pemanggilan berulang terhadap order yang sudah paid bersifat idempotent.
create or replace function public.settle_demo_pos_order(
  p_session_id uuid,
  p_order_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.demo_sessions%rowtype;
  v_order public.demo_orders%rowtype;
  v_item record;
  v_new_stock numeric(14,3);
  v_inventory_changed boolean := false;
  v_payment_rows integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;
  if p_action is null or p_action not in ('paid', 'cancel') then raise exception 'invalid_payment_action'; end if;

  select * into v_session
  from public.demo_sessions
  where id = p_session_id and status = 'active' and expires_at > now()
  for update;
  if not found then raise exception 'demo_session_expired'; end if;

  select * into v_order
  from public.demo_orders
  where id = p_order_id and session_id = p_session_id
  for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_action = 'cancel' then
    if v_order.status = 'paid' then raise exception 'paid_order_cannot_be_cancelled'; end if;
    if v_order.status <> 'pending' then
      return jsonb_build_object('ok', true, 'orderId', v_order.id, 'status', v_order.status, 'idempotent', true);
    end if;
    update public.demo_orders set status = 'cancelled' where id = v_order.id and session_id = p_session_id;
    update public.demo_payments set status = 'failed', raw_payload = raw_payload || jsonb_build_object('cancelled_at', now())
      where order_id = v_order.id and session_id = p_session_id and status = 'pending';
    return jsonb_build_object('ok', true, 'orderId', v_order.id, 'status', 'cancelled');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('ok', true, 'orderId', v_order.id, 'invoiceNo', v_order.invoice_no, 'status', 'paid', 'idempotent', true);
  end if;
  if v_order.status <> 'pending' then raise exception 'order_not_pending'; end if;

  for v_item in
    select i.product_id, i.qty, p.jenis_item, p.nama
    from public.demo_order_items i
    join public.demo_products p on p.id = i.product_id and p.session_id = i.session_id
    where i.session_id = p_session_id and i.order_id = v_order.id
    order by p.id
    for update of p
  loop
    if v_item.jenis_item <> 'service' then
      update public.demo_products
      set stok = stok - v_item.qty
      where id = v_item.product_id and session_id = p_session_id and stok >= v_item.qty
      returning stok into v_new_stock;
      if not found then
        raise exception 'insufficient_stock_at_payment:%', v_item.nama;
      end if;

      insert into public.demo_inventory_movements (
        session_id, product_id, movement_type, quantity_delta, reference_id, note
      ) values (
        p_session_id, v_item.product_id, 'sale', -v_item.qty, v_order.id,
        'Pengurangan stok setelah pembayaran POS demo berhasil'
      );
      v_inventory_changed := true;
    end if;
  end loop;

  update public.demo_orders
  set status = 'paid', paid_at = now()
  where id = v_order.id and session_id = p_session_id;

  update public.demo_payments
  set status = 'paid', paid_at = now(), raw_payload = raw_payload || jsonb_build_object('settled_by', 'demo_pos', 'settled_at', now())
  where order_id = v_order.id and session_id = p_session_id and status = 'pending';
  get diagnostics v_payment_rows = row_count;
  if v_payment_rows <> 1 then raise exception 'pending_payment_not_found'; end if;

  insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
  values (
    p_session_id, 'sale_paid', 'sale:' || v_order.id::text,
    jsonb_build_object('order_id', v_order.id, 'invoice_no', v_order.invoice_no, 'total', v_order.total)
  ) on conflict (session_id, idempotency_key) do nothing;

  if v_inventory_changed then
    insert into public.demo_events (session_id, event_type, idempotency_key, metadata)
    values (
      p_session_id, 'inventory_decreased', 'inventory-sale:' || v_order.id::text,
      jsonb_build_object('order_id', v_order.id, 'invoice_no', v_order.invoice_no)
    ) on conflict (session_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'orderId', v_order.id,
    'invoiceNo', v_order.invoice_no,
    'status', 'paid',
    'total', v_order.total,
    'inventoryChanged', v_inventory_changed
  );
end;
$$;

revoke all on function public.create_demo_pos_product(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.create_demo_pos_order(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.settle_demo_pos_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_demo_pos_product(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.create_demo_pos_order(uuid, jsonb, text) to service_role;
grant execute on function public.settle_demo_pos_order(uuid, uuid, text) to service_role;
