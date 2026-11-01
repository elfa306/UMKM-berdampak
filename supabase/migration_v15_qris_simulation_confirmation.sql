-- Migration v15: konfirmasi pembayaran QRIS secara manual untuk kebutuhan simulasi.
-- QR yang tampil di kasir tetap merupakan gambar contoh dan TIDAK menerima uang.
-- Konfirmasi menghasilkan transaksi bertanda qris_simulation (terpisah dari saldo bank nyata),
-- memperbarui stok yang dilacak, dan membuat jurnal otomatis pada akun "QRIS Simulasi".

begin;

-- Draft invoice dinamis dapat ditandai lunas secara manual khusus simulasi.
alter table public.qris_invoice_drafts
  add column if not exists paid_at timestamptz,
  add column if not exists confirmation_method text;

alter table public.qris_invoice_drafts
  drop constraint if exists qris_invoice_drafts_status_check;
alter table public.qris_invoice_drafts
  add constraint qris_invoice_drafts_status_check
  check (status in ('pending', 'cancelled', 'paid_manual'));

-- Sumber pembayaran khusus agar tidak tercampur dengan GoPay / bank sungguhan.
alter table public.transactions
  drop constraint if exists transactions_payment_source_check;
alter table public.transactions
  add constraint transactions_payment_source_check
  check (payment_source is null or payment_source in (
    'gopay_macrodroid', 'belibayar_sandbox', 'manual', 'cashier', 'qris_simulation'
  ));

-- Posting QRIS simulasi ke akun terpisah, bukan ke saldo Bank / QRIS nyata.
create or replace function public.post_actual_transaction_accounting(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_product public.products%rowtype;
  v_lines jsonb;
  v_cash_code text;
  v_cash_name text;
  v_revenue_code text;
  v_revenue_name text;
  v_cost numeric(16,2) := 0;
  v_inv_code text;
  v_inv_name text;
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transaction_not_found');
  end if;

  if v_tx.jenis = 'biaya' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code','6000','name','Beban Operasional','type','expense','debit',v_tx.jumlah,'credit',0),
      jsonb_build_object('code','1000','name','Kas','type','asset','debit',0,'credit',v_tx.jumlah)
    );
  else
    v_cash_code := case
      when v_tx.payment_source = 'qris_simulation' then '1090'
      when v_tx.metode = 'qris' or v_tx.payment_source in ('gopay_macrodroid','belibayar_sandbox') then '1010'
      else '1000'
    end;
    v_cash_name := case v_cash_code
      when '1090' then 'Penerimaan QRIS Simulasi'
      when '1010' then 'Bank / QRIS'
      else 'Kas'
    end;

    v_revenue_code := '4000';
    v_revenue_name := 'Pendapatan Penjualan';
    if v_tx.product_id is not null then
      select * into v_product
      from public.products
      where id = v_tx.product_id and user_id = v_tx.user_id;
      if found and v_product.jenis_item = 'service' then
        v_revenue_code := '4100';
        v_revenue_name := 'Pendapatan Jasa';
      elsif found and v_product.lacak_stok and v_product.jenis_item in ('merchandise','finished_good') then
        v_cost := round(coalesce(v_product.harga_pokok,0) * greatest(coalesce(v_tx.qty,1),1),2);
        v_inv_code := case when v_product.jenis_item = 'finished_good' then '1230' else '1200' end;
        v_inv_name := case when v_product.jenis_item = 'finished_good' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
      end if;
    end if;

    v_lines := jsonb_build_array(
      jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',v_tx.jumlah,'credit',0),
      jsonb_build_object('code',v_revenue_code,'name',v_revenue_name,'type','revenue','debit',0,'credit',v_tx.jumlah)
    );
    if v_cost > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('code','5000','name','Harga Pokok Penjualan','type','expense','debit',v_cost,'credit',0),
        jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',0,'credit',v_cost)
      );
    end if;
  end if;

  return public.post_accounting_journal(
    v_tx.user_id,
    'transaction',
    v_tx.id::text,
    coalesce(v_tx.keterangan,'Transaksi'),
    v_lines,
    (v_tx.created_at at time zone 'Asia/Jakarta')::date
  );
end;
$$;

-- Satu RPC menangani seluruh item keranjang dalam satu transaksi database.
-- Ini mencegah sebagian barang tercatat bila item lain gagal karena stok tidak cukup.
create or replace function public.confirm_qris_payment_simulation(
  p_session_id uuid,
  p_qris_type text,
  p_items jsonb default null,
  p_invoice_id uuid default null,
  p_confirmation_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session public.daily_sessions%rowtype;
  v_invoice public.qris_invoice_drafts%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty integer;
  v_unit_price numeric(14,2);
  v_subtotal numeric(14,0);
  v_total numeric(14,0) := 0;
  v_expected_total numeric(14,0);
  v_reference text;
  v_ref_id text;
  v_tx public.transactions%rowtype;
  v_transactions jsonb := '[]'::jsonb;
  v_existing jsonb;
  v_note text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_qris_type is null or p_qris_type not in ('statis','dinamis') then
    raise exception 'invalid_qris_type' using errcode = '22023';
  end if;

  select * into v_session
  from public.daily_sessions
  where id = p_session_id and user_id = v_user
  for update;
  if not found then
    raise exception 'daily_session_not_found' using errcode = 'P0002';
  end if;

  if p_qris_type = 'dinamis' then
    if p_invoice_id is null then
      raise exception 'invoice_required' using errcode = '22023';
    end if;
    select * into v_invoice
    from public.qris_invoice_drafts
    where id = p_invoice_id
      and user_id = v_user
      and session_id = v_session.id
    for update;
    if not found then
      raise exception 'invoice_not_found' using errcode = 'P0002';
    end if;
    if v_invoice.status = 'paid_manual' then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
        into v_existing
      from public.transactions t
      where t.user_id = v_user
        and t.ref_id like ('qris-sim:' || v_invoice.id::text || ':%');
      return jsonb_build_object(
        'ok', true, 'already_recorded', true, 'qris_type', 'dinamis',
        'invoice_no', v_invoice.invoice_no, 'total', v_invoice.total,
        'transactions', coalesce(v_existing, '[]'::jsonb)
      );
    end if;
    if v_invoice.status <> 'pending' then
      raise exception 'invoice_not_pending' using errcode = '22023';
    end if;
    v_items := v_invoice.items;
    v_expected_total := v_invoice.total;
    v_reference := v_invoice.id::text;
  else
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      raise exception 'invalid_cart_items' using errcode = '22023';
    end if;
    if p_confirmation_key is null or p_confirmation_key !~* '^[0-9a-f-]{36}$' then
      raise exception 'invalid_confirmation_key' using errcode = '22023';
    end if;
    v_items := p_items;
    v_reference := p_confirmation_key;
  end if;

  if jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) < 1
     or jsonb_array_length(v_items) > 50 then
    raise exception 'invalid_cart_items' using errcode = '22023';
  end if;

  -- Menolak SKU ganda agar setiap item memiliki satu referensi mutasi/transaksi yang unik.
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item(value)
    group by item.value->>'productId'
    having count(*) > 1
  ) then
    raise exception 'duplicate_product_in_cart' using errcode = '22023';
  end if;

  -- Idempotensi QRIS statis. Jika permintaan yang sama terkirim ulang, kembalikan transaksi lama.
  if p_qris_type = 'statis' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
      into v_existing
    from public.transactions t
    where t.user_id = v_user
      and t.ref_id like ('qris-sim:' || v_reference || ':%');
    if jsonb_array_length(coalesce(v_existing, '[]'::jsonb)) > 0 then
      return jsonb_build_object(
        'ok', true, 'already_recorded', true, 'qris_type', 'statis',
        'transactions', v_existing
      );
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    begin
      v_product_id := (v_item->>'productId')::uuid;
      v_qty := (v_item->>'qty')::integer;
    exception when others then
      raise exception 'invalid_cart_item' using errcode = '22023';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 10000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and user_id = v_user and aktif = true
    for update;
    if not found then
      raise exception 'product_not_found';
    end if;
    if v_product.jenis_item not in ('merchandise','finished_good','service') or v_product.harga <= 0 then
      raise exception 'product_not_for_sale';
    end if;

    if p_qris_type = 'dinamis' then
      begin
        v_unit_price := (v_item->>'harga')::numeric;
        v_subtotal := (v_item->>'subtotal')::numeric;
      exception when others then
        raise exception 'invalid_invoice_item' using errcode = '22023';
      end;
      if v_unit_price <= 0 or v_subtotal <= 0
         or round(v_unit_price * v_qty, 0) <> v_subtotal then
        raise exception 'invoice_item_total_mismatch' using errcode = '22023';
      end if;
    else
      v_unit_price := v_product.harga;
      v_subtotal := round(v_product.harga * v_qty, 0);
    end if;
    v_total := v_total + v_subtotal;

    if v_product.lacak_stok then
      if v_product.stok < v_qty then
        raise exception 'insufficient_stock' using errcode = '22023';
      end if;
      update public.products
      set stok = stok - v_qty, updated_at = now()
      where id = v_product.id and user_id = v_user;
      insert into public.inventory_movements(
        user_id, product_id, movement_type, quantity_delta, unit_cost,
        total_cost, reference_key, note
      ) values (
        v_user, v_product.id, 'sale', -v_qty, v_product.harga_pokok,
        round(v_qty * v_product.harga_pokok, 2),
        'qris-sim:' || v_reference || ':' || v_product.id::text,
        'Penjualan QRIS simulasi yang dikonfirmasi manual'
      );
    end if;

    v_ref_id := 'qris-sim:' || v_reference || ':' || v_product.id::text;
    v_note := case when p_qris_type = 'statis'
      then 'QRIS Statis (Simulasi) · ' || v_product.nama
      else 'QRIS Dinamis (Simulasi) · ' || coalesce(nullif(v_item->>'nama',''), v_product.nama)
    end;

    insert into public.transactions(
      user_id, session_id, jenis, keterangan, jumlah, qty, metode,
      ref_id, payment_source, product_id
    ) values (
      v_user, v_session.id, 'penjualan', left(v_note, 200), v_subtotal,
      v_qty, 'qris', v_ref_id, 'qris_simulation', v_product.id
    ) returning * into v_tx;

    v_transactions := v_transactions || jsonb_build_array(to_jsonb(v_tx));
  end loop;

  if p_qris_type = 'dinamis' then
    if v_total <> v_expected_total then
      raise exception 'invoice_total_mismatch' using errcode = '22023';
    end if;
    update public.qris_invoice_drafts
    set status = 'paid_manual', paid_at = now(), confirmation_method = 'manual_simulation', updated_at = now()
    where id = v_invoice.id and user_id = v_user and status = 'pending';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_recorded', false,
    'qris_type', p_qris_type,
    'invoice_no', case when p_qris_type = 'dinamis' then v_invoice.invoice_no else null end,
    'total', v_total,
    'transactions', v_transactions
  );
end;
$$;

revoke all on function public.confirm_qris_payment_simulation(uuid,text,jsonb,uuid,text) from public, anon;
grant execute on function public.confirm_qris_payment_simulation(uuid,text,jsonb,uuid,text) to authenticated;


-- Pembatalan satu baris QRIS simulasi membatalkan seluruh batch/invoice,
-- mengembalikan stok, dan menghapus jurnal transaksi terkait secara atomik.
create or replace function public.trg_actual_inventory_adjustment_accounting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_inv_code text;
  v_inv_name text;
  v_amount numeric(16,2);
begin
  -- Mutasi ini hanya jejak pengembalian stok saat transaksi simulasi dibatalkan;
  -- jurnal transaksi aslinya sudah dihapus pada RPC pembatalan.
  if coalesce(new.note, '') like 'Pembatalan QRIS simulasi%' then
    return new;
  end if;
  if new.movement_type not in ('opening','adjustment_in','adjustment_out','return_in','return_out','waste') then
    return new;
  end if;
  select * into v_product
  from public.products
  where id = new.product_id and user_id = new.user_id;
  if not found then return new; end if;

  v_inv_code := case v_product.jenis_item
    when 'raw_material' then '1210'
    when 'work_in_progress' then '1220'
    when 'finished_good' then '1230'
    else '1200'
  end;
  v_inv_name := case v_inv_code
    when '1210' then 'Persediaan Bahan Baku'
    when '1220' then 'Persediaan Barang Dalam Proses'
    when '1230' then 'Persediaan Barang Jadi'
    else 'Persediaan Barang Dagangan'
  end;
  v_amount := coalesce(nullif(new.total_cost,0), abs(new.quantity_delta) * coalesce(new.unit_cost,v_product.harga_pokok,0));
  if v_amount <= 0 then return new; end if;

  if new.movement_type in ('opening','adjustment_in','return_in') then
    perform public.post_accounting_journal(
      new.user_id, 'inventory_movement', new.id::text,
      'Saldo/mutasi masuk: ' || v_product.nama,
      jsonb_build_array(
        jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',v_amount,'credit',0),
        jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian Persediaan','type','equity','debit',0,'credit',v_amount)
      ),
      (new.created_at at time zone 'Asia/Jakarta')::date
    );
  else
    perform public.post_accounting_journal(
      new.user_id, 'inventory_movement', new.id::text,
      'Pengurangan persediaan: ' || v_product.nama,
      jsonb_build_array(
        jsonb_build_object('code','7000','name','Kerugian/Penyusutan Persediaan','type','expense','debit',v_amount,'credit',0),
        jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',0,'credit',v_amount)
      ),
      (new.created_at at time zone 'Asia/Jakarta')::date
    );
  end if;
  return new;
end;
$$;

create or replace function public.cancel_qris_payment_simulation(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.transactions%rowtype;
  v_item public.transactions%rowtype;
  v_product public.products%rowtype;
  v_prefix text;
  v_reference text;
  v_ids jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id and user_id = v_user
  for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'transaction_ids', '[]'::jsonb);
  end if;
  if v_tx.payment_source <> 'qris_simulation' or v_tx.ref_id is null then
    raise exception 'not_qris_simulation_transaction' using errcode = '22023';
  end if;

  v_reference := split_part(v_tx.ref_id, ':', 2);
  v_prefix := 'qris-sim:' || v_reference;
  if v_reference !~* '^[0-9a-f-]{36}$' then
    raise exception 'invalid_qris_simulation_reference';
  end if;

  for v_item in
    select * from public.transactions
    where user_id = v_user and payment_source = 'qris_simulation'
      and ref_id like (v_prefix || ':%')
    order by created_at
    for update
  loop
    if v_item.product_id is not null then
      select * into v_product
      from public.products
      where id = v_item.product_id and user_id = v_user
      for update;
      if found and v_product.lacak_stok then
        update public.products
        set stok = stok + greatest(coalesce(v_item.qty,1),1), updated_at = now()
        where id = v_product.id and user_id = v_user;
        insert into public.inventory_movements(
          user_id, product_id, movement_type, quantity_delta, unit_cost,
          total_cost, reference_key, note
        ) values (
          v_user, v_product.id, 'return_in', greatest(coalesce(v_item.qty,1),1),
          v_product.harga_pokok,
          round(greatest(coalesce(v_item.qty,1),1) * v_product.harga_pokok,2),
          'qris-sim-void:' || v_item.id::text,
          'Pembatalan QRIS simulasi; stok dikembalikan tanpa jurnal penyesuaian'
        ) on conflict (user_id, reference_key) where reference_key is not null do nothing;
      end if;
    end if;

    delete from public.journal_entries
    where user_id = v_user and source_type = 'transaction' and source_id = v_item.id::text;
    v_ids := v_ids || jsonb_build_array(v_item.id);
    v_count := v_count + 1;
  end loop;

  delete from public.transactions
  where user_id = v_user and payment_source = 'qris_simulation'
    and ref_id like (v_prefix || ':%');

  update public.qris_invoice_drafts
  set status = 'cancelled', confirmation_method = 'reversed', updated_at = now()
  where user_id = v_user and id::text = v_reference and status = 'paid_manual';

  return jsonb_build_object(
    'ok', true,
    'already_cancelled', false,
    'cancelled_count', v_count,
    'transaction_ids', v_ids,
    'reference', v_reference
  );
end;
$$;

revoke all on function public.cancel_qris_payment_simulation(uuid) from public, anon;
grant execute on function public.cancel_qris_payment_simulation(uuid) to authenticated;

commit;
