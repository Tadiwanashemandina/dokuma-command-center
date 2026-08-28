-- Leave workflow: types, balances, and the requests state machine
-- (pending_supervisor -> pending_hr -> approved/rejected).

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  days_per_year integer not null
);

create table if not exists public.leave_balances (
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year integer not null,
  days_allocated numeric(5, 1) not null,
  days_used numeric(5, 1) not null default 0,
  days_remaining numeric(5, 1) generated always as (days_allocated - days_used) stored,
  primary key (employee_id, leave_type_id, year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id),
  start_date date not null,
  end_date date not null,
  days_requested numeric(5, 1) not null check (days_requested > 0),
  reason text,
  status text not null default 'pending_supervisor'
    check (status in ('pending_supervisor', 'pending_hr', 'approved', 'rejected')),
  supervisor_id uuid references public.employees (id) on delete set null,
  supervisor_decision_at timestamptz,
  supervisor_comment text,
  hr_decision_at timestamptz,
  hr_comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_requests_employee_id on public.leave_requests (employee_id);
create index if not exists idx_leave_requests_supervisor_id on public.leave_requests (supervisor_id);
create index if not exists idx_leave_requests_status on public.leave_requests (status);
