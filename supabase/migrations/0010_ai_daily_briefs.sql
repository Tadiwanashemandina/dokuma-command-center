-- CEO dashboard "today's focus" panel. Stub content for now (generated_by
-- defaults to 'stub'); a real LLM-generation step is a drop-in replacement
-- later since the page just reads the most recent row.

create table if not exists public.ai_daily_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null unique,
  headline text not null,
  body text not null,
  generated_by text not null default 'stub',
  created_at timestamptz not null default now()
);
