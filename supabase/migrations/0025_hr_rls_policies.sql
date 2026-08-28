-- Same shape used throughout this codebase: enable RLS, grant SELECT based
-- on self / direct-report / HR-tier role. Writes go through Server Actions
-- using the service-role client after an app-level requireRole() check —
-- see lib/hr/*.ts — so no INSERT/UPDATE policies are needed here (the
-- service role bypasses RLS by design).
--
-- v_leave_requests and v_training_expiring_soon are views, not tables —
-- they run with the querying user's own privileges, so they automatically
-- inherit the RLS on leave_requests/training_records below. No separate
-- policy is possible or needed for a view itself.

alter table public.employees enable row level security;
alter table public.job_descriptions enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.job_openings enable row level security;
alter table public.candidates enable row level security;
alter table public.applications enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.training_records enable row level security;
alter table public.attendance_records enable row level security;
alter table public.employee_tasks enable row level security;
alter table public.jira_tasks_cache enable row level security;

create policy "employees_select" on public.employees
  for select using (
    user_id = auth.uid()
    or public.is_supervisor_of(id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "job_descriptions_select" on public.job_descriptions
  for select using (
    public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager', 'supervisor', 'employee')
  );

create policy "leave_types_select" on public.leave_types
  for select using (public.current_role() is not null);

create policy "leave_balances_select" on public.leave_balances
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "leave_requests_select" on public.leave_requests
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "job_openings_select" on public.job_openings
  for select using (public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager'));

create policy "candidates_select" on public.candidates
  for select using (public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager'));

create policy "applications_select" on public.applications
  for select using (public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager'));

create policy "performance_reviews_select" on public.performance_reviews
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "training_records_select" on public.training_records
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "attendance_records_select" on public.attendance_records
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "employee_tasks_select" on public.employee_tasks
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );

create policy "jira_tasks_cache_select" on public.jira_tasks_cache
  for select using (
    employee_id = public.current_employee_id()
    or public.is_supervisor_of(employee_id)
    or public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager')
  );
