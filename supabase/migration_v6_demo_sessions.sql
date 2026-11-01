-- UMKM Berdampak - Interactive Demo Session Manager
-- Jalankan setelah schema.sql dan migration_v2.sql sampai migration_v5.sql.
-- Semua tabel demo hanya dapat diakses dari backend menggunakan SUPABASE_SERVICE_ROLE_KEY.
-- Jangan membuat policy untuk anon/authenticated: akses browser langsung memang ditutup.

create table if not exists public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  business_type text not null check (business_type in ('retail', 'manufaktur', 'jasa', 'campuran')),
  demo_mode text not null check (demo_mode in ('eksplorasi', 'guided')),
  business_name text not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  reset_at timestamptz
);

create index if not exists demo_sessions_expiry_idx
  on public.demo_sessions (expires_at);
create index if not exists demo_sessions_status_idx
  on public.demo_sessions (status, last_seen_at desc);

create table if not exists public.demo_products (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  sku text,
  nama text not null,
  kategori text not null default 'Umum',
  jenis_item text not null default 'merchandise'
    check (jenis_item in ('merchandise', 'raw_material', 'work_in_progress', 'finished_good', 'service')),
  satuan text not null default 'unit',
  harga_jual numeric(14,2) not null default 0 check (harga_jual >= 0),
  harga_pokok numeric(14,2) not null default 0 check (harga_pokok >= 0),
  stok numeric(14,3) not null default 0 check (stok >= 0),
  stok_minimum numeric(14,3) not null default 0 check (stok_minimum >= 0),
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id, sku)
);

create index if not exists demo_products_session_idx
  on public.demo_products (session_id, aktif, nama);

create table if not exists public.demo_orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  invoice_no text not null,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'paid', 'expired', 'cancelled')),
  payment_method text,
  payment_source text check (payment_source is null or payment_source in ('cash_simulation', 'manual_demo', 'belibayar_sandbox')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (session_id, invoice_no)
);

create index if not exists demo_orders_session_date_idx
  on public.demo_orders (session_id, created_at desc);

create table if not exists public.demo_order_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  order_id uuid not null references public.demo_orders(id) on delete cascade,
  product_id uuid references public.demo_products(id) on delete set null,
  nama_snapshot text not null,
  satuan_snapshot text not null default 'unit',
  qty numeric(14,3) not null check (qty > 0),
  harga_jual numeric(14,2) not null check (harga_jual >= 0),
  harga_pokok numeric(14,2) not null default 0 check (harga_pokok >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists demo_order_items_order_idx
  on public.demo_order_items (session_id, order_id);

create table if not exists public.demo_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  product_id uuid not null references public.demo_products(id) on delete cascade,
  movement_type text not null
    check (movement_type in ('opening', 'sale', 'restock', 'adjustment', 'production_in', 'production_out', 'waste')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  reference_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists demo_inventory_session_date_idx
  on public.demo_inventory_movements (session_id, created_at desc);
create index if not exists demo_inventory_product_idx
  on public.demo_inventory_movements (session_id, product_id, created_at desc);

create table if not exists public.demo_payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  order_id uuid not null references public.demo_orders(id) on delete cascade,
  provider text not null check (provider in ('belibayar_sandbox', 'cash_simulation', 'manual_demo')),
  external_transaction_id text,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, external_transaction_id)
);

create index if not exists demo_payments_session_date_idx
  on public.demo_payments (session_id, created_at desc);

-- Sliding-window rate limiter. Only the server service-role client can call this function.
create table if not exists public.demo_session_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.consume_demo_session_rate_limit(
  p_ip_hash text,
  p_limit integer default 12,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;
  if p_ip_hash is null or length(p_ip_hash) < 32 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_arguments';
  end if;

  insert into public.demo_session_rate_limits (ip_hash, window_started_at, attempts, updated_at)
  values (p_ip_hash, now(), 1, now())
  on conflict (ip_hash) do update
    set attempts = case
      when public.demo_session_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else public.demo_session_rate_limits.attempts + 1
    end,
    window_started_at = case
      when public.demo_session_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else public.demo_session_rate_limits.window_started_at
    end,
    updated_at = now()
  returning attempts into v_attempts;

  return v_attempts <= p_limit;
end;
$$;

-- Expired sessions are removed in batches whenever a new session is created.
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
  where expires_at < now() - interval '24 hours'
     or (status = 'ended' and last_seen_at < now() - interval '24 hours');
  get diagnostics v_deleted = row_count;

  delete from public.demo_session_rate_limits
  where updated_at < now() - interval '2 days';

  return v_deleted;
end;
$$;

-- Deny direct access from browser roles. The Next.js server uses service_role only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'demo_sessions',
    'demo_products',
    'demo_orders',
    'demo_order_items',
    'demo_inventory_movements',
    'demo_payments',
    'demo_session_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.consume_demo_session_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_expired_demo_sessions() from public, anon, authenticated;
grant execute on function public.consume_demo_session_rate_limit(text, integer, integer) to service_role;
grant execute on function public.cleanup_expired_demo_sessions() to service_role;
