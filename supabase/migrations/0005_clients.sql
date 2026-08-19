-- Client & Stakeholder Management.
-- projects.client_id was declared without a FK in 0002 because clients didn't
-- exist yet; the FK is added here now that the referenced table exists.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  primary_contact_name text,
  primary_contact_email text,
  relationship_owner text,
  tier text check (tier in ('strategic', 'key', 'standard')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.projects
  add constraint projects_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete set null;

create index if not exists idx_projects_client_id on public.projects (client_id);
