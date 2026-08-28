-- Performance reviews, training records, attendance (manual, non-dev-staff
-- only — see README: dev staff attendance is derived from activity_records
-- instead), manually-typed employee tasks, and the Jira task cache.

create table if not exists public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  period text not null,
  reviewer_id uuid references public.employees (id) on delete set null,
  goals jsonb not null default '[]'::jsonb,
  rating text,
  comments text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  created_at timestamptz not null default now()
);

create index if not exists idx_performance_reviews_employee_id on public.performance_reviews (employee_id);

create table if not exists public.training_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  course_name text not null,
  provider text,
  completed_at date,
  certificate_url text,
  expires_at date,
  created_at timestamptz not null default now()
);

create index if not exists idx_training_records_employee_id on public.training_records (employee_id);
create index if not exists idx_training_records_expires_at on public.training_records (expires_at);

-- Manual daily check-in. In practice only used for staff not already
-- tracked via LazyBoss (see activity_records) — the Employee 360 page
-- prefers the LazyBoss-derived view for anyone with matching activity data.
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'on_leave')),
  source text not null default 'manual' check (source in ('manual', 'lazyboss')),
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);

-- Manually-typed tasks (by the employee or their supervisor) — kept
-- separate from jira_tasks_cache so the two sources are never conflated.
create table if not exists public.employee_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_tasks_employee_id on public.employee_tasks (employee_id);

-- Read-only cache of Jira issues assigned to an employee's linked Jira
-- account. Refreshed lazily (see lib/hr/jira.ts) when fetched_at is more
-- than 15 minutes old — this table IS the "every 15 minutes" refresh,
-- just pull-based instead of a cron push.
create table if not exists public.jira_tasks_cache (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  jira_issue_key text not null,
  summary text,
  status text,
  due_date date,
  url text,
  fetched_at timestamptz not null default now(),
  unique (employee_id, jira_issue_key)
);

create index if not exists idx_jira_tasks_cache_employee_id on public.jira_tasks_cache (employee_id);
