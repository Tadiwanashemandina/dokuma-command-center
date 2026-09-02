-- Generic approvals engine (Phase 3 shared infrastructure). leave_requests
-- keeps its own `status` column as the source of truth for its own state
-- machine (tested, working, read directly by the HR pages) — this table is
-- a parallel, queryable ledger so any future approval flow (a Finance
-- report sign-off, a payment notice authorization, etc.) can ask "what's
-- pending across the whole platform" from one place instead of each module
-- inventing its own. Written only via the service-role client, same as
-- every other table in this codebase.

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  approvable_type text not null,
  approvable_id uuid not null,
  step text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_approvals_approvable on public.approvals (approvable_type, approvable_id);
create index if not exists idx_approvals_status on public.approvals (status);

alter table public.approvals enable row level security;

-- Same self/direct-report/HR-tier shape as leave_requests for
-- approvable_type='leave_request' rows, plus admin/exec/finance_manager/
-- hr_manager see everything (the whole point of a shared engine), plus the
-- decider can always see their own decision.
create policy "approvals_select" on public.approvals
  for select using (
    public.current_role() in ('admin', 'exec', 'finance_manager', 'hr_manager')
    or decided_by = auth.uid()
    or (
      approvable_type = 'leave_request'
      and exists (
        select 1 from public.leave_requests lr
        where lr.id = approvals.approvable_id
          and (
            lr.employee_id = public.current_employee_id()
            or public.is_supervisor_of(lr.employee_id)
          )
      )
    )
  );
