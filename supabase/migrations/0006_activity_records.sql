-- Shared activity table fed by the LazyBoss adapter (CSV import today, a real
-- API adapter later — see lib/datasources/lazyboss.ts). Both adapters
-- converge on this same shape; only how rows get in here differs by source.

create table if not exists public.activity_records (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  role text,
  department text,
  activity_date date not null,
  hours_today numeric(5, 2),
  on_project_minutes integer,
  off_project_minutes integer,
  screenshots_count integer,
  storage_used_mb numeric(10, 2),
  last_seen_at timestamptz,
  status text check (status in ('online', 'offline')),
  source text not null default 'csv' check (source in ('csv', 'api')),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (person_name, activity_date, source)
);

create index if not exists idx_activity_records_date on public.activity_records (activity_date);
