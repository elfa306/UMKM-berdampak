-- UMKM Berdampak - Tahap 10: General Ledger dan laporan keuangan.
-- Jalankan SETELAH migration_v12_manufacturing.sql.
-- Menggunakan jurnal berpasangan (debit/kredit), posting idempoten, dan RLS per pemilik/sesi.
-- Tidak menghapus transaksi lama. Saldo harian/modal_harian lama tidak otomatis dianggap biaya.

begin;

-- -----------------------------------------------------------------------------
-- A. Chart of Accounts dan jurnal akun produksi.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check(account_type in ('asset','liability','equity','contra_equity','revenue','expense')),
  created_at timestamptz not null default now(),
  unique(user_id,code)
);
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_no text not null,
  source_type text not null,
  source_id text not null,
  entry_date date not null default current_date,
  description text not null,
  created_at timestamptz not null default now(),
  unique(user_id,entry_no),
  unique(user_id,source_type,source_id)
);
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  account_code text not null,
  account_name text not null,
  account_type text not null check(account_type in ('asset','liability','equity','contra_equity','revenue','expense')),
  description text,
  debit numeric(16,2) not null default 0 check(debit>=0),
  credit numeric(16,2) not null default 0 check(credit>=0),
  created_at timestamptz not null default now(),
  check (not (debit>0 and credit>0)),
  check (debit>0 or credit>0)
);
create index if not exists accounting_accounts_user_code_idx on public.accounting_accounts(user_id,code);
create index if not exists journal_entries_user_date_idx on public.journal_entries(user_id,entry_date desc,created_at desc);
create index if not exists journal_lines_entry_idx on public.journal_lines(user_id,entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines(user_id,account_code,created_at desc);

alter table public.accounting_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounting_accounts' and policyname='accounting_accounts_select_own') then
    create policy accounting_accounts_select_own on public.accounting_accounts for select to authenticated using((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='journal_entries' and policyname='journal_entries_select_own') then
    create policy journal_entries_select_own on public.journal_entries for select to authenticated using((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='journal_lines' and policyname='journal_lines_select_own') then
    create policy journal_lines_select_own on public.journal_lines for select to authenticated using((select auth.uid())=user_id);
  end if;
end $$;
revoke all on public.accounting_accounts,public.journal_entries,public.journal_lines from anon;
grant select on public.accounting_accounts,public.journal_entries,public.journal_lines to authenticated;
revoke insert,update,delete on public.accounting_accounts,public.journal_entries,public.journal_lines from authenticated;

-- Accounts used by both retail and manufacturing. Accounts are created lazily when posted.
create or replace function public.post_accounting_journal(
  p_user_id uuid,p_source_type text,p_source_id text,p_description text,p_lines jsonb,p_entry_date date default current_date
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_entry public.journal_entries%rowtype; v_entry_id uuid; v_line jsonb; v_account_id uuid;
  v_code text; v_name text; v_type text; v_debit numeric(16,2); v_credit numeric(16,2);
  v_total_debit numeric(16,2):=0; v_total_credit numeric(16,2):=0; v_count integer:=0;
begin
  if p_user_id is null or p_source_type is null or length(p_source_type)>40 or p_source_id is null or length(p_source_id)>160 then raise exception 'invalid_journal_source'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>20 then raise exception 'invalid_journal_lines'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_code:=v_line->>'code'; v_name:=left(coalesce(v_line->>'name',''),100); v_type:=v_line->>'type';
    begin v_debit:=coalesce((v_line->>'debit')::numeric,0); v_credit:=coalesce((v_line->>'credit')::numeric,0); exception when others then raise exception 'invalid_journal_amount'; end;
    if v_code is null or length(v_code)>20 or v_name='' or v_type is null or v_type not in ('asset','liability','equity','contra_equity','revenue','expense') or v_debit<0 or v_credit<0 or (v_debit>0 and v_credit>0) or (v_debit=0 and v_credit=0) then raise exception 'invalid_journal_line'; end if;
    v_total_debit:=v_total_debit+v_debit; v_total_credit:=v_total_credit+v_credit; v_count:=v_count+1;
  end loop;
  if abs(v_total_debit-v_total_credit)>0.01 then raise exception 'journal_not_balanced'; end if;

  insert into public.journal_entries(user_id,entry_no,source_type,source_id,entry_date,description)
  values(p_user_id,'JRN-'||to_char(coalesce(p_entry_date,current_date),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),p_source_type,p_source_id,coalesce(p_entry_date,current_date),left(coalesce(p_description,'Jurnal otomatis'),250))
  on conflict(user_id,source_type,source_id) do nothing returning id into v_entry_id;
  if v_entry_id is null then
    select * into v_entry from public.journal_entries where user_id=p_user_id and source_type=p_source_type and source_id=p_source_id;
    return jsonb_build_object('ok',true,'duplicate',true,'entry_id',v_entry.id);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_code:=v_line->>'code'; v_name:=left(v_line->>'name',100); v_type:=v_line->>'type';
    v_debit:=coalesce((v_line->>'debit')::numeric,0); v_credit:=coalesce((v_line->>'credit')::numeric,0);
    insert into public.accounting_accounts(user_id,code,name,account_type)
    values(p_user_id,v_code,v_name,v_type)
    on conflict(user_id,code) do update set name=excluded.name,account_type=excluded.account_type
    returning id into v_account_id;
    insert into public.journal_lines(user_id,entry_id,account_id,account_code,account_name,account_type,description,debit,credit)
    values(p_user_id,v_entry_id,v_account_id,v_code,v_name,v_type,left(coalesce(v_line->>'description',''),200),v_debit,v_credit);
  end loop;
  return jsonb_build_object('ok',true,'duplicate',false,'entry_id',v_entry_id,'total_debit',v_total_debit,'total_credit',v_total_credit);
end $$;
revoke all on function public.post_accounting_journal(uuid,text,text,text,jsonb,date) from public,anon,authenticated;
grant execute on function public.post_accounting_journal(uuid,text,text,text,jsonb,date) to service_role;

create or replace function public.create_accounting_manual_entry(
  p_kind text,p_amount numeric,p_description text,p_payment_account text default '1000'
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_source text:=gen_random_uuid()::text; v_lines jsonb; v_cash_code text; v_cash_name text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_amount is null or p_amount<=0 or p_amount>100000000000 or round(p_amount,2)<>p_amount then raise exception 'invalid_amount'; end if;
  if p_kind not in ('expense','capital','draw','supplier_payment','labor_payment','overhead_payment') then raise exception 'invalid_manual_entry_kind'; end if;
  if p_payment_account not in ('1000','1010') then raise exception 'invalid_payment_account'; end if;
  v_cash_code:=p_payment_account; v_cash_name:=case when p_payment_account='1010' then 'Bank / QRIS' else 'Kas' end;
  if p_kind='expense' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','6000','name','Beban Operasional','type','expense','debit',p_amount,'credit',0),jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='capital' then
    v_lines:=jsonb_build_array(jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',p_amount,'credit',0),jsonb_build_object('code','3000','name','Modal Pemilik','type','equity','debit',0,'credit',p_amount));
  elsif p_kind='draw' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','3100','name','Prive / Pengambilan Pemilik','type','contra_equity','debit',p_amount,'credit',0),jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='supplier_payment' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='labor_payment' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','2110','name','Utang Tenaga Kerja Langsung','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='overhead_payment' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','2120','name','Utang Biaya Overhead Produksi','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',0,'credit',p_amount));
  end if;
  return public.post_accounting_journal(v_user,'manual',v_source,left(coalesce(p_description,p_kind),250),v_lines,current_date);
end $$;
revoke all on function public.create_accounting_manual_entry(text,numeric,text,text) from public,anon;
grant execute on function public.create_accounting_manual_entry(text,numeric,text,text) to authenticated;

-- -----------------------------------------------------------------------------
-- B. Posting otomatis dari transaksi, pembelian, mutasi stok dan produksi.
-- -----------------------------------------------------------------------------
create or replace function public.post_actual_transaction_accounting(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tx public.transactions%rowtype; v_product public.products%rowtype; v_lines jsonb; v_cash_code text; v_cash_name text; v_revenue_code text; v_revenue_name text; v_cost numeric(16,2):=0; v_inv_code text; v_inv_name text;
begin
  select * into v_tx from public.transactions where id=p_transaction_id;
  if not found then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.jenis='biaya' then
    v_lines:=jsonb_build_array(jsonb_build_object('code','6000','name','Beban Operasional','type','expense','debit',v_tx.jumlah,'credit',0),jsonb_build_object('code','1000','name','Kas','type','asset','debit',0,'credit',v_tx.jumlah));
  else
    v_cash_code:=case when v_tx.metode='qris' or v_tx.payment_source='gopay_macrodroid' or v_tx.payment_source='belibayar_sandbox' then '1010' else '1000' end;
    v_cash_name:=case when v_cash_code='1010' then 'Bank / QRIS' else 'Kas' end;
    v_revenue_code:='4000'; v_revenue_name:='Pendapatan Penjualan';
    if v_tx.product_id is not null then
      select * into v_product from public.products where id=v_tx.product_id and user_id=v_tx.user_id;
      if found and v_product.jenis_item='service' then v_revenue_code:='4100'; v_revenue_name:='Pendapatan Jasa';
      elsif found and v_product.lacak_stok and v_product.jenis_item in ('merchandise','finished_good') then
        v_cost:=round(coalesce(v_product.harga_pokok,0)*greatest(coalesce(v_tx.qty,1),1),2);
        v_inv_code:=case when v_product.jenis_item='finished_good' then '1230' else '1200' end;
        v_inv_name:=case when v_product.jenis_item='finished_good' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
      end if;
    end if;
    v_lines:=jsonb_build_array(jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',v_tx.jumlah,'credit',0),jsonb_build_object('code',v_revenue_code,'name',v_revenue_name,'type','revenue','debit',0,'credit',v_tx.jumlah));
    if v_cost>0 then
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5000','name','Harga Pokok Penjualan','type','expense','debit',v_cost,'credit',0),jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',0,'credit',v_cost));
    end if;
  end if;
  return public.post_accounting_journal(v_tx.user_id,'transaction',v_tx.id::text,coalesce(v_tx.keterangan,'Transaksi'),v_lines,(v_tx.created_at at time zone 'Asia/Jakarta')::date);
end $$;

create or replace function public.trg_actual_transaction_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.post_actual_transaction_accounting(new.id); return new; end $$;
create trigger transactions_post_accounting after insert on public.transactions for each row execute function public.trg_actual_transaction_accounting();

create or replace function public.trg_actual_purchase_item_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product public.products%rowtype; v_inv_code text; v_inv_name text; v_amount numeric(16,2);
begin
  select * into v_product from public.products where id=new.product_id and user_id=new.user_id;
  if not found then return new; end if;
  v_inv_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_inv_name:=case v_inv_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  v_amount:=new.subtotal;
  if v_amount<=0 then return new; end if;
  perform public.post_accounting_journal(new.user_id,'stock_purchase_item',new.id::text,'Pembelian persediaan: '||new.nama_snapshot,
    jsonb_build_array(jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',v_amount,'credit',0),jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',0,'credit',v_amount)),(new.created_at at time zone 'Asia/Jakarta')::date);
  return new;
end $$;
create trigger stock_purchase_items_post_accounting after insert on public.stock_purchase_items for each row execute function public.trg_actual_purchase_item_accounting();

create or replace function public.trg_actual_inventory_adjustment_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product public.products%rowtype; v_inv_code text; v_inv_name text; v_amount numeric(16,2);
begin
  if new.movement_type not in ('opening','adjustment_in','adjustment_out','return_in','return_out','waste') then return new; end if;
  select * into v_product from public.products where id=new.product_id and user_id=new.user_id;
  if not found then return new; end if;
  v_inv_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_inv_name:=case v_inv_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  v_amount:=coalesce(nullif(new.total_cost,0),abs(new.quantity_delta)*coalesce(new.unit_cost,v_product.harga_pokok,0));
  if v_amount<=0 then return new; end if;
  if new.movement_type='opening' or new.movement_type='adjustment_in' or new.movement_type='return_in' then
    perform public.post_accounting_journal(new.user_id,'inventory_movement',new.id::text,'Saldo/mutasi masuk: '||v_product.nama,
      jsonb_build_array(jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',v_amount,'credit',0),jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian Persediaan','type','equity','debit',0,'credit',v_amount)),(new.created_at at time zone 'Asia/Jakarta')::date);
  else
    perform public.post_accounting_journal(new.user_id,'inventory_movement',new.id::text,'Pengurangan persediaan: '||v_product.nama,
      jsonb_build_array(jsonb_build_object('code','7000','name','Kerugian/Penyusutan Persediaan','type','expense','debit',v_amount,'credit',0),jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',0,'credit',v_amount)),(new.created_at at time zone 'Asia/Jakarta')::date);
  end if;
  return new;
end $$;
create trigger inventory_movements_post_accounting after insert on public.inventory_movements for each row execute function public.trg_actual_inventory_adjustment_accounting();

create or replace function public.post_actual_production_batch_accounting(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_batch public.production_batches%rowtype;
  v_lines jsonb;
  v_component record;
  v_code text;
  v_name text;
  v_material_total numeric(16,2):=0;
begin
  select * into v_batch from public.production_batches where id=p_batch_id;
  if not found or v_batch.status<>'completed' then return jsonb_build_object('ok',true,'skipped',true); end if;
  if v_batch.total_cost<=0 then return jsonb_build_object('ok',true,'skipped',true,'reason','zero_cost_batch'); end if;
  v_lines:=jsonb_build_array(jsonb_build_object('code','1230','name','Persediaan Barang Jadi','type','asset','debit',v_batch.total_cost,'credit',0));
  -- Read the recipe snapshot inputs. The batch row is inserted before batch-item detail rows in v12 RPC.
  for v_component in
    select p.jenis_item, sum(round(round(ri.qty_per_batch*v_batch.batch_count,3)*p.harga_pokok,2))::numeric(16,2) amount
    from public.production_recipe_items ri
    join public.products p on p.id=ri.input_product_id and p.user_id=ri.user_id
    where ri.user_id=v_batch.user_id and ri.recipe_id=v_batch.recipe_id
    group by p.jenis_item
  loop
    if v_component.amount<=0 then continue; end if;
    v_material_total:=v_material_total+v_component.amount;
    v_code:=case v_component.jenis_item when 'work_in_progress' then '1220' else '1210' end;
    v_name:=case v_code when '1220' then 'Persediaan Barang Dalam Proses' else 'Persediaan Bahan Baku' end;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',v_component.amount));
  end loop;
  if v_batch.direct_labor_cost>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2110','name','Utang Tenaga Kerja Langsung','type','liability','debit',0,'credit',v_batch.direct_labor_cost)); end if;
  if v_batch.overhead_cost>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2120','name','Utang Biaya Overhead','type','liability','debit',0,'credit',v_batch.overhead_cost)); end if;
  if abs(v_material_total+v_batch.direct_labor_cost+v_batch.overhead_cost-v_batch.total_cost)>0.01 then raise exception 'production_cost_breakdown_mismatch'; end if;
  return public.post_accounting_journal(v_batch.user_id,'production_batch',v_batch.id::text,'Penyelesaian produksi batch '||v_batch.batch_no,v_lines,(v_batch.completed_at at time zone 'Asia/Jakarta')::date);
end $$;

create or replace function public.trg_actual_production_batch_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.post_actual_production_batch_accounting(new.id);
  return new;
end $$;
create trigger production_batches_post_accounting after insert on public.production_batches for each row execute function public.trg_actual_production_batch_accounting();

-- -----------------------------------------------------------------------------
-- C. Chart of Accounts, jurnal dan posting otomatis untuk sesi demo.
-- -----------------------------------------------------------------------------
create table if not exists public.demo_accounting_accounts (
  id uuid primary key default gen_random_uuid(),session_id uuid not null references public.demo_sessions(id) on delete cascade,
  code text not null,name text not null,account_type text not null check(account_type in ('asset','liability','equity','contra_equity','revenue','expense')),
  created_at timestamptz not null default now(),unique(session_id,code)
);
create table if not exists public.demo_journal_entries (
  id uuid primary key default gen_random_uuid(),session_id uuid not null references public.demo_sessions(id) on delete cascade,
  entry_no text not null,source_type text not null,source_id text not null,entry_date date not null default current_date,description text not null,created_at timestamptz not null default now(),
  unique(session_id,entry_no),unique(session_id,source_type,source_id)
);
create table if not exists public.demo_journal_lines (
  id uuid primary key default gen_random_uuid(),session_id uuid not null references public.demo_sessions(id) on delete cascade,
  entry_id uuid not null references public.demo_journal_entries(id) on delete cascade,account_id uuid not null references public.demo_accounting_accounts(id) on delete restrict,
  account_code text not null,account_name text not null,account_type text not null check(account_type in ('asset','liability','equity','contra_equity','revenue','expense')),
  description text,debit numeric(16,2) not null default 0 check(debit>=0),credit numeric(16,2) not null default 0 check(credit>=0),created_at timestamptz not null default now(),
  check(not(debit>0 and credit>0)),check(debit>0 or credit>0)
);
create index if not exists demo_journal_entries_session_date_idx on public.demo_journal_entries(session_id,entry_date desc,created_at desc);
create index if not exists demo_journal_lines_entry_idx on public.demo_journal_lines(session_id,entry_id);

create or replace function public.post_demo_accounting_journal(
  p_session_id uuid,p_source_type text,p_source_id text,p_description text,p_lines jsonb,p_entry_date date default current_date
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.demo_journal_entries%rowtype; v_entry_id uuid; v_line jsonb; v_account_id uuid;
  v_code text;v_name text;v_type text;v_debit numeric(16,2);v_credit numeric(16,2);v_td numeric(16,2):=0;v_tc numeric(16,2):=0;
begin
  if p_source_type is null or length(p_source_type)>40 or p_source_id is null or length(p_source_id)>160 then raise exception 'invalid_journal_source'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>20 then raise exception 'invalid_journal_lines'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_code:=v_line->>'code';v_name:=left(coalesce(v_line->>'name',''),100);v_type:=v_line->>'type';
    begin v_debit:=coalesce((v_line->>'debit')::numeric,0);v_credit:=coalesce((v_line->>'credit')::numeric,0);exception when others then raise exception 'invalid_journal_amount';end;
    if v_code is null or v_name='' or v_type is null or v_type not in ('asset','liability','equity','contra_equity','revenue','expense') or v_debit<0 or v_credit<0 or (v_debit>0 and v_credit>0) or (v_debit=0 and v_credit=0) then raise exception 'invalid_journal_line';end if;
    v_td:=v_td+v_debit;v_tc:=v_tc+v_credit;
  end loop;
  if abs(v_td-v_tc)>0.01 then raise exception 'journal_not_balanced';end if;
  insert into public.demo_journal_entries(session_id,entry_no,source_type,source_id,entry_date,description)
  values(p_session_id,'DEMO-JRN-'||to_char(coalesce(p_entry_date,current_date),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),p_source_type,p_source_id,coalesce(p_entry_date,current_date),left(coalesce(p_description,'Jurnal demo'),250))
  on conflict(session_id,source_type,source_id) do nothing returning id into v_entry_id;
  if v_entry_id is null then select * into v_entry from public.demo_journal_entries where session_id=p_session_id and source_type=p_source_type and source_id=p_source_id;return jsonb_build_object('ok',true,'duplicate',true,'entry_id',v_entry.id);end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_code:=v_line->>'code';v_name:=left(v_line->>'name',100);v_type:=v_line->>'type';v_debit:=coalesce((v_line->>'debit')::numeric,0);v_credit:=coalesce((v_line->>'credit')::numeric,0);
    insert into public.demo_accounting_accounts(session_id,code,name,account_type) values(p_session_id,v_code,v_name,v_type)
    on conflict(session_id,code) do update set name=excluded.name,account_type=excluded.account_type returning id into v_account_id;
    insert into public.demo_journal_lines(session_id,entry_id,account_id,account_code,account_name,account_type,description,debit,credit)
    values(p_session_id,v_entry_id,v_account_id,v_code,v_name,v_type,left(coalesce(v_line->>'description',''),200),v_debit,v_credit);
  end loop;
  return jsonb_build_object('ok',true,'duplicate',false,'entry_id',v_entry_id,'total_debit',v_td,'total_credit',v_tc);
end $$;
revoke all on function public.post_demo_accounting_journal(uuid,text,text,text,jsonb,date) from public,anon,authenticated;
grant execute on function public.post_demo_accounting_journal(uuid,text,text,text,jsonb,date) to service_role;

create or replace function public.post_demo_order_accounting(p_order_id uuid,p_include_seeded boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.demo_orders%rowtype; v_lines jsonb; v_cash_code text;v_cash_name text;v_item record;v_cogs numeric(16,2);v_inv_code text;v_inv_name text;v_cogs_type text;
begin
  select * into v_order from public.demo_orders where id=p_order_id;
  if not found or v_order.status<>'paid' or (coalesce(v_order.is_seeded,false) and not p_include_seeded) then return jsonb_build_object('ok',true,'skipped',true); end if;
  v_cash_code:=case when coalesce(v_order.payment_method,'') ilike '%tunai%' or v_order.payment_source='cash_simulation' then '1000' else '1010' end;
  v_cash_name:=case when v_cash_code='1000' then 'Kas' else 'Bank / QRIS' end;
  v_lines:=jsonb_build_array(jsonb_build_object('code',v_cash_code,'name',v_cash_name,'type','asset','debit',v_order.total,'credit',0),jsonb_build_object('code','4000','name','Pendapatan Penjualan','type','revenue','debit',0,'credit',v_order.total));
  if not (coalesce(v_order.metadata->>'unallocated_static_qris','false')='true') then
    for v_item in
      select p.jenis_item,sum(i.qty*i.harga_pokok)::numeric(16,2) amount
      from public.demo_order_items i left join public.demo_products p on p.id=i.product_id and p.session_id=i.session_id
      where i.session_id=v_order.session_id and i.order_id=v_order.id
      group by p.jenis_item
    loop
      v_cogs:=coalesce(v_item.amount,0);
      if v_cogs<=0 then continue;end if;
      if v_item.jenis_item='service' then
        v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5100','name','Biaya Langsung Jasa','type','expense','debit',v_cogs,'credit',0),jsonb_build_object('code','2110','name','Utang Tenaga Kerja Langsung','type','liability','debit',0,'credit',v_cogs));
      else
        v_inv_code:=case when v_item.jenis_item='finished_good' then '1230' else '1200' end;
        v_inv_name:=case when v_inv_code='1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
        v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5000','name','Harga Pokok Penjualan','type','expense','debit',v_cogs,'credit',0),jsonb_build_object('code',v_inv_code,'name',v_inv_name,'type','asset','debit',0,'credit',v_cogs));
      end if;
    end loop;
  end if;
  return public.post_demo_accounting_journal(v_order.session_id,'sale_order',v_order.id::text,'Penjualan invoice '||v_order.invoice_no,v_lines,(coalesce(v_order.paid_at,v_order.created_at) at time zone 'Asia/Jakarta')::date);
end $$;

create or replace function public.trg_demo_order_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    if new.status='paid' and not coalesce(new.is_seeded,false) then
      perform public.post_demo_order_accounting(new.id);
    end if;
  elsif tg_op='UPDATE' then
    if new.status='paid' and not coalesce(new.is_seeded,false) and old.status is distinct from 'paid' then
      perform public.post_demo_order_accounting(new.id);
    end if;
  end if;
  return new;
end $$;
create trigger demo_orders_post_accounting after insert or update of status on public.demo_orders for each row execute function public.trg_demo_order_accounting();

create or replace function public.trg_demo_purchase_item_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product public.demo_products%rowtype;v_code text;v_name text;
begin
  select * into v_product from public.demo_products where id=new.product_id and session_id=new.session_id;
  if not found then return new;end if;
  if coalesce(new.subtotal,0)<=0 then return new; end if;
  v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  perform public.post_demo_accounting_journal(new.session_id,'stock_purchase_item',new.id::text,'Pembelian persediaan: '||new.nama_snapshot,
    jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',new.subtotal,'credit',0),jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',0,'credit',new.subtotal)),(new.created_at at time zone 'Asia/Jakarta')::date);
  return new;
end $$;
create trigger demo_stock_purchase_items_post_accounting after insert on public.demo_stock_purchase_items for each row execute function public.trg_demo_purchase_item_accounting();

create or replace function public.trg_demo_inventory_adjustment_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product public.demo_products%rowtype;v_code text;v_name text;v_amount numeric(16,2);
begin
  if new.movement_type not in ('opening','adjustment','waste','restock') then return new;end if;
  if new.movement_type='restock' and new.note not ilike '%retur%' then return new;end if;
  select * into v_product from public.demo_products where id=new.product_id and session_id=new.session_id;
  if not found then return new;end if;
  v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  v_amount:=round(abs(new.quantity_delta)*coalesce(v_product.harga_pokok,0),2);if v_amount<=0 then return new;end if;
  if new.movement_type='opening' or new.movement_type='restock' then
    perform public.post_demo_accounting_journal(new.session_id,'inventory_movement',new.id::text,'Saldo/mutasi masuk: '||v_product.nama,
      jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',v_amount,'credit',0),jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian Persediaan','type','equity','debit',0,'credit',v_amount)),(new.created_at at time zone 'Asia/Jakarta')::date);
  else
    perform public.post_demo_accounting_journal(new.session_id,'inventory_movement',new.id::text,'Penyusutan persediaan: '||v_product.nama,
      jsonb_build_array(jsonb_build_object('code','7000','name','Kerugian/Penyusutan Persediaan','type','expense','debit',v_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',v_amount)),(new.created_at at time zone 'Asia/Jakarta')::date);
  end if;
  return new;
end $$;
create trigger demo_inventory_movements_post_accounting after insert on public.demo_inventory_movements for each row execute function public.trg_demo_inventory_adjustment_accounting();

create or replace function public.post_demo_production_batch_accounting(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_batch public.demo_production_batches%rowtype;
  v_lines jsonb;
  v_component record;
  v_code text;
  v_name text;
  v_material_total numeric(16,2):=0;
begin
  select * into v_batch from public.demo_production_batches where id=p_batch_id;
  if not found or v_batch.status<>'completed' then return jsonb_build_object('ok',true,'skipped',true); end if;
  if v_batch.total_cost<=0 then return jsonb_build_object('ok',true,'skipped',true,'reason','zero_cost_batch'); end if;
  v_lines:=jsonb_build_array(jsonb_build_object('code','1230','name','Persediaan Barang Jadi','type','asset','debit',v_batch.total_cost,'credit',0));
  -- Recipe inputs exist before batch insert; detail batch-item rows are inserted afterward by the v12 RPC.
  for v_component in
    select p.jenis_item, sum(round(round(ri.qty_per_batch*v_batch.batch_count,3)*p.harga_pokok,2))::numeric(16,2) amount
    from public.demo_production_recipe_items ri
    join public.demo_products p on p.id=ri.input_product_id and p.session_id=ri.session_id
    where ri.session_id=v_batch.session_id and ri.recipe_id=v_batch.recipe_id
    group by p.jenis_item
  loop
    if v_component.amount<=0 then continue; end if;
    v_material_total:=v_material_total+v_component.amount;
    v_code:=case v_component.jenis_item when 'work_in_progress' then '1220' else '1210' end;
    v_name:=case v_code when '1220' then 'Persediaan Barang Dalam Proses' else 'Persediaan Bahan Baku' end;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',v_component.amount));
  end loop;
  if v_batch.direct_labor_cost>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2110','name','Utang Tenaga Kerja Langsung','type','liability','debit',0,'credit',v_batch.direct_labor_cost)); end if;
  if v_batch.overhead_cost>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2120','name','Utang Biaya Overhead','type','liability','debit',0,'credit',v_batch.overhead_cost)); end if;
  if abs(v_material_total+v_batch.direct_labor_cost+v_batch.overhead_cost-v_batch.total_cost)>0.01 then raise exception 'production_cost_breakdown_mismatch'; end if;
  return public.post_demo_accounting_journal(v_batch.session_id,'production_batch',v_batch.id::text,'Penyelesaian produksi batch '||v_batch.batch_no,v_lines,(v_batch.completed_at at time zone 'Asia/Jakarta')::date);
end $$;

create or replace function public.trg_demo_production_batch_accounting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.post_demo_production_batch_accounting(new.id);
  return new;
end $$;
create trigger demo_production_batches_post_accounting after insert on public.demo_production_batches for each row execute function public.trg_demo_production_batch_accounting();

-- Manual accounting entries in demo mode.
create or replace function public.create_demo_accounting_manual_entry(
  p_session_id uuid,p_kind text,p_amount numeric,p_description text,p_payment_account text default '1000'
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lines jsonb;v_code text;v_name text;v_source text:=gen_random_uuid()::text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not_authorized';end if;
  if p_amount is null or p_amount<=0 or p_amount>100000000000 or round(p_amount,2)<>p_amount then raise exception 'invalid_amount';end if;
  if p_kind not in ('expense','capital','draw','supplier_payment','labor_payment','overhead_payment') or p_payment_account not in ('1000','1010') then raise exception 'invalid_manual_entry_kind';end if;
  v_code:=p_payment_account;v_name:=case when v_code='1010' then 'Bank / QRIS' else 'Kas' end;
  if p_kind='expense' then v_lines:=jsonb_build_array(jsonb_build_object('code','6000','name','Beban Operasional','type','expense','debit',p_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='capital' then v_lines:=jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',p_amount,'credit',0),jsonb_build_object('code','3000','name','Modal Pemilik','type','equity','debit',0,'credit',p_amount));
  elsif p_kind='draw' then v_lines:=jsonb_build_array(jsonb_build_object('code','3100','name','Prive / Pengambilan Pemilik','type','contra_equity','debit',p_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='supplier_payment' then v_lines:=jsonb_build_array(jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='labor_payment' then v_lines:=jsonb_build_array(jsonb_build_object('code','2110','name','Utang Tenaga Kerja Langsung','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',p_amount));
  elsif p_kind='overhead_payment' then v_lines:=jsonb_build_array(jsonb_build_object('code','2120','name','Utang Biaya Overhead Produksi','type','liability','debit',p_amount,'credit',0),jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',0,'credit',p_amount));end if;
  return public.post_demo_accounting_journal(p_session_id,'manual',v_source,left(coalesce(p_description,p_kind),250),v_lines,current_date);
end $$;

-- -----------------------------------------------------------------------------
-- D. RLS for demo ledgers and permissions.
-- -----------------------------------------------------------------------------
alter table public.demo_accounting_accounts enable row level security;
alter table public.demo_journal_entries enable row level security;
alter table public.demo_journal_lines enable row level security;
revoke all on public.demo_accounting_accounts,public.demo_journal_entries,public.demo_journal_lines from public,anon,authenticated;
grant all on public.demo_accounting_accounts,public.demo_journal_entries,public.demo_journal_lines to service_role;
revoke all on function public.create_demo_accounting_manual_entry(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_demo_accounting_manual_entry(uuid,text,numeric,text,text) to service_role;

-- -----------------------------------------------------------------------------
-- E. Backfill historis aman dan idempoten untuk aktivitas yang memiliki bukti transaksi.
-- Modal harian legacy sengaja tidak diposting otomatis karena belum tentu merupakan beban.
-- -----------------------------------------------------------------------------
-- Helper non-trigger untuk backfill pembelian aktual (trigger wrapper tetap dipakai untuk transaksi baru).
create or replace function public.trg_actual_purchase_item_accounting_row(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.stock_purchase_items%rowtype;v_product public.products%rowtype;v_code text;v_name text;
begin
  select * into v_item from public.stock_purchase_items where id=p_item_id;if not found then return jsonb_build_object('skipped',true);end if;
  select * into v_product from public.products where id=v_item.product_id and user_id=v_item.user_id;if not found then return jsonb_build_object('skipped',true);end if;
  v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  return public.post_accounting_journal(v_item.user_id,'stock_purchase_item',v_item.id::text,'Pembelian persediaan: '||v_item.nama_snapshot,
    jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',v_item.subtotal,'credit',0),jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',0,'credit',v_item.subtotal)),(v_item.created_at at time zone 'Asia/Jakarta')::date);
end $$;

-- Backfill production transactions and inventory-opening movements. Unique source keys prevent duplicates.
do $$
declare r record;v_product public.products%rowtype;v_code text;v_name text;v_amount numeric(16,2);
begin
  for r in select id from public.transactions loop perform public.post_actual_transaction_accounting(r.id); end loop;
  for r in select id from public.stock_purchase_items loop perform public.trg_actual_purchase_item_accounting_row(r.id); end loop;
  for r in select * from public.inventory_movements where movement_type='opening' loop
    select * into v_product from public.products where id=r.product_id and user_id=r.user_id;if not found then continue;end if;
    v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
    v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
    v_amount:=coalesce(nullif(r.total_cost,0),abs(r.quantity_delta)*coalesce(r.unit_cost,v_product.harga_pokok,0));
    if v_amount>0 then perform public.post_accounting_journal(r.user_id,'inventory_movement',r.id::text,'Saldo awal persediaan: '||v_product.nama,jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',v_amount,'credit',0),jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian Persediaan','type','equity','debit',0,'credit',v_amount)),(r.created_at at time zone 'Asia/Jakarta')::date);end if;
  end loop;
end $$;

-- Backfill all paid demo orders after their item rows exist (including seeded dashboard sales).
do $$
declare r record;begin for r in select id from public.demo_orders where status='paid' loop perform public.post_demo_order_accounting(r.id,true);end loop;end $$;

-- Helper for demo purchase backfill and trigger-compatible logic.
create or replace function public.trg_demo_purchase_item_accounting_row(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.demo_stock_purchase_items%rowtype;v_product public.demo_products%rowtype;v_code text;v_name text;
begin
  select * into v_item from public.demo_stock_purchase_items where id=p_item_id;if not found then return jsonb_build_object('skipped',true);end if;
  select * into v_product from public.demo_products where id=v_item.product_id and session_id=v_item.session_id;if not found then return jsonb_build_object('skipped',true);end if;
  v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
  v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
  return public.post_demo_accounting_journal(v_item.session_id,'stock_purchase_item',v_item.id::text,'Pembelian persediaan: '||v_item.nama_snapshot,jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',v_item.subtotal,'credit',0),jsonb_build_object('code','2000','name','Utang Usaha','type','liability','debit',0,'credit',v_item.subtotal)),(v_item.created_at at time zone 'Asia/Jakarta')::date);
end $$;

-- Backfill historical demo purchases after the helper is available.
do $$
declare r record;begin
  for r in select id from public.demo_stock_purchase_items loop
    perform public.trg_demo_purchase_item_accounting_row(r.id);
  end loop;
end $$;

-- Backfill production batches created before the accounting module was installed.
do $$
declare r record;
begin
  for r in select id from public.production_batches where status='completed' loop
    perform public.post_actual_production_batch_accounting(r.id);
  end loop;
  for r in select id from public.demo_production_batches where status='completed' loop
    perform public.post_demo_production_batch_accounting(r.id);
  end loop;
end $$;

-- Helper used after new demo sessions seed their sample orders.
create or replace function public.post_demo_seeded_order_journals(p_session_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; v_count integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not_authorized';end if;
  if not exists(select 1 from public.demo_sessions where id=p_session_id and status='active' and expires_at>now()) then raise exception 'demo_session_expired';end if;
  for r in select id from public.demo_orders where session_id=p_session_id and status='paid' and is_seeded=true loop
    perform public.post_demo_order_accounting(r.id,true); v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.post_demo_seeded_order_journals(uuid) from public,anon,authenticated;
grant execute on function public.post_demo_seeded_order_journals(uuid) to service_role;

-- Backfill demo opening inventory. Existing demo sales are already journaled above.
do $$
declare r record;v_product public.demo_products%rowtype;v_code text;v_name text;v_amount numeric(16,2);
begin
  for r in select * from public.demo_inventory_movements where movement_type='opening' loop
    select * into v_product from public.demo_products where id=r.product_id and session_id=r.session_id;if not found then continue;end if;
    v_code:=case v_product.jenis_item when 'raw_material' then '1210' when 'work_in_progress' then '1220' when 'finished_good' then '1230' else '1200' end;
    v_name:=case v_code when '1210' then 'Persediaan Bahan Baku' when '1220' then 'Persediaan Barang Dalam Proses' when '1230' then 'Persediaan Barang Jadi' else 'Persediaan Barang Dagangan' end;
    v_amount:=round(abs(r.quantity_delta)*coalesce(v_product.harga_pokok,0),2);
    if v_amount>0 then perform public.post_demo_accounting_journal(r.session_id,'inventory_movement',r.id::text,'Saldo awal persediaan: '||v_product.nama,jsonb_build_array(jsonb_build_object('code',v_code,'name',v_name,'type','asset','debit',v_amount,'credit',0),jsonb_build_object('code','3900','name','Saldo Awal / Penyesuaian Persediaan','type','equity','debit',0,'credit',v_amount)),(r.created_at at time zone 'Asia/Jakarta')::date);end if;
  end loop;
end $$;

-- Clean public execute access on internal helper functions.
revoke all on function public.post_actual_transaction_accounting(uuid) from public,anon,authenticated;
revoke all on function public.post_demo_order_accounting(uuid,boolean) from public,anon,authenticated;
revoke all on function public.post_actual_production_batch_accounting(uuid) from public,anon,authenticated;
revoke all on function public.post_demo_production_batch_accounting(uuid) from public,anon,authenticated;
grant execute on function public.post_demo_order_accounting(uuid,boolean) to service_role;
grant execute on function public.post_actual_production_batch_accounting(uuid) to service_role;
grant execute on function public.post_demo_production_batch_accounting(uuid) to service_role;
revoke all on function public.trg_actual_purchase_item_accounting_row(uuid) from public,anon,authenticated;
revoke all on function public.trg_demo_purchase_item_accounting_row(uuid) from public,anon,authenticated;
grant execute on function public.trg_actual_purchase_item_accounting_row(uuid) to service_role;
grant execute on function public.trg_demo_purchase_item_accounting_row(uuid) to service_role;

commit;
