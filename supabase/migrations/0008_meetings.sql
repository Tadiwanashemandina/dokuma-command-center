-- Meeting Intelligence: meetings and the action items extracted from them.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  meeting_date date not null,
  attendees text[],
  source_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  description text not null,
  owner_name text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_action_items_meeting_id on public.meeting_action_items (meeting_id);
