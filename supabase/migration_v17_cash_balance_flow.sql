-- CAVA: saldo awal usaha, saldo kas/bank berjalan, dan setoran modal.
-- Jalankan setelah migration_v16_hapus_produk.sql.

begin;

-- Penanda bahwa pemilik sudah mengonfirmasi saldo awal kas dan bank/QRIS.
-- Satu baris per akun; saldo berikutnya dihitung dari jurnal, bukan diinput ulang tiap hari.
create table if not exists public.business_opening_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cash_amount numeric(16,2) not null default 0 check (cash_amount >= 0),
  bank_amount numeric(16,2) not null default 0 check (bank_amount >= 0),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  recorded_at timestamptz not null default now()
);

alter table public.business_opening_balances enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='business_opening_balances'
      and policyname='business_opening_balances_select_own'
  ) then
    create policy business_opening_balances_select_own
      on public.business_opening_balances
      for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.business_opening_balances from public, anon;
grant select on public.business_opening_balances to authenticated;
revoke insert, update, delete on public.business_opening_balances from authenticated;

-- Mengambil saldo buku kas dan bank/QRIS sebelum tanggal yang diminta.
-- Parameter tanggal bersifat eksklusif: p_before_date = hari ini berarti saldo
-- penutupan sampai dengan kemarin.
create or replace function public.get_business_cash_balances(
  p_before_date date default ((now() at time zone 'Asia/Jakarta')::date)
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cash numeric(16,2) := 0;
  v_bank numeric(16,2) := 0;
  v_setup boolean := false;
  v_date date := coalesce(p_before_date, (now() at time zone 'Asia/Jakarta')::date);
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;

  select exists (
    select 1 from public.business_opening_balances where user_id=v_user
  ) into v_setup;

  select
    coalesce(sum(jl.debit-jl.credit) filter (where jl.account_code='1000'),0),
    coalesce(sum(jl.debit-jl.credit) filter (where jl.account_code='1010'),0)
  into v_cash,v_bank
  from public.journal_lines jl
  join public.journal_entries je on je.id=jl.entry_id and je.user_id=jl.user_id
  where jl.user_id=v_user and je.entry_date < v_date;

  return jsonb_build_object(
    'setup_complete',v_setup,
    'cash_balance',v_cash,
    'bank_balance',v_bank,
    'before_date',v_date
  );
end $$;

-- Rekonsiliasi saldo aktual pertama kali.
-- Selisih dicatat ke akun 3900 (Saldo Awal/Penyesuaian), sehingga laporan lama
-- tetap utuh, tetapi saldo Kas dan Bank/QRIS setelah penyesuaian sama dengan
-- angka aktual yang dikonfirmasi pemilik.
create or replace function public.set_business_opening_balances(
  p_cash_amount numeric,
  p_bank_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cash_book numeric(16,2) := 0;
  v_bank_book numeric(16,2) := 0;
  v_cash_delta numeric(16,2);
  v_bank_delta numeric(16,2);
  v_asset_delta numeric(16,2);
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
  v_entry_id uuid;
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if p_cash_amount is null or p_bank_amount is null
     or p_cash_amount < 0 or p_bank_amount < 0
     or p_cash_amount > 100000000000 or p_bank_amount > 100000000000
     or round(p_cash_amount,2) <> p_cash_amount
     or round(p_bank_amount,2) <> p_bank_amount then
    raise exception 'invalid_opening_balance';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));
  if exists (select 1 from public.business_opening_balances where user_id=v_user) then
    raise exception 'opening_balance_already_set';
  end if;

  -- Hitung seluruh mutasi buku sampai saat saldo awal dikonfirmasi,
  -- termasuk transaksi hari ini yang mungkin sudah tercatat di sistem lama.
  select
    coalesce(sum(jl.debit-jl.credit) filter (where jl.account_code='1000'),0),
    coalesce(sum(jl.debit-jl.credit) filter (where jl.account_code='1010'),0)
  into v_cash_book,v_bank_book
  from public.journal_lines jl
  join public.journal_entries je on je.id=jl.entry_id and je.user_id=jl.user_id
  where jl.user_id=v_user and je.entry_date <= v_date;

  v_cash_delta := round(p_cash_amount-v_cash_book,2);
  v_bank_delta := round(p_bank_amount-v_bank_book,2);
  v_asset_delta := round(v_cash_delta+v_bank_delta,2);

  if v_cash_delta > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','1000','name','Kas','type','asset','debit',v_cash_delta,'credit',0));
  elsif v_cash_delta < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','1000','name','Kas','type','asset','debit',0,'credit',abs(v_cash_delta)));
  end if;

  if v_bank_delta > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','1010','name','Bank / QRIS','type','asset','debit',v_bank_delta,'credit',0));
  elsif v_bank_delta < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','1010','name','Bank / QRIS','type','asset','debit',0,'credit',abs(v_bank_delta)));
  end if;

  if v_asset_delta > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian','type','equity','debit',0,'credit',v_asset_delta));
  elsif v_asset_delta < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian','type','equity','debit',abs(v_asset_delta),'credit',0));
  end if;

  if jsonb_array_length(v_lines) >= 2 then
    v_result := public.post_accounting_journal(
      v_user,
      'opening_balance',
      v_user::text,
      'Penyesuaian saldo awal kas dan bank/QRIS',
      v_lines,
      v_date
    );
    v_entry_id := nullif(v_result->>'entry_id','')::uuid;
  end if;

  insert into public.business_opening_balances(user_id,cash_amount,bank_amount,journal_entry_id)
  values(v_user,p_cash_amount,p_bank_amount,v_entry_id);

  return jsonb_build_object(
    'ok',true,
    'cash_balance',p_cash_amount,
    'bank_balance',p_bank_amount,
    'cash_adjustment',v_cash_delta,
    'bank_adjustment',v_bank_delta,
    'entry_id',v_entry_id
  );
end $$;

revoke all on function public.get_business_cash_balances(date) from public,anon;
grant execute on function public.get_business_cash_balances(date) to authenticated;
revoke all on function public.set_business_opening_balances(numeric,numeric) from public,anon;
grant execute on function public.set_business_opening_balances(numeric,numeric) to authenticated;

-- Transaksi pengeluaran sekarang mengurangi akun sesuai metode pembayaran.
-- Data historis tetap mengikuti jurnal yang sudah diposting; perubahan berlaku
-- untuk transaksi baru setelah migrasi.
create or replace function public.post_actual_transaction_accounting(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_product public.products%rowtype;
  v_lines jsonb;
  v_cash_code text;
  v_cash_name text;
  v_revenue_code text;
  v_revenue_name text;
  v_cost numeric(16,2):=0;
  v_inv_code text;
  v_inv_name text;
begin
  select * into v_tx from public.transactions where id=p_transaction_id;
  if not found then
    return jsonb_build_object('ok',false,'error','transaction_not_found');
  end if;

  v_cash_code := case
    when v_tx.metode='qris'
      or v_tx.payment_source in ('gopay_macrodroid','belibayar_sandbox')
    then '1010' else '1000' end;
  v_cash_name := case when v_cash_code='1010' then 'Bank / QRIS' else 'Kas' end;

  if v_tx.jenis='biaya' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code','6000','name','Beban Operasional','type','expense','debit',v_tx.jumlah,'credit',0),
      jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',v_tx.jumlah)
    );
  else
    v_revenue_code:='4000';
    v_revenue_name:='Pendapatan Penjualan';
    if v_tx.product_id is not null then
      select * into v_product
      from public.products
      where id=v_tx.product_id and user_id=v_tx.user_id;

      if found and v_product.jenis_item='service' then
        v_revenue_code:='4100';
        v_revenue_name:='Pendapatan Jasa';
      elsif found and v_product.lacak_stok and v_product.jenis_item in ('merchandise','finished_good') then
        v_cost:=round(coalesce(v_product.harga_pokok,0)*greatest(coalesce(v_tx.qty,1),1),2);
        v_inv_code:=case when v_product.jenis_item='finished_good' then '1230' else '1200' end;
        v_inv_name:=case when v_product.jenis_item='finished_good' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
      end if;
    end if;

    v_lines:=jsonb_build_array(
      jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',v_tx.jumlah,'credit',0),
      jsonb_build_object('code',v_revenue_code,'name',v_revenue_name,'type','revenue','debit',0,'credit',v_tx.jumlah)
    );
    if v_cost>0 then
      v_lines:=v_lines||jsonb_build_array(
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
end $$;

commit;
