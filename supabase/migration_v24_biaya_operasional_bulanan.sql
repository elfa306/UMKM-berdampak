-- CAVA migration v24: pisahkan beban rutin bulanan dari biaya yang mengurangi untung harian.
-- Prasyarat: migration v21, v22, dan v23.
-- Jalankan melalui Supabase Dashboard -> SQL Editor.

begin;

alter table public.transactions
  add column if not exists periode_biaya text;

alter table public.transactions
  drop constraint if exists transactions_periode_biaya_check;

alter table public.transactions
  add constraint transactions_periode_biaya_check
  check (periode_biaya is null or periode_biaya in ('harian', 'bulanan'));

comment on column public.transactions.periode_biaya is
  'Periode pengakuan untuk ringkasan harian: harian atau bulanan. Biaya bulanan tetap masuk laporan laba rugi bulanan.';

-- Isi periode transaksi lama berdasarkan keterangan.
update public.transactions
set periode_biaya = case
  when lower(coalesce(keterangan, '')) ~ '\y(listrik|pln|token|pdam|wifi|internet|sewa|kontrakan|langganan|gas|elpiji|lpg)\y'
    then 'bulanan'
  else 'harian'
end
where jenis = 'biaya' and periode_biaya is null;

update public.transactions
set periode_biaya = null
where jenis <> 'biaya' and periode_biaya is not null;

create or replace function public.set_transaction_expense_period()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.jenis <> 'biaya' then
    new.periode_biaya := null;
    return new;
  end if;

  if new.periode_biaya is null then
    if lower(coalesce(new.keterangan, '')) ~ '\y(listrik|pln|token|pdam|wifi|internet|sewa|kontrakan|langganan|gas|elpiji|lpg)\y' then
      new.periode_biaya := 'bulanan';
    else
      new.periode_biaya := 'harian';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_set_expense_period on public.transactions;
create trigger transactions_set_expense_period
  before insert or update of jenis, keterangan, periode_biaya
  on public.transactions
  for each row
  execute function public.set_transaction_expense_period();

-- Saldo kas/bank tetap menghitung seluruh pembayaran. daily_expenses hanya
-- mengurangi biaya harian, bukan tagihan yang mencakup satu periode bulanan.
create or replace function public.get_business_cash_balances(
  p_before_date date default ((now() at time zone 'Asia/Jakarta')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cash numeric(16,2) := 0;
  v_bank numeric(16,2) := 0;
  v_setup boolean := false;
  v_daily_revenue numeric(16,2) := 0;
  v_daily_cogs numeric(16,2) := 0;
  v_daily_expenses numeric(16,2) := 0;
  v_date date := coalesce(p_before_date, (now() at time zone 'Asia/Jakarta')::date);
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.business_opening_balances where user_id = v_user
  ) into v_setup;

  select
    coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = '1000'), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = '1010'), 0)
  into v_cash, v_bank
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.entry_id and je.user_id = jl.user_id
  where jl.user_id = v_user and je.entry_date < v_date;

  select
    coalesce(sum(jl.credit - jl.debit) filter (where jl.account_type = 'revenue'), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code in ('5000', '5100')), 0),
    coalesce(sum(jl.debit - jl.credit) filter (
      where jl.account_type = 'expense'
        and jl.account_code not in ('5000', '5100')
        and not (
          (
            je.source_type = 'transaction'
            and exists (
              select 1
              from public.transactions tx
              where tx.id::text = je.source_id
                and tx.user_id = je.user_id
                and tx.periode_biaya = 'bulanan'
            )
          )
          or lower(coalesce(je.description, '')) ~ '\y(listrik|pln|token|pdam|wifi|internet|sewa|kontrakan|langganan|gas|elpiji|lpg)\y'
        )
    ), 0)
  into v_daily_revenue, v_daily_cogs, v_daily_expenses
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.entry_id and je.user_id = jl.user_id
  where jl.user_id = v_user and je.entry_date = v_date - 1;

  return jsonb_build_object(
    'setup_complete', v_setup,
    'cash_balance', v_cash,
    'bank_balance', v_bank,
    'daily_revenue', v_daily_revenue,
    'daily_cogs', v_daily_cogs,
    'daily_expenses', v_daily_expenses,
    'before_date', v_date
  );
end;
$$;

revoke all on function public.get_business_cash_balances(date) from public, anon;
grant execute on function public.get_business_cash_balances(date) to authenticated;

revoke all on function public.set_transaction_expense_period() from public, anon, authenticated;

commit;
