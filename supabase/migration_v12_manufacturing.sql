-- UMKM Berdampak - Tahap 9: Manufacturing Management.
-- Jalankan setelah migration_v11_inventory_management.sql.
-- Menambahkan resep/BOM dan batch produksi untuk akun asli serta sesi demo.
-- Tidak menghapus produk, transaksi, persediaan, atau data demo yang sudah ada.

begin;

-- Tambahkan event produksi ke Guided Demo. Migration v7 belum mengenal event ini.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.demo_events'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table public.demo_events drop constraint %I', c.conname);
  end loop;
  alter table public.demo_events
    add constraint demo_events_event_type_v12_check
    check (event_type in (
      'product_created','sale_paid','inventory_decreased','purchase_received',
      'profit_loss_viewed','financing_recommendation_viewed','production_completed'
    ));
end $$;

-- Perluas jenis mutasi produk produksi agar produksi bisa dicatat sebagai mutasi stok.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.inventory_movements'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%movement_type%'
  loop
    execute format('alter table public.inventory_movements drop constraint %I', c.conname);
  end loop;
  alter table public.inventory_movements
    add constraint inventory_movements_movement_type_v12_check
    check (movement_type in ('opening','purchase','sale','adjustment_in','adjustment_out','return_in','return_out','waste','production_in','production_out'));
end $$;

create table if not exists public.production_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nama text not null check (char_length(btrim(nama)) between 2 and 120),
  output_product_id uuid not null references public.products(id) on delete restrict,
  output_qty numeric(14,3) not null default 1 check (output_qty > 0),
  output_unit text not null default 'pcs',
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,nama)
);

create table if not exists public.production_recipe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.production_recipes(id) on delete cascade,
  input_product_id uuid not null references public.products(id) on delete restrict,
  qty_per_batch numeric(14,3) not null check (qty_per_batch > 0),
  created_at timestamptz not null default now(),
  unique(recipe_id,input_product_id)
);

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.production_recipes(id) on delete restrict,
  batch_no text not null,
  idempotency_key text not null,
  batch_count numeric(14,3) not null check (batch_count > 0),
  output_product_id uuid not null references public.products(id) on delete restrict,
  output_qty numeric(14,3) not null check (output_qty > 0),
  material_cost numeric(14,2) not null default 0,
  direct_labor_cost numeric(14,2) not null default 0,
  overhead_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  status text not null default 'completed' check (status in ('completed','reversed')),
  catatan text,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id,batch_no),
  unique(user_id,idempotency_key)
);

create table if not exists public.production_batch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  input_product_id uuid not null references public.products(id) on delete restrict,
  nama_snapshot text not null,
  satuan_snapshot text not null,
  qty_used numeric(14,3) not null check (qty_used > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists production_recipes_user_idx on public.production_recipes(user_id,aktif,nama);
create index if not exists production_recipe_items_recipe_idx on public.production_recipe_items(user_id,recipe_id);
create index if not exists production_batches_user_date_idx on public.production_batches(user_id,completed_at desc);
create index if not exists production_batch_items_batch_idx on public.production_batch_items(user_id,batch_id);

alter table public.production_recipes enable row level security;
alter table public.production_recipe_items enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_batch_items enable row level security;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_recipes' and policyname='production_recipes_select_own') then
    create policy production_recipes_select_own on public.production_recipes for select to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_recipe_items' and policyname='production_recipe_items_select_own') then
    create policy production_recipe_items_select_own on public.production_recipe_items for select to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_batches' and policyname='production_batches_select_own') then
    create policy production_batches_select_own on public.production_batches for select to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='production_batch_items' and policyname='production_batch_items_select_own') then
    create policy production_batch_items_select_own on public.production_batch_items for select to authenticated using ((select auth.uid())=user_id);
  end if;
end $$;

revoke all on public.production_recipes,public.production_recipe_items,public.production_batches,public.production_batch_items from anon;
grant select on public.production_recipes,public.production_recipe_items,public.production_batches,public.production_batch_items to authenticated;
revoke insert,update,delete on public.production_recipes,public.production_recipe_items,public.production_batches,public.production_batch_items from authenticated;

create or replace function public.create_production_recipe(
  p_name text,
  p_output_product_id uuid,
  p_output_qty numeric,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid:=auth.uid(); v_output public.products%rowtype; v_line jsonb; v_input public.products%rowtype;
  v_recipe public.production_recipes%rowtype; v_id uuid; v_qty numeric(14,3);
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_name is null or char_length(btrim(p_name))<2 or char_length(btrim(p_name))>120 then raise exception 'invalid_recipe_name'; end if;
  if p_output_qty is null or p_output_qty<=0 or p_output_qty>1000000 or round(p_output_qty,3)<>p_output_qty then raise exception 'invalid_output_quantity'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30 then raise exception 'invalid_recipe_items'; end if;
  select * into v_output from public.products where id=p_output_product_id and user_id=v_user and aktif=true for update;
  if not found or v_output.jenis_item<>'finished_good' then raise exception 'output_must_be_finished_good'; end if;
  if (select count(*) from (select value->>'productId' x from jsonb_array_elements(p_items) group by value->>'productId') q)<>jsonb_array_length(p_items) then raise exception 'duplicate_recipe_item'; end if;
  insert into public.production_recipes(user_id,nama,output_product_id,output_qty,output_unit,catatan)
  values(v_user,btrim(p_name),p_output_product_id,p_output_qty,v_output.satuan,left(coalesce(p_note,''),500)) returning * into v_recipe;
  for v_line in select value from jsonb_array_elements(p_items) loop
    begin v_id:=(v_line->>'productId')::uuid; v_qty:=(v_line->>'qty')::numeric; exception when others then raise exception 'invalid_recipe_item'; end;
    if v_qty is null or v_qty<=0 or v_qty>1000000 or round(v_qty,3)<>v_qty then raise exception 'invalid_recipe_quantity'; end if;
    select * into v_input from public.products where id=v_id and user_id=v_user and aktif=true for update;
    if not found or v_input.jenis_item not in ('raw_material','work_in_progress') or not v_input.lacak_stok then raise exception 'input_must_be_stocked_material'; end if;
    if v_id=p_output_product_id then raise exception 'recipe_cannot_use_own_output'; end if;
    insert into public.production_recipe_items(user_id,recipe_id,input_product_id,qty_per_batch)
    values(v_user,v_recipe.id,v_id,v_qty);
  end loop;
  return jsonb_build_object('recipe',to_jsonb(v_recipe),'item_count',jsonb_array_length(p_items));
exception when unique_violation then raise exception 'recipe_name_or_item_already_exists';
end;
$$;

create or replace function public.complete_production_batch(
  p_recipe_id uuid,
  p_batch_count numeric,
  p_direct_labor_cost numeric,
  p_overhead_cost numeric,
  p_idempotency_key text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid:=auth.uid(); v_recipe public.production_recipes%rowtype; v_output public.products%rowtype;
  v_line record; v_input public.products%rowtype; v_batch public.production_batches%rowtype;
  v_material numeric(14,2):=0; v_total numeric(14,2); v_output_qty numeric(14,3); v_used numeric(14,3);
  v_subtotal numeric(14,2); v_new_stock numeric(14,3); v_new_cost numeric(14,2); v_no text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_batch_count is null or p_batch_count<=0 or p_batch_count>10000 or round(p_batch_count,3)<>p_batch_count then raise exception 'invalid_batch_count'; end if;
  if p_direct_labor_cost is null or p_direct_labor_cost<0 or p_direct_labor_cost>100000000000 or p_overhead_cost is null or p_overhead_cost<0 or p_overhead_cost>100000000000 then raise exception 'invalid_production_cost'; end if;
  if p_idempotency_key is null or length(p_idempotency_key)<12 or length(p_idempotency_key)>100 then raise exception 'invalid_idempotency_key'; end if;
  select * into v_batch from public.production_batches where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('batch',to_jsonb(v_batch),'duplicate',true); end if;
  select * into v_recipe from public.production_recipes where id=p_recipe_id and user_id=v_user and aktif=true for update;
  if not found then raise exception 'recipe_not_found'; end if;
  select * into v_output from public.products where id=v_recipe.output_product_id and user_id=v_user and aktif=true for update;
  if not found then raise exception 'output_product_not_found'; end if;
  v_output_qty:=round(v_recipe.output_qty*p_batch_count,3);
  if v_output_qty<=0 or v_output_qty>100000000 then raise exception 'invalid_output_quantity'; end if;
  for v_line in
    select ri.input_product_id,ri.qty_per_batch,p.nama,p.satuan,p.harga_pokok,p.stok,p.jenis_item
    from public.production_recipe_items ri join public.products p on p.id=ri.input_product_id and p.user_id=ri.user_id
    where ri.user_id=v_user and ri.recipe_id=v_recipe.id order by ri.input_product_id for update of p
  loop
    v_used:=round(v_line.qty_per_batch*p_batch_count,3);
    if v_line.stok<v_used then raise exception 'insufficient_raw_material:%',v_line.nama; end if;
    v_subtotal:=round(v_used*v_line.harga_pokok,2); v_material:=v_material+v_subtotal;
  end loop;
  v_total:=round(v_material+p_direct_labor_cost+p_overhead_cost,2);
  v_new_stock:=v_output.stok+v_output_qty;
  v_new_cost:=case when v_new_stock>0 then round(((v_output.stok*v_output.harga_pokok)+v_total)/v_new_stock,2) else 0 end;
  v_no:='PRD-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.production_batches(user_id,recipe_id,batch_no,idempotency_key,batch_count,output_product_id,output_qty,material_cost,direct_labor_cost,overhead_cost,total_cost,unit_cost,status,catatan)
  values(v_user,v_recipe.id,v_no,p_idempotency_key,p_batch_count,v_output.id,v_output_qty,v_material,p_direct_labor_cost,p_overhead_cost,v_total,round(v_total/v_output_qty,2),'completed',left(coalesce(p_note,''),500)) returning * into v_batch;
  for v_line in
    select ri.input_product_id,ri.qty_per_batch,p.nama,p.satuan,p.harga_pokok
    from public.production_recipe_items ri join public.products p on p.id=ri.input_product_id and p.user_id=ri.user_id
    where ri.user_id=v_user and ri.recipe_id=v_recipe.id order by ri.input_product_id for update of p
  loop
    v_used:=round(v_line.qty_per_batch*p_batch_count,3); v_subtotal:=round(v_used*v_line.harga_pokok,2);
    update public.products set stok=stok-v_used,updated_at=now() where id=v_line.input_product_id and user_id=v_user and stok>=v_used;
    if not found then raise exception 'insufficient_raw_material:%',v_line.nama; end if;
    insert into public.production_batch_items(user_id,batch_id,input_product_id,nama_snapshot,satuan_snapshot,qty_used,unit_cost,subtotal)
    values(v_user,v_batch.id,v_line.input_product_id,v_line.nama,v_line.satuan,v_used,v_line.harga_pokok,v_subtotal);
    insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
    values(v_user,v_line.input_product_id,'production_out',-v_used,v_line.harga_pokok,v_subtotal,'production-out:'||v_batch.id::text||':'||v_line.input_product_id::text,'Pemakaian bahan baku batch '||v_no);
  end loop;
  update public.products set stok=v_new_stock,harga_pokok=v_new_cost,lacak_stok=true,updated_at=now() where id=v_output.id and user_id=v_user;
  insert into public.inventory_movements(user_id,product_id,movement_type,quantity_delta,unit_cost,total_cost,reference_key,note)
  values(v_user,v_output.id,'production_in',v_output_qty,v_total/v_output_qty,v_total,'production-in:'||v_batch.id::text,'Hasil produksi batch '||v_no);
  return jsonb_build_object('batch',to_jsonb(v_batch),'material_cost',v_material,'total_cost',v_total,'unit_cost',round(v_total/v_output_qty,2),'output_qty',v_output_qty,'duplicate',false);
end;
$$;

-- Demo tables: sepenuhnya terisolasi berdasarkan session_id dan hanya diakses server.
create table if not exists public.demo_production_recipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  nama text not null check (char_length(btrim(nama)) between 2 and 120),
  output_product_id uuid not null references public.demo_products(id) on delete restrict,
  output_qty numeric(14,3) not null default 1 check (output_qty>0),
  output_unit text not null default 'pcs',
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  unique(session_id,nama)
);
create table if not exists public.demo_production_recipe_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  recipe_id uuid not null references public.demo_production_recipes(id) on delete cascade,
  input_product_id uuid not null references public.demo_products(id) on delete restrict,
  qty_per_batch numeric(14,3) not null check (qty_per_batch>0),
  created_at timestamptz not null default now(),
  unique(recipe_id,input_product_id)
);
create table if not exists public.demo_production_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  recipe_id uuid not null references public.demo_production_recipes(id) on delete restrict,
  batch_no text not null,
  idempotency_key text not null,
  batch_count numeric(14,3) not null check (batch_count>0),
  output_product_id uuid not null references public.demo_products(id) on delete restrict,
  output_qty numeric(14,3) not null check (output_qty>0),
  material_cost numeric(14,2) not null default 0,
  direct_labor_cost numeric(14,2) not null default 0,
  overhead_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  status text not null default 'completed' check(status in ('completed','reversed')),
  catatan text,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(session_id,batch_no),
  unique(session_id,idempotency_key)
);
create table if not exists public.demo_production_batch_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  batch_id uuid not null references public.demo_production_batches(id) on delete cascade,
  input_product_id uuid not null references public.demo_products(id) on delete restrict,
  nama_snapshot text not null,
  satuan_snapshot text not null,
  qty_used numeric(14,3) not null check(qty_used>0),
  unit_cost numeric(14,2) not null check(unit_cost>=0),
  subtotal numeric(14,2) not null check(subtotal>=0),
  created_at timestamptz not null default now()
);
create index if not exists demo_production_recipes_session_idx on public.demo_production_recipes(session_id,aktif,nama);
create index if not exists demo_production_batches_session_idx on public.demo_production_batches(session_id,completed_at desc);

create or replace function public.create_demo_production_recipe(
  p_session_id uuid,p_name text,p_output_product_id uuid,p_output_qty numeric,p_items jsonb,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.demo_sessions%rowtype; v_output public.demo_products%rowtype; v_input public.demo_products%rowtype;
  v_line jsonb; v_recipe public.demo_production_recipes%rowtype; v_id uuid; v_qty numeric(14,3);
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not_authorized'; end if;
  if p_name is null or char_length(btrim(p_name))<2 or char_length(btrim(p_name))>120 then raise exception 'invalid_recipe_name'; end if;
  if p_output_qty is null or p_output_qty<=0 or p_output_qty>1000000 or round(p_output_qty,3)<>p_output_qty then raise exception 'invalid_output_quantity'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30 then raise exception 'invalid_recipe_items'; end if;
  select * into v_session from public.demo_sessions where id=p_session_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'demo_session_expired'; end if;
  select * into v_output from public.demo_products where id=p_output_product_id and session_id=p_session_id and aktif=true for update;
  if not found or v_output.jenis_item<>'finished_good' then raise exception 'output_must_be_finished_good'; end if;
  if (select count(*) from (select value->>'productId' x from jsonb_array_elements(p_items) group by value->>'productId') q)<>jsonb_array_length(p_items) then raise exception 'duplicate_recipe_item'; end if;
  insert into public.demo_production_recipes(session_id,nama,output_product_id,output_qty,output_unit,catatan)
  values(p_session_id,btrim(p_name),p_output_product_id,p_output_qty,v_output.satuan,left(coalesce(p_note,''),500)) returning * into v_recipe;
  for v_line in select value from jsonb_array_elements(p_items) loop
    begin v_id:=(v_line->>'productId')::uuid; v_qty:=(v_line->>'qty')::numeric; exception when others then raise exception 'invalid_recipe_item'; end;
    if v_qty is null or v_qty<=0 or v_qty>1000000 or round(v_qty,3)<>v_qty then raise exception 'invalid_recipe_quantity'; end if;
    select * into v_input from public.demo_products where id=v_id and session_id=p_session_id and aktif=true for update;
    if not found or v_input.jenis_item not in ('raw_material','work_in_progress') then raise exception 'input_must_be_stocked_material'; end if;
    if v_id=p_output_product_id then raise exception 'recipe_cannot_use_own_output'; end if;
    insert into public.demo_production_recipe_items(session_id,recipe_id,input_product_id,qty_per_batch)
    values(p_session_id,v_recipe.id,v_id,v_qty);
  end loop;
  return jsonb_build_object('recipe',to_jsonb(v_recipe),'item_count',jsonb_array_length(p_items));
exception when unique_violation then raise exception 'recipe_name_or_item_already_exists';
end $$;

create or replace function public.complete_demo_production_batch(
  p_session_id uuid,p_recipe_id uuid,p_batch_count numeric,p_direct_labor_cost numeric,p_overhead_cost numeric,p_idempotency_key text,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.demo_sessions%rowtype; v_recipe public.demo_production_recipes%rowtype; v_output public.demo_products%rowtype;
  v_line record; v_batch public.demo_production_batches%rowtype; v_material numeric(14,2):=0; v_total numeric(14,2);
  v_output_qty numeric(14,3); v_used numeric(14,3); v_subtotal numeric(14,2); v_new_stock numeric(14,3); v_new_cost numeric(14,2); v_no text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not_authorized'; end if;
  if p_batch_count is null or p_batch_count<=0 or p_batch_count>10000 or round(p_batch_count,3)<>p_batch_count then raise exception 'invalid_batch_count'; end if;
  if p_direct_labor_cost is null or p_direct_labor_cost<0 or p_direct_labor_cost>100000000000 or p_overhead_cost is null or p_overhead_cost<0 or p_overhead_cost>100000000000 then raise exception 'invalid_production_cost'; end if;
  if p_idempotency_key is null or length(p_idempotency_key)<12 or length(p_idempotency_key)>100 then raise exception 'invalid_idempotency_key'; end if;
  select * into v_session from public.demo_sessions where id=p_session_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'demo_session_expired'; end if;
  select * into v_batch from public.demo_production_batches where session_id=p_session_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('batch',to_jsonb(v_batch),'duplicate',true); end if;
  select * into v_recipe from public.demo_production_recipes where id=p_recipe_id and session_id=p_session_id and aktif=true for update;
  if not found then raise exception 'recipe_not_found'; end if;
  select * into v_output from public.demo_products where id=v_recipe.output_product_id and session_id=p_session_id and aktif=true for update;
  if not found then raise exception 'output_product_not_found'; end if;
  v_output_qty:=round(v_recipe.output_qty*p_batch_count,3);
  if v_output_qty<=0 or v_output_qty>100000000 then raise exception 'invalid_output_quantity'; end if;
  for v_line in select ri.input_product_id,ri.qty_per_batch,p.nama,p.satuan,p.harga_pokok,p.stok
    from public.demo_production_recipe_items ri join public.demo_products p on p.id=ri.input_product_id and p.session_id=ri.session_id
    where ri.session_id=p_session_id and ri.recipe_id=v_recipe.id order by ri.input_product_id for update of p
  loop
    v_used:=round(v_line.qty_per_batch*p_batch_count,3);
    if v_line.stok<v_used then raise exception 'insufficient_raw_material:%',v_line.nama; end if;
    v_material:=v_material+round(v_used*v_line.harga_pokok,2);
  end loop;
  v_total:=round(v_material+p_direct_labor_cost+p_overhead_cost,2); v_new_stock:=v_output.stok+v_output_qty;
  v_new_cost:=case when v_new_stock>0 then round(((v_output.stok*v_output.harga_pokok)+v_total)/v_new_stock,2) else 0 end;
  v_no:='DEMO-PRD-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.demo_production_batches(session_id,recipe_id,batch_no,idempotency_key,batch_count,output_product_id,output_qty,material_cost,direct_labor_cost,overhead_cost,total_cost,unit_cost,status,catatan)
  values(p_session_id,v_recipe.id,v_no,p_idempotency_key,p_batch_count,v_output.id,v_output_qty,v_material,p_direct_labor_cost,p_overhead_cost,v_total,round(v_total/v_output_qty,2),'completed',left(coalesce(p_note,''),500)) returning * into v_batch;
  for v_line in select ri.input_product_id,ri.qty_per_batch,p.nama,p.satuan,p.harga_pokok
    from public.demo_production_recipe_items ri join public.demo_products p on p.id=ri.input_product_id and p.session_id=ri.session_id
    where ri.session_id=p_session_id and ri.recipe_id=v_recipe.id order by ri.input_product_id for update of p
  loop
    v_used:=round(v_line.qty_per_batch*p_batch_count,3); v_subtotal:=round(v_used*v_line.harga_pokok,2);
    update public.demo_products set stok=stok-v_used where id=v_line.input_product_id and session_id=p_session_id and stok>=v_used;
    if not found then raise exception 'insufficient_raw_material:%',v_line.nama; end if;
    insert into public.demo_production_batch_items(session_id,batch_id,input_product_id,nama_snapshot,satuan_snapshot,qty_used,unit_cost,subtotal)
    values(p_session_id,v_batch.id,v_line.input_product_id,v_line.nama,v_line.satuan,v_used,v_line.harga_pokok,v_subtotal);
    insert into public.demo_inventory_movements(session_id,product_id,movement_type,quantity_delta,reference_id,note,idempotency_key)
    values(p_session_id,v_line.input_product_id,'production_out',-v_used,v_batch.id,'Bahan baku produksi '||v_no,'prd-out:'||v_batch.id::text||':'||v_line.input_product_id::text);
  end loop;
  update public.demo_products set stok=v_new_stock,harga_pokok=v_new_cost where id=v_output.id and session_id=p_session_id;
  insert into public.demo_inventory_movements(session_id,product_id,movement_type,quantity_delta,reference_id,note,idempotency_key)
  values(p_session_id,v_output.id,'production_in',v_output_qty,v_batch.id,'Hasil produksi '||v_no,'prd-in:'||v_batch.id::text);
  insert into public.demo_events(session_id,event_type,idempotency_key,metadata)
  values(p_session_id,'production_completed','production:'||v_batch.id::text,jsonb_build_object('batch_no',v_no,'output_qty',v_output_qty,'total_cost',v_total))
  on conflict(session_id,idempotency_key) do nothing;
  return jsonb_build_object('batch',to_jsonb(v_batch),'material_cost',v_material,'total_cost',v_total,'unit_cost',round(v_total/v_output_qty,2),'output_qty',v_output_qty,'duplicate',false);
end $$;

alter table public.demo_production_recipes enable row level security;
alter table public.demo_production_recipe_items enable row level security;
alter table public.demo_production_batches enable row level security;
alter table public.demo_production_batch_items enable row level security;
revoke all on public.demo_production_recipes,public.demo_production_recipe_items,public.demo_production_batches,public.demo_production_batch_items from public,anon,authenticated;
grant all on public.demo_production_recipes,public.demo_production_recipe_items,public.demo_production_batches,public.demo_production_batch_items to service_role;

revoke all on function public.create_production_recipe(text,uuid,numeric,jsonb,text) from public,anon;
revoke all on function public.complete_production_batch(uuid,numeric,numeric,numeric,text,text) from public,anon;
revoke all on function public.create_demo_production_recipe(uuid,text,uuid,numeric,jsonb,text) from public,anon,authenticated;
revoke all on function public.complete_demo_production_batch(uuid,uuid,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_production_recipe(text,uuid,numeric,jsonb,text) to authenticated;
grant execute on function public.complete_production_batch(uuid,numeric,numeric,numeric,text,text) to authenticated;
grant execute on function public.create_demo_production_recipe(uuid,text,uuid,numeric,jsonb,text) to service_role;
grant execute on function public.complete_demo_production_batch(uuid,uuid,numeric,numeric,numeric,text,text) to service_role;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='production_batches') then
    alter publication supabase_realtime add table public.production_batches;
  end if;
end $$;

commit;
