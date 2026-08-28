-- Generic audit log. Built now (Phase 1) because the Finance Excel import
-- needs an audit trail immediately; Phase 3 extends usage of this same
-- table to HR decisions rather than introducing a second audit mechanism.
-- Written exclusively via the service-role client from Server Actions,
-- same pattern as every other write path in this codebase.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_entity on public.audit_log (entity_type, entity_id);
create index if not exists idx_audit_log_created_at on public.audit_log (created_at);

alter table public.audit_log enable row level security;

create policy "audit_log_select_admin_exec_finance_manager" on public.audit_log
  for select using (public.current_role() in ('admin', 'exec', 'finance_manager'));
