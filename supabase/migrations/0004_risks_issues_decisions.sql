-- Central register for risks, issues and decisions.
-- Critical Blockers and High-Risk Projects KPIs both derive from this table.

create table if not exists public.risks_issues_decisions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('risk', 'issue', 'decision')),
  title text not null,
  description text,
  project_id uuid references public.projects (id) on delete set null,
  owner_name text,
  due_date date,
  severity text check (severity in ('low', 'medium', 'high', 'critical')),
  probability text check (probability in ('low', 'medium', 'high')),
  impact text check (impact in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'mitigating', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rid_type on public.risks_issues_decisions (type);
create index if not exists idx_rid_status on public.risks_issues_decisions (status);
create index if not exists idx_rid_project_id on public.risks_issues_decisions (project_id);
