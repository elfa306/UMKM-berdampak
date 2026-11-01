-- UMKM Berdampak - Dashboard Interactive Demo dan Guided Demo
-- Jalankan setelah migration_v6_demo_sessions.sql.
-- Aman untuk data demo yang sudah ada; tidak mengubah tabel transaksi produksi.

alter table public.demo_orders
  add column if not exists is_seeded boolean not null default false;

create index if not exists demo_orders_session_seeded_date_idx
  on public.demo_orders (session_id, is_seeded, created_at desc);

create table if not exists public.demo_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  event_type text not null check (event_type in (
    'product_created',
    'sale_paid',
    'inventory_decreased',
    'purchase_received',
    'profit_loss_viewed',
    'financing_recommendation_viewed'
  )),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);

create index if not exists demo_events_session_date_idx
  on public.demo_events (session_id, created_at desc);
create index if not exists demo_events_session_type_idx
  on public.demo_events (session_id, event_type);

alter table public.demo_events enable row level security;
revoke all on table public.demo_events from public, anon, authenticated;
grant all on table public.demo_events to service_role;
