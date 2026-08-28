-- HR module: employees and versioned job descriptions.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role_title text,
  department text,
  employment_date date,
  supervisor_id uuid references public.employees (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'on-leave', 'exited')),
  user_id uuid unique references auth.users (id) on delete set null,
  jira_account_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_supervisor_id on public.employees (supervisor_id);
create index if not exists idx_employees_user_id on public.employees (user_id);

-- Versioned: a new row per revision, never overwritten. "Current" for a
-- given employee/role is the row with the highest version.
create table if not exists public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees (id) on delete cascade,
  role_title text,
  responsibilities text,
  reporting_line text,
  requirements text,
  version integer not null default 1,
  effective_date date not null default current_date,
  created_at timestamptz not null default now(),
  check (employee_id is not null or role_title is not null)
);

create index if not exists idx_job_descriptions_employee_id on public.job_descriptions (employee_id, version desc);
