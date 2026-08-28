-- Recruitment pipeline: openings, candidates, and their applications.

create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at date not null default current_date
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  resume_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  job_opening_id uuid not null references public.job_openings (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  stage text not null default 'applied'
    check (stage in ('applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected')),
  updated_at timestamptz not null default now(),
  unique (job_opening_id, candidate_id)
);

create index if not exists idx_applications_job_opening_id on public.applications (job_opening_id, stage);
