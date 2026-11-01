-- UMKM Berdampak - Tahap 8: Inventory Management untuk akun asli dan Interactive Demo.
-- Jalankan setelah migration_v10_gopay_macrodroid_integration.sql.
-- Migration ini menambahkan modul persediaan; tidak menghapus data produk/transaksi lama.

begin;

-- -----------------------------------------------------------------------------
-- A. Perluas katalog produk produksi. Kolom lama (nama/harga) tetap dipertahankan.
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists sku text,
  add column if not exists kategori text not null default 'Umum',
  add column if not exists jenis_item text not null default 'merchandise',
  add column if not exists satuan text not null default 'pcs',
  add column if not exists harga_pokok numeric(14,2) not null default 0,
  add column if not exists stok numeric(14,3) not null default 0,
  add column if not exists stok_minimum numeric(14,3) not null default 0,
  add column if not exists lacak_stok boolean not null default false,
  add column if not exists aktif boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Produk bahan baku/WIP boleh tidak memiliki harga jual. Produk lama tetap valid.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%harga%'
  loop
    execute format('alter table public.products drop constraint %I', c.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_inventory_item_type_check') then
    alter table public.products add constraint products_inventory_item_type_check
      check (jenis_item in ('merchandise','raw_material','work_in_progress','finished_good','service'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_inventory_harga_check') then
    alter table public.products add constraint products_inventory_harga_check
      check (harga >= 0 and (harga > 0 or jenis_item in ('raw_material','work_in_progress')));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_inventory_cost_check') then
    alter table public.products add constraint products_inventory_cost_check check (harga_pokok >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_inventory_stock_check') then
    alter table public.products add constraint products_inventory_stock_check check (stok >= 0 and stok_minimum >= 0);
  end if;
end $$;

create unique index if not exists products_user_sku_unique
  on public.products (user_id, sku) where sku is not null;
create index if not exists products_user_inventory_idx
  on public.products (user_id, aktif, kategori, nama);

revoke insert, update on public.products from authenticated;
grant insert (nama, harga) on public.products to authenticated;
grant update (nama, harga) on public.products to authenticated;

-- -----------------------------------------------------------------------------
-- B. Tabel pemasok, penerimaan pembelian, rincian, dan mutasi persediaan produksi.
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nama text not null check (char_length(btrim(nama)) between 2 and 100),
  telepon text,
  alamat text,
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  nomor_pembelian text not null,
  idempotency_key text not null,
  total_biaya numeric(14,2) not null default 0 check (total_biaya >= 0),
  catatan text,
  diterima_pada timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, nomor_pembelian),
  unique (user_id, idempotency_key)
);

create table if not exists public.stock_purchase_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null references public.stock_purchases(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  nama_snapshot text not null,
  satuan_snapshot text not null,
  qty numeric(14,3) not null check (qty > 0),
  harga_pokok numeric(14,2) not null check (harga_pokok >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','purchase','sale','adjustment_in','adjustment_out','return_in','return_out','waste')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  purchase_id uuid references public.stock_purchases(id) on delete set null,
  reference_key text,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_movements_user_reference_unique
  on public.inventory_movements (user_id, reference_key) where reference_key is not null;
create index if not exists suppliers_user_idx on public.suppliers (user_id, aktif, nama);
create index if not exists stock_purchases_user_date_idx on public.stock_purchases (user_id, diterima_pada desc);
create index if not exists stock_purchase_items_purchase_idx on public.stock_purchase_items (user_id, purchase_id);
create index if not exists inventory_movements_user_date_idx on public.inventory_movements (user_id, created_at desc);
create index if not exists inventory_movements_product_date_idx on public.inventory_movements (user_id, product_id, created_at desc);

-- Relasi transaksi kasir dengan SKU bersifat opsional agar catatan GoPay/MacroDroid lama aman.
alter table public.transactions add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists transactions_user_product_date_idx
  on public.transactions (user_id, product_id, created_at desc) where product_id is not null;

-- -----------------------------------------------------------------------------
-- C. RLS: semua baris produksi dipisahkan berdasarkan auth.uid().
-- Mutasi purchase/movement hanya dibuat melalui RPC atomik.
-- -----------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.stock_purchases enable row level security;
alter table public.stock_purchase_items enable row level security;
alter table public.inventory_movements enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers_select_own') then
    create policy suppliers_select_own on public.suppliers for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers_insert_own') then
    create policy suppliers_insert_own on public.suppliers for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers_update_own') then
    create policy suppliers_update_own on public.suppliers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers_delete_own') then
    create policy suppliers_delete_own on public.suppliers for delete to authenticated using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_purchases' and policyname='stock_purchases_select_own') then
    create policy stock_purchases_select_own on public.stock_purchases for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_purchase_items' and policyname='stock_purchase_items_select_own') then
    create policy stock_purchase_items_select_own on public.stock_purchase_items for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inventory_movements' and policyname='inventory_movements_select_own') then
    create policy inventory_movements_select_own on public.inventory_movements for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

revoke all on public.suppliers, public.stock_purchases, public.stock_purchase_items, public.inventory_movements from anon;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select on public.stock_purchases, public.stock_purchase_items, public.inventory_movements to authenticated;
revoke insert, update, delete on public.stock_purchases, public.stock_purchase_items, public.inventory_movements from authenticated;
grant all on public.suppliers, public.stock_purchases, public.stock_purchase_items, public.inventory_movements to service_role;

-- -----------------------------------------------------------------------------
-- D. RPC akun produksi. Seluruh fungsi memeriksa auth.uid() dan melakukan mutasi atomik.
-- -----------------------------------------------------------------------------
create or replace function public.create_inventory_product(
  p_sku text,
  p_name text,
  p_category text,
  p_item_type text,
  p_unit text,
  p_sale_price numeric,
  p_unit_cost numeric,
  p_stock numeric,
  p_min_stock numeric,
  p_track_stock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_sku text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 100 then raise exception 'invalid_product_name'; end if;
  if p_item_type not in ('merchandise','raw_material','work_in_progress','finished_good','service') then raise exception 'invalid_product_type'; end if;
  if coalesce(p_sale_price,-1) < 0 or coalesce(p_unit_cost,-1) < 0 or coalesce(p_stock,-1) < 0 or coalesce(p_min_stock,-1) < 0 then raise exception 'invalid_product_amount'; end if;
  if p_sale_price > 100000000000 or p_unit_cost > 100000000000 or p_stock > 100000000 or p_min_stock > 100000000 then raise exception 'product_amount_too_large'; end if;
  if p_item_type in ('merchandise','finished_good','service') and p_sale_price <= 0 then raise exception 'sale_price_required'; end if;
  if p_item_type = 'service' and (coalesce(p_stock,0) <> 0 or coalesce(p_track_stock,false)) then raise exception 'service_stock_not_allowed'; end if;
  if p_item_type in ('raw_material','work_in_progress') and p_track_stock is distinct from true then raise exception 'stock_tracking_required'; end if;

  v_sku := nullif(left(btrim(coalesce(p_sku,'')),32),'');
  if v_sku is null then v_sku := 'SKU-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)); end if;

  insert into public.products (
    user_id, sku, nama, harga, kategori, jenis_item, satuan, harga_pokok,
    stok, stok_minimum, lacak_stok, aktif
  ) values (
    v_user, v_sku, btrim(p_name), round(coalesce(p_sale_price,0),0),
    left(coalesce(nullif(btrim(p_category),''),'Umum'),40), p_item_type,
    left(coalesce(nullif(btrim(p_unit),''),'pcs'),20), round(coalesce(p_unit_cost,0),2),
    round(coalesce(p_stock,0),3), round(coalesce(p_min_stock,0),3),
    coalesce(p_track_stock,true), true
  ) returning * into v_product;

  if v_product.lacak_stok and v_product.stok > 0 then
    insert into public.inventory_movements (user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,note)
    values (v_user,v_product.id,'opening',v_product.stok,v_product.harga_pokok,round(v_product.stok*v_product.harga_pokok,2),'Stok awal produk');
  end if;
  return to_jsonb(v_product);
end;
$$;

-- Aktifkan pelacakan stok untuk produk lama tanpa mengubah harga/nama atau transaksi historis.
create or replace function public.enable_inventory_tracking(
  p_product_id uuid,
  p_initial_stock numeric,
  p_unit_cost numeric,
  p_min_stock numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_ref text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_initial_stock is null or p_initial_stock < 0 or p_initial_stock > 100000000 or round(p_initial_stock,3) <> p_initial_stock then raise exception 'invalid_initial_stock'; end if;
  if p_unit_cost is null or p_unit_cost < 0 or p_unit_cost > 100000000000 then raise exception 'invalid_unit_cost'; end if;
  if p_min_stock is null or p_min_stock < 0 or p_min_stock > 100000000 or round(p_min_stock,3) <> p_min_stock then raise exception 'invalid_min_stock'; end if;

  select * into v_product from public.products where id=p_product_id and user_id=v_user and aktif=true for update;
  if not found then raise exception 'product_not_found'; end if;
  if v_product.jenis_item='service' then raise exception 'service_cannot_be_stocked'; end if;
  if v_product.lacak_stok then raise exception 'inventory_tracking_already_enabled'; end if;

  update public.products
    set lacak_stok=true, stok=round(p_initial_stock,3), harga_pokok=round(p_unit_cost,2),
        stok_minimum=round(p_min_stock,3), updated_at=now()
    where id=p_product_id and user_id=v_user
    returning * into v_product;

  if v_product.stok > 0 then
    v_ref := 'opening:' || v_product.id::text || ':' || gen_random_uuid()::text;
    insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
    values(v_user,v_product.id,'opening',v_product.stok,v_product.harga_pokok,round(v_product.stok*v_product.harga_pokok,2),v_ref,'Saldo awal saat pelacakan stok diaktifkan');
  end if;

  return jsonb_build_object('product',to_jsonb(v_product),'tracking_enabled',true);
end;
$$;

create or replace function public.receive_inventory_purchase(
  p_supplier_id uuid,
  p_note text,
  p_idempotency_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_purchase public.stock_purchases%rowtype;
  v_product public.products%rowtype;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_old_stock numeric(14,3);
  v_new_stock numeric(14,3);
  v_new_cost numeric(14,2);
  v_no text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 12 or length(p_idempotency_key) > 100 then raise exception 'invalid_idempotency_key'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then raise exception 'invalid_purchase_items'; end if;
  if exists (select 1 from public.stock_purchases where user_id=v_user and idempotency_key=p_idempotency_key) then
    select * into v_purchase from public.stock_purchases where user_id=v_user and idempotency_key=p_idempotency_key;
    return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',true);
  end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and user_id=v_user and aktif=true) then raise exception 'supplier_not_found'; end if;
  if (select count(*) from (select value->>'productId' pid from jsonb_array_elements(p_items) group by value->>'productId') x) <> jsonb_array_length(p_items) then raise exception 'duplicate_purchase_product'; end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_line->>'productId')::uuid;
      v_qty := (v_line->>'qty')::numeric;
      v_cost := (v_line->>'unitCost')::numeric;
    exception when others then raise exception 'invalid_purchase_line'; end;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or round(v_qty,3) <> v_qty or v_cost is null or v_cost < 0 or v_cost > 100000000000 then raise exception 'invalid_purchase_amount'; end if;
    select * into v_product from public.products where id=v_product_id and user_id=v_user and aktif=true for update;
    if not found then raise exception 'product_not_found'; end if;
    if v_product.jenis_item='service' then raise exception 'service_cannot_be_stocked'; end if;
    v_subtotal := round(v_qty*v_cost,2);
    v_total := v_total + v_subtotal;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id',v_product.id,'name',v_product.nama,'unit',v_product.satuan,'qty',v_qty,'unit_cost',v_cost,'subtotal',v_subtotal,'old_stock',v_product.stok,'old_cost',v_product.harga_pokok));
  end loop;
  if v_total > 99999999999999 then raise exception 'purchase_total_too_large'; end if;

  v_no := 'PB-' || to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.stock_purchases(user_id,supplier_id,nomor_pembelian,idempotency_key,total_biaya,catatan)
  values(v_user,p_supplier_id,v_no,p_idempotency_key,round(v_total,2),left(coalesce(p_note,''),300)) returning * into v_purchase;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_cost := (v_line->>'unit_cost')::numeric;
    v_old_stock := (v_line->>'old_stock')::numeric;
    v_new_stock := v_old_stock + v_qty;
    v_new_cost := case when v_new_stock > 0 then round(((v_old_stock * (v_line->>'old_cost')::numeric) + (v_qty*v_cost))/v_new_stock,2) else v_cost end;

    insert into public.stock_purchase_items(user_id,purchase_id,product_id,nama_snapshot,satuan_snapshot,qty,harga_pokok,subtotal)
    values(v_user,v_purchase.id,v_product_id,v_line->>'name',v_line->>'unit',v_qty,v_cost,(v_line->>'subtotal')::numeric);
    update public.products set stok=v_new_stock,harga_pokok=v_new_cost,lacak_stok=true,updated_at=now() where id=v_product_id and user_id=v_user;
    insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,purchase_id,reference_key,note)
    values(v_user,v_product_id,'purchase',v_qty,v_cost,(v_line->>'subtotal')::numeric,v_purchase.id,p_idempotency_key||':'||v_product_id::text,'Pembelian '||v_no);
  end loop;

  return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',false,'items',v_lines);
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_delta numeric(14,3);
  v_new_stock numeric(14,3);
  v_cost numeric(14,2);
  v_new_cost numeric(14,2);
  v_movement public.inventory_movements%rowtype;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_movement_type not in ('adjustment_in','adjustment_out','return_in','return_out','waste') then raise exception 'invalid_movement_type'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 or round(p_quantity,3) <> p_quantity then raise exception 'invalid_quantity'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'invalid_unit_cost'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 12 or length(p_idempotency_key) > 100 then raise exception 'invalid_idempotency_key'; end if;

  select * into v_movement from public.inventory_movements where user_id=v_user and reference_key=p_idempotency_key;
  if found then return jsonb_build_object('movement',to_jsonb(v_movement),'duplicate',true); end if;

  select * into v_product from public.products where id=p_product_id and user_id=v_user and aktif=true for update;
  if not found then raise exception 'product_not_found'; end if;
  if v_product.jenis_item='service' then raise exception 'service_cannot_be_stocked'; end if;
  v_delta := case when p_movement_type in ('adjustment_in','return_in') then p_quantity else -p_quantity end;
  v_new_stock := v_product.stok + v_delta;
  if v_new_stock < 0 then raise exception 'insufficient_stock'; end if;
  v_cost := coalesce(nullif(p_unit_cost,0),v_product.harga_pokok);
  v_new_cost := v_product.harga_pokok;
  if v_delta > 0 and v_new_stock > 0 and p_unit_cost > 0 then
    v_new_cost := round(((v_product.stok*v_product.harga_pokok)+(p_quantity*p_unit_cost))/v_new_stock,2);
  end if;
  update public.products set stok=v_new_stock,harga_pokok=v_new_cost,lacak_stok=true,updated_at=now() where id=p_product_id and user_id=v_user;
  insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
  values(v_user,p_product_id,p_movement_type,v_delta,v_cost,round(abs(v_delta)*v_cost,2),p_idempotency_key,left(coalesce(p_note,''),300)) returning * into v_movement;
  return jsonb_build_object('movement',to_jsonb(v_movement),'new_stock',v_new_stock,'duplicate',false);
end;
$$;

-- POS akun: item yang dipilih pada kasir akan mengurangi stok secara atomik.
-- Notifikasi GoPay/MacroDroid tanpa product_id tidak melewati RPC ini dan tidak mengurangi SKU.
create or replace function public.record_inventory_sale(
  p_session_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_method text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session public.daily_sessions%rowtype;
  v_product public.products%rowtype;
  v_tx public.transactions%rowtype;
  v_ref text;
  v_total numeric(14,0);
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then raise exception 'invalid_quantity'; end if;
  if p_method not in ('tunai','qris') then raise exception 'invalid_payment_method'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 12 or length(p_idempotency_key) > 100 then raise exception 'invalid_idempotency_key'; end if;
  v_ref := 'inventory-sale:' || p_idempotency_key;

  select * into v_tx from public.transactions where user_id=v_user and ref_id=v_ref;
  if found then return jsonb_build_object('transaction',to_jsonb(v_tx),'duplicate',true); end if;

  select * into v_session from public.daily_sessions where id=p_session_id and user_id=v_user for update;
  if not found then raise exception 'daily_session_not_found'; end if;
  select * into v_product from public.products where id=p_product_id and user_id=v_user and aktif=true for update;
  if not found then raise exception 'product_not_found'; end if;
  if v_product.jenis_item not in ('merchandise','finished_good','service') or v_product.harga <= 0 then raise exception 'product_not_for_sale'; end if;
  if v_product.lacak_stok then
    if v_product.stok < p_quantity then raise exception 'insufficient_stock'; end if;
    update public.products set stok=stok-p_quantity,updated_at=now() where id=v_product.id and user_id=v_user;
    insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
    values(v_user,v_product.id,'sale',-p_quantity,v_product.harga_pokok,round(p_quantity*v_product.harga_pokok,2),v_ref,'Penjualan melalui kasir');
  end if;
  v_total := round(v_product.harga*p_quantity,0);
  insert into public.transactions(user_id,session_id,jenis,keterangan,jumlah,qty,metode,ref_id,payment_source,product_id)
  values(v_user,p_session_id,'penjualan',v_product.nama,v_total,p_quantity,p_method,v_ref,'cashier',v_product.id)
  returning * into v_tx;
  return jsonb_build_object('transaction',to_jsonb(v_tx),'duplicate',false,'stock_tracked',v_product.lacak_stok);
end;
$$;

create or replace function public.cancel_inventory_sale(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.transactions%rowtype;
  v_product public.products%rowtype;
  v_restore numeric(14,3);
  v_ref text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  select * into v_tx from public.transactions where id=p_transaction_id and user_id=v_user for update;
  if not found then return jsonb_build_object('ok',true,'already_removed',true); end if;
  if v_tx.jenis <> 'penjualan' or v_tx.product_id is null or v_tx.payment_source <> 'cashier' then
    raise exception 'transaction_not_inventory_sale';
  end if;
  v_ref := 'inventory-sale-void:' || coalesce(v_tx.ref_id,v_tx.id::text);
  if exists(select 1 from public.inventory_movements where user_id=v_user and reference_key=v_ref) then
    delete from public.transactions where id=v_tx.id and user_id=v_user;
    return jsonb_build_object('ok',true,'already_reversed',true);
  end if;

  select * into v_product from public.products where id=v_tx.product_id and user_id=v_user for update;
  if found and v_product.lacak_stok then
    v_restore := greatest(coalesce(v_tx.qty,1),1);
    update public.products set stok=stok+v_restore,updated_at=now() where id=v_product.id and user_id=v_user;
    insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
    values(v_user,v_product.id,'return_in',v_restore,v_product.harga_pokok,round(v_restore*v_product.harga_pokok,2),v_ref,'Pembalikan transaksi kasir '||coalesce(v_tx.ref_id,v_tx.id::text));
  end if;
  delete from public.transactions where id=v_tx.id and user_id=v_user;
  return jsonb_build_object('ok',true,'stock_restored',coalesce(v_product.lacak_stok,false));
end;
$$;

revoke all on function public.enable_inventory_tracking(uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.enable_inventory_tracking(uuid,numeric,numeric,numeric) to authenticated;
revoke all on function public.create_inventory_product(text,text,text,text,text,numeric,numeric,numeric,numeric,boolean) from public, anon;
revoke all on function public.receive_inventory_purchase(uuid,text,text,jsonb) from public, anon;
revoke all on function public.adjust_inventory_stock(uuid,text,numeric,numeric,text,text) from public, anon;
revoke all on function public.record_inventory_sale(uuid,uuid,integer,text,text) from public, anon;
revoke all on function public.cancel_inventory_sale(uuid) from public, anon;
grant execute on function public.create_inventory_product(text,text,text,text,text,numeric,numeric,numeric,numeric,boolean) to authenticated;
grant execute on function public.receive_inventory_purchase(uuid,text,text,jsonb) to authenticated;
grant execute on function public.adjust_inventory_stock(uuid,text,numeric,numeric,text,text) to authenticated;
grant execute on function public.record_inventory_sale(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.cancel_inventory_sale(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- E. Tabel inventory demo. Berbeda total dari data produksi dan dibatasi session_id.
-- -----------------------------------------------------------------------------
create table if not exists public.demo_suppliers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  nama text not null check (char_length(btrim(nama)) between 2 and 100),
  telepon text,
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  unique(session_id,nama)
);

create table if not exists public.demo_stock_purchases (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  supplier_id uuid references public.demo_suppliers(id) on delete set null,
  purchase_no text not null,
  idempotency_key text not null,
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  note text,
  received_at timestamptz not null default now(),
  unique(session_id,purchase_no),
  unique(session_id,idempotency_key)
);

create table if not exists public.demo_stock_purchase_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  purchase_id uuid not null references public.demo_stock_purchases(id) on delete cascade,
  product_id uuid not null references public.demo_products(id) on delete cascade,
  nama_snapshot text not null,
  satuan_snapshot text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

alter table public.demo_inventory_movements add column if not exists idempotency_key text;
create unique index if not exists demo_inventory_movements_session_idempotency_unique
  on public.demo_inventory_movements(session_id,idempotency_key) where idempotency_key is not null;

create index if not exists demo_suppliers_session_idx on public.demo_suppliers(session_id,aktif,nama);
create index if not exists demo_stock_purchases_session_idx on public.demo_stock_purchases(session_id,received_at desc);
create index if not exists demo_stock_purchase_items_idx on public.demo_stock_purchase_items(session_id,purchase_id);

alter table public.demo_suppliers enable row level security;
alter table public.demo_stock_purchases enable row level security;
alter table public.demo_stock_purchase_items enable row level security;
revoke all on public.demo_suppliers, public.demo_stock_purchases, public.demo_stock_purchase_items from public, anon, authenticated;
grant all on public.demo_suppliers, public.demo_stock_purchases, public.demo_stock_purchase_items to service_role;

create or replace function public.create_demo_supplier(
  p_session_id uuid,
  p_name text,
  p_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_session public.demo_sessions%rowtype; v_supplier public.demo_suppliers%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not_authorized'; end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 100 then raise exception 'invalid_supplier_name'; end if;
  select * into v_session from public.demo_sessions where id=p_session_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'demo_session_expired'; end if;
  insert into public.demo_suppliers(session_id,nama,telepon,catatan)
  values(p_session_id,btrim(p_name),left(coalesce(p_phone,''),40),left(coalesce(p_note,''),300)) returning * into v_supplier;
  return to_jsonb(v_supplier);
exception when unique_violation then raise exception 'supplier_already_exists';
end;
$$;

create or replace function public.receive_demo_inventory_purchase(
  p_session_id uuid,
  p_supplier_id uuid,
  p_note text,
  p_idempotency_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.demo_sessions%rowtype;
  v_purchase public.demo_stock_purchases%rowtype;
  v_product public.demo_products%rowtype;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
  v_subtotal numeric(14,2);
  v_total numeric(14,2):=0;
  v_lines jsonb:='[]'::jsonb;
  v_old_stock numeric(14,3);
  v_new_stock numeric(14,3);
  v_new_cost numeric(14,2);
  v_no text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not_authorized'; end if;
  if p_idempotency_key is null or length(p_idempotency_key)<12 or length(p_idempotency_key)>100 then raise exception 'invalid_idempotency_key'; end if;
  select * into v_session from public.demo_sessions where id=p_session_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'demo_session_expired'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'invalid_purchase_items'; end if;
  if exists(select 1 from public.demo_stock_purchases where session_id=p_session_id and idempotency_key=p_idempotency_key) then
    select * into v_purchase from public.demo_stock_purchases where session_id=p_session_id and idempotency_key=p_idempotency_key;
    return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',true);
  end if;
  if p_supplier_id is not null and not exists(select 1 from public.demo_suppliers where id=p_supplier_id and session_id=p_session_id and aktif=true) then raise exception 'supplier_not_found'; end if;
  if (select count(*) from (select value->>'productId' pid from jsonb_array_elements(p_items) group by value->>'productId') x)<>jsonb_array_length(p_items) then raise exception 'duplicate_purchase_product'; end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    begin v_product_id:=(v_line->>'productId')::uuid; v_qty:=(v_line->>'qty')::numeric; v_cost:=(v_line->>'unitCost')::numeric;
    exception when others then raise exception 'invalid_purchase_line'; end;
    if v_qty is null or v_qty<=0 or v_qty>1000000 or round(v_qty,3)<>v_qty or v_cost is null or v_cost<0 or v_cost>100000000000 then raise exception 'invalid_purchase_amount'; end if;
    select * into v_product from public.demo_products where id=v_product_id and session_id=p_session_id and aktif=true for update;
    if not found then raise exception 'product_not_found'; end if;
    if v_product.jenis_item='service' then raise exception 'service_cannot_be_stocked'; end if;
    v_subtotal:=round(v_qty*v_cost,2); v_total:=v_total+v_subtotal;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'name',v_product.nama,'unit',v_product.satuan,'qty',v_qty,'unit_cost',v_cost,'subtotal',v_subtotal,'old_stock',v_product.stok,'old_cost',v_product.harga_pokok));
  end loop;
  v_no:='DEMO-PB-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.demo_stock_purchases(session_id,supplier_id,purchase_no,idempotency_key,total_cost,note)
  values(p_session_id,p_supplier_id,v_no,p_idempotency_key,round(v_total,2),left(coalesce(p_note,''),300)) returning * into v_purchase;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_product_id:=(v_line->>'product_id')::uuid; v_qty:=(v_line->>'qty')::numeric; v_cost:=(v_line->>'unit_cost')::numeric;
    v_old_stock:=(v_line->>'old_stock')::numeric; v_new_stock:=v_old_stock+v_qty;
    v_new_cost:=case when v_new_stock>0 then round(((v_old_stock*(v_line->>'old_cost')::numeric)+(v_qty*v_cost))/v_new_stock,2) else v_cost end;
    insert into public.demo_stock_purchase_items(session_id,purchase_id,product_id,nama_snapshot,satuan_snapshot,qty,unit_cost,subtotal)
    values(p_session_id,v_purchase.id,v_product_id,v_line->>'name',v_line->>'unit',v_qty,v_cost,(v_line->>'subtotal')::numeric);
    update public.demo_products set stok=v_new_stock,harga_pokok=v_new_cost where id=v_product_id and session_id=p_session_id;
    insert into public.demo_inventory_movements(session_id,product_id,movement_type,quantity_delta,reference_id,note)
    values(p_session_id,v_product_id,'restock',v_qty,v_purchase.id,'Pembelian demo '||v_no);
  end loop;

  insert into public.demo_events(session_id,event_type,idempotency_key,metadata)
  values(p_session_id,'purchase_received','purchase:'||v_purchase.id::text,jsonb_build_object('purchase_id',v_purchase.id,'purchase_no',v_purchase.purchase_no,'total_cost',v_purchase.total_cost))
  on conflict(session_id,idempotency_key) do nothing;
  return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',false,'items',v_lines);
end;
$$;

create or replace function public.adjust_demo_inventory_stock(
  p_session_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.demo_sessions%rowtype; v_product public.demo_products%rowtype;
  v_delta numeric(14,3); v_new_stock numeric(14,3); v_movement_type text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not_authorized'; end if;
  if p_movement_type not in ('adjustment_in','adjustment_out','return_in','return_out','waste') then raise exception 'invalid_movement_type'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>1000000 or round(p_quantity,3)<>p_quantity then raise exception 'invalid_quantity'; end if;
  if p_idempotency_key is null or length(p_idempotency_key)<12 or length(p_idempotency_key)>100 then raise exception 'invalid_idempotency_key'; end if;
  select * into v_session from public.demo_sessions where id=p_session_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'demo_session_expired'; end if;
  if exists(select 1 from public.demo_inventory_movements where session_id=p_session_id and idempotency_key=p_idempotency_key) then
    return jsonb_build_object('duplicate',true);
  end if;
  select * into v_product from public.demo_products where id=p_product_id and session_id=p_session_id and aktif=true for update;
  if not found then raise exception 'product_not_found'; end if;
  if v_product.jenis_item='service' then raise exception 'service_cannot_be_stocked'; end if;
  v_delta:=case when p_movement_type in ('adjustment_in','return_in') then p_quantity else -p_quantity end;
  v_new_stock:=v_product.stok+v_delta;
  if v_new_stock<0 then raise exception 'insufficient_stock'; end if;
  update public.demo_products set stok=v_new_stock where id=p_product_id and session_id=p_session_id;
  v_movement_type:=case when p_movement_type='waste' then 'waste' when p_movement_type in ('adjustment_in','return_in') then 'restock' else 'adjustment' end;
  insert into public.demo_inventory_movements(session_id,product_id,movement_type,quantity_delta,note,idempotency_key)
  values(p_session_id,p_product_id,v_movement_type,v_delta,left(coalesce(p_note,''),250),p_idempotency_key);
  return jsonb_build_object('duplicate',false,'new_stock',v_new_stock);
end;
$$;

revoke all on function public.create_demo_supplier(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.receive_demo_inventory_purchase(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.adjust_demo_inventory_stock(uuid,uuid,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.create_demo_supplier(uuid,text,text,text) to service_role;
grant execute on function public.receive_demo_inventory_purchase(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.adjust_demo_inventory_stock(uuid,uuid,text,numeric,text,text) to service_role;

-- -----------------------------------------------------------------------------
-- F. Realtime untuk produk akun. Tabel demo tetap hanya diakses melalui server.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;

commit;
