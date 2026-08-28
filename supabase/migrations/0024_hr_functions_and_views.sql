-- Shared helper, mirroring current_role() from the core platform.
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_supervisor_of(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees
    where id = p_employee_id and supervisor_id = public.current_employee_id()
  );
$$;

-- Column-level masking: Supervisors approving a direct report's leave see
-- dates/type/day-count, never the stated reason — HR, admin, exec, and the
-- employee themselves see the real value. This is enforced here, in the
-- view every page queries, not left to each page to remember to omit the
-- column. Row-level access is still governed entirely by the base table's
-- RLS (0025) — this view adds no additional row filtering of its own.
create or replace view public.v_leave_requests as
select
  lr.id,
  lr.employee_id,
  lr.leave_type_id,
  lr.start_date,
  lr.end_date,
  lr.days_requested,
  case
    when public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
      or lr.employee_id = public.current_employee_id()
    then lr.reason
    else null
  end as reason,
  lr.status,
  lr.supervisor_id,
  lr.supervisor_decision_at,
  lr.supervisor_comment,
  lr.hr_decision_at,
  lr.hr_comment,
  lr.created_at
from public.leave_requests lr;

-- Keeps leave_balances.days_used correct automatically the moment a
-- request reaches 'approved' — mirrors Phase 1's balance-trigger idiom
-- (recompute_account_balance) so this can never drift from application code.
create or replace function public.recompute_leave_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'approved' and OLD.status <> 'approved' then
    insert into public.leave_balances (employee_id, leave_type_id, year, days_allocated, days_used)
    values (NEW.employee_id, NEW.leave_type_id, extract(year from NEW.start_date)::int, 0, NEW.days_requested)
    on conflict (employee_id, leave_type_id, year)
    do update set days_used = public.leave_balances.days_used + excluded.days_used;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_recompute_leave_balance on public.leave_requests;
create trigger trg_recompute_leave_balance
  after update on public.leave_requests
  for each row execute function public.recompute_leave_balance();

create or replace view public.v_training_expiring_soon as
select *
from public.training_records
where expires_at is not null
  and expires_at between current_date and current_date + interval '30 days';
