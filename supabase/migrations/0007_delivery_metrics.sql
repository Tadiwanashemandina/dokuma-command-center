-- Software Delivery Intelligence. Shaped so a future GitHub webhook/Action
-- can insert rows with source='github' without a schema change.

create table if not exists public.delivery_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  repo_name text not null,
  metric_date date not null,
  commits_count integer not null default 0,
  deploys_count integer not null default 0,
  open_defects_count integer not null default 0,
  closed_defects_count integer not null default 0,
  source text not null default 'manual' check (source in ('manual', 'github', 'illustrative')),
  created_at timestamptz not null default now(),
  unique (repo_name, metric_date, source)
);

create index if not exists idx_delivery_metrics_project_id on public.delivery_metrics (project_id);
create index if not exists idx_delivery_metrics_date on public.delivery_metrics (metric_date);
