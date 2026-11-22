-- Migration v21: kategori biaya (bahan produksi vs operasional) tanpa resep dan tanpa HPP per unit.
-- Pemilik cukup mencatat pembelian bahan; sistem membedakannya dari beban operasional sehingga laporan
-- bisa membandingkan biaya bahan dengan pendapatan penjualan. Angkanya estimasi sederhana: biaya bahan yang
-- dibeli, bukan bahan yang benar-benar terpakai (sisa persediaan tidak dihitung).
-- Aman dijalankan ulang. Jalankan di Supabase Dashboard -> SQL Editor.

alter table public.transactions
  add column if not exists kategori_biaya text,
  add column if not exists produk_terkait text;

alter table public.transactions drop constraint if exists transactions_kategori_biaya_check;
alter table public.transactions drop constraint if exists transactions_produk_terkait_len;
alter table public.transactions
  add constraint transactions_kategori_biaya_check check (kategori_biaya is null or kategori_biaya in ('bahan_produksi', 'operasional')),
  add constraint transactions_produk_terkait_len check (produk_terkait is null or char_length(produk_terkait) <= 100);

comment on column public.transactions.kategori_biaya is 'Untuk jenis biaya: bahan_produksi (masuk akun 5200) atau operasional (akun 6000). Kosong dianggap operasional.';
comment on column public.transactions.produk_terkait is 'Nama produk yang dibuat dari bahan ini (opsional, teks bebas).';

-- Jurnal transaksi: biaya bahan produksi tidak lagi seluruhnya dianggap beban operasional.
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
  v_expense_code text;
  v_expense_name text;
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transaction_not_found');
  end if;

  if v_tx.jenis = 'biaya' then
    v_expense_code := case when v_tx.kategori_biaya = 'bahan_produksi' then '5200' else '6000' end;
    v_expense_name := case when v_tx.kategori_biaya = 'bahan_produksi' then 'Biaya Bahan Produksi' else 'Beban Operasional' end;
    v_lines := jsonb_build_array(
      jsonb_build_object('code', v_expense_code, 'name', v_expense_name, 'type', 'expense', 'debit', v_tx.jumlah, 'credit', 0),
      jsonb_build_object('code', '1000', 'name', 'Kas', 'type', 'asset', 'debit', 0, 'credit', v_tx.jumlah)
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

-- Mengubah kategori biaya setelah dicatat (mis. Cashie bertanya "untuk bahan produksi atau operasional?").
-- Jurnal ikut dipindahkan antara akun 6000 dan 5200; jumlah dan keseimbangan debit-kredit tidak berubah.
create or replace function public.set_transaction_expense_category(
  p_transaction_id uuid,
  p_kategori text,
  p_produk text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_entry_id uuid;
  v_code text;
  v_name text;
  v_account_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_kategori is null or p_kategori not in ('bahan_produksi', 'operasional') then raise exception 'invalid_category'; end if;

  select * into v_tx from public.transactions where id = p_transaction_id and user_id = auth.uid();
  if not found then raise exception 'transaction_not_found'; end if;
  if v_tx.jenis <> 'biaya' then raise exception 'not_an_expense'; end if;

  update public.transactions
  set kategori_biaya = p_kategori,
      produk_terkait = nullif(left(btrim(coalesce(p_produk, '')), 100), '')
  where id = v_tx.id;

  v_code := case when p_kategori = 'bahan_produksi' then '5200' else '6000' end;
  v_name := case when p_kategori = 'bahan_produksi' then 'Biaya Bahan Produksi' else 'Beban Operasional' end;

  select id into v_entry_id
  from public.journal_entries
  where user_id = v_tx.user_id and source_type = 'transaction' and source_id = v_tx.id::text;

  if v_entry_id is not null then
    insert into public.accounting_accounts(user_id, code, name, account_type)
    values (v_tx.user_id, v_code, v_name, 'expense')
    on conflict (user_id, code) do update set name = excluded.name, account_type = excluded.account_type
    returning id into v_account_id;

    update public.journal_lines
    set account_id = v_account_id, account_code = v_code, account_name = v_name
    where entry_id = v_entry_id and user_id = v_tx.user_id and account_type = 'expense' and account_code in ('6000', '5200');
  end if;

  return jsonb_build_object('ok', true, 'kategori', p_kategori);
end;
$$;

revoke all on function public.set_transaction_expense_category(uuid, text, text) from public, anon;
grant execute on function public.set_transaction_expense_category(uuid, text, text) to authenticated;
