-- Project Portfolio: projects, milestones and tasks.
-- client_id FK to public.clients is added in 0005 (clients doesn't exist yet at this point).

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text,
  status text not null default 'green' check (status in ('green', 'amber', 'red')),
  budget_usd numeric(14, 2),
  start_date date,
  target_end_date date,
  description text,
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'on_track', 'at_risk', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  assignee_name text,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists idx_milestones_project_id on public.milestones (project_id);
create index if not exists idx_tasks_project_id on public.tasks (project_id);
create index if not exists idx_tasks_due_date on public.tasks (due_date);
