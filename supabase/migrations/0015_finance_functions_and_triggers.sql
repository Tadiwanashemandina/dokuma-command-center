-- Shared running-balance function — every report (daily/weekly/monthly)
-- calls this for its opening/closing figures, so the math only lives once.
create or replace function public.get_account_balance_as_of(
  p_account_id uuid,
  p_as_of_date date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select
    a.opening_balance
    + coalesce(sum(case when t.type = 'credit' then t.amount else 0 end), 0)
    - coalesce(sum(case when t.type = 'debit' then t.amount else 0 end), 0)
  from public.finance_accounts a
  left join public.finance_transactions t
    on t.account_id = a.id and t.date <= p_as_of_date
  where a.id = p_account_id
  group by a.opening_balance;
$$;

-- Keeps finance_accounts.current_balance correct automatically on every
-- transaction insert (including reversals, which are just new rows with an
-- opposite amount — they net out here with no special-casing needed). This
-- is also what powers the realtime Cash Position panel: the browser
-- subscribes to finance_accounts, and this trigger is what changes it.
create or replace function public.recompute_account_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.finance_accounts
  set current_balance = public.get_account_balance_as_of(NEW.account_id, current_date)
  where id = NEW.account_id;
  return NEW;
end;
$$;

drop trigger if exists trg_recompute_account_balance on public.finance_transactions;
create trigger trg_recompute_account_balance
  after insert on public.finance_transactions
  for each row execute function public.recompute_account_balance();

-- Flags transactions on check_date whose absolute amount exceeds 2x the
-- account's trailing 30-day average absolute transaction amount (the 30-day
-- window excludes check_date itself, so a big transaction can't inflate its
-- own baseline).
create or replace function public.get_unusual_transactions(
  p_account_id uuid,
  p_check_date date
)
returns setof public.finance_transactions
language sql
stable
security definer
set search_path = public
as $$
  with baseline as (
    select avg(abs(amount)) as avg_amount
    from public.finance_transactions
    where account_id = p_account_id
      and date >= p_check_date - interval '30 days'
      and date < p_check_date
  )
  select t.*
  from public.finance_transactions t, baseline b
  where t.account_id = p_account_id
    and t.date = p_check_date
    and b.avg_amount is not null
    and abs(t.amount) > 2 * b.avg_amount;
$$;
