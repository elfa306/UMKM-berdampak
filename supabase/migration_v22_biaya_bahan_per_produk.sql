-- Migration v22: biaya bahan produksi terhubung ke produk katalog (relasi), plus laporan per produk.
-- Sebelumnya produk_terkait hanya teks bebas. Sekarang ada produk_terkait_id -> products(id) sehingga biaya
-- bahan sebuah produk bisa dibandingkan dengan penjualan produk yang sama.
-- Angkanya tetap estimasi sederhana: biaya bahan yang dibeli/dicatat, bukan bahan yang benar-benar terpakai.
-- Prasyarat: migration v21. Aman dijalankan ulang. Jalankan di Supabase Dashboard -> SQL Editor.

alter table public.transactions
  add column if not exists produk_terkait_id uuid references public.products(id) on delete set null;

create index if not exists transactions_produk_terkait_idx
  on public.transactions (user_id, produk_terkait_id)
  where produk_terkait_id is not null;

comment on column public.transactions.produk_terkait_id is 'Produk katalog yang dibuat dari bahan ini (opsional). Teks produk_terkait dipertahankan sebagai nama tampilan.';

-- Isi ulang relasi untuk data lama: cocokkan nama persis (tanpa beda huruf besar/kecil) hanya bila tepat satu produk cocok.
update public.transactions t
set produk_terkait_id = m.product_id
from (
  select t2.id as tx_id, (array_agg(p.id))[1] as product_id
  from public.transactions t2
  join public.products p on p.user_id = t2.user_id and lower(btrim(p.nama)) = lower(btrim(t2.produk_terkait))
  where t2.produk_terkait is not null and t2.produk_terkait_id is null
  group by t2.id
  having count(*) = 1
) m
where t.id = m.tx_id;

-- Mencari produk dari nama yang diucapkan/diketik. Mengembalikan null bila tidak ada atau ambigu.
create or replace function public.resolve_product_by_name(p_user_id uuid, p_nama text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := lower(btrim(coalesce(p_nama, '')));
  v_ids uuid[];
begin
  if v_name = '' then return null; end if;

  select array_agg(id) into v_ids from public.products
  where user_id = p_user_id and lower(btrim(nama)) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  if coalesce(array_length(v_ids, 1), 0) > 1 then return null; end if;

  -- Cocokkan sebagai bagian nama ("kue" -> "Kue Lapis"), hanya bila tepat satu produk.
  select array_agg(id) into v_ids from public.products
  where user_id = p_user_id and lower(nama) like '%' || replace(replace(v_name, '%', ''), '_', '') || '%';
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  return null;
end;
$$;

revoke all on function public.resolve_product_by_name(uuid, text) from public, anon, authenticated;

-- Pengelompokan biaya. Kategori yang tidak dikenal tidak lagi memicu galat: diperlakukan sebagai operasional.
-- Versi lama (3 argumen) diganti agar tidak ada dua fungsi bernama sama.
drop function if exists public.set_transaction_expense_category(uuid, text, text);

create or replace function public.set_transaction_expense_category(
  p_transaction_id uuid,
  p_kategori text,
  p_produk text default null,
  p_produk_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_kategori text;
  v_known boolean;
  v_produk_nama text := nullif(left(btrim(coalesce(p_produk, '')), 100), '');
  v_product_id uuid;
  v_entry_id uuid;
  v_code text;
  v_name text;
  v_account_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_tx from public.transactions where id = p_transaction_id and user_id = auth.uid();
  if not found then raise exception 'transaction_not_found'; end if;
  if v_tx.jenis <> 'biaya' then raise exception 'not_an_expense'; end if;

  v_known := p_kategori in ('bahan_produksi', 'operasional');
  v_kategori := case when v_known then p_kategori else 'operasional' end;

  if v_kategori = 'bahan_produksi' then
    if p_produk_id is not null then
      select id, nama into v_product_id, v_produk_nama
      from public.products where id = p_produk_id and user_id = v_tx.user_id;
      if v_product_id is null then raise exception 'product_not_found'; end if;
    else
      v_product_id := public.resolve_product_by_name(v_tx.user_id, v_produk_nama);
      if v_product_id is not null then
        select nama into v_produk_nama from public.products where id = v_product_id;
      end if;
    end if;
  else
    v_product_id := null;
    v_produk_nama := null;
  end if;

  update public.transactions
  set kategori_biaya = v_kategori,
      produk_terkait = v_produk_nama,
      produk_terkait_id = v_product_id
  where id = v_tx.id;

  v_code := case when v_kategori = 'bahan_produksi' then '5200' else '6000' end;
  v_name := case when v_kategori = 'bahan_produksi' then 'Biaya Bahan Produksi' else 'Beban Operasional' end;

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

  return jsonb_build_object(
    'ok', true,
    'kategori', v_kategori,
    'kategori_dikenal', v_known,
    'produk_id', v_product_id,
    'produk_terhubung', v_product_id is not null
  );
end;
$$;

revoke all on function public.set_transaction_expense_category(uuid, text, text, uuid) from public, anon;
grant execute on function public.set_transaction_expense_category(uuid, text, text, uuid) to authenticated;

-- Laporan: biaya bahan tercatat vs penjualan, per produk, untuk satu bulan (format YYYY-MM, WIB).
-- Baris tanpa produk_id = biaya bahan yang belum dikaitkan ke produk.
create or replace function public.biaya_bahan_per_produk(p_month text default null)
returns table (
  produk_id uuid,
  nama text,
  penjualan numeric,
  qty_terjual numeric,
  biaya_bahan_tercatat numeric,
  selisih_setelah_biaya_tercatat numeric
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_month text := coalesce(nullif(p_month, ''), to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'));
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_month'; end if;
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_start := (v_month || '-01')::date::timestamp at time zone 'Asia/Jakarta';
  v_end := ((v_month || '-01')::date + interval '1 month')::timestamp at time zone 'Asia/Jakarta';

  return query
  with sales as (
    select t.product_id as pid, sum(t.jumlah) as total, sum(coalesce(t.qty, 1)) as qty
    from public.transactions t
    where t.user_id = auth.uid() and t.jenis = 'penjualan' and t.product_id is not null
      and t.created_at >= v_start and t.created_at < v_end
    group by t.product_id
  ),
  costs as (
    select t.produk_terkait_id as pid, sum(t.jumlah) as total
    from public.transactions t
    where t.user_id = auth.uid() and t.jenis = 'biaya' and t.kategori_biaya = 'bahan_produksi'
      and t.created_at >= v_start and t.created_at < v_end
    group by t.produk_terkait_id
  ),
  merged as (
    select coalesce(s.pid, c.pid) as pid, coalesce(s.total, 0) as sales_total, coalesce(s.qty, 0) as sales_qty, coalesce(c.total, 0) as cost_total
    from sales s full outer join costs c on c.pid is not distinct from s.pid
  )
  select m.pid,
         case when m.pid is null then 'Belum dikaitkan ke produk' else coalesce(p.nama, 'Produk dihapus') end,
         m.sales_total::numeric, m.sales_qty::numeric, m.cost_total::numeric,
         (m.sales_total - m.cost_total)::numeric
  from merged m
  left join public.products p on p.id = m.pid and p.user_id = auth.uid()
  order by (m.pid is null), m.sales_total desc;
end;
$$;

revoke all on function public.biaya_bahan_per_produk(text) from public, anon;
grant execute on function public.biaya_bahan_per_produk(text) to authenticated;
