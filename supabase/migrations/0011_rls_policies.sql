-- Enable RLS everywhere. Only SELECT policies are defined for the
-- authenticated/anon roles — there is no write UI yet besides the LazyBoss
-- CSV import, which runs through the service-role client and therefore
-- bypasses RLS entirely (Supabase's service_role Postgres role has
-- bypassrls), so no insert/update/delete policy is needed for that path.

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.project_finance enable row level security;
alter table public.finance_company_totals enable row level security;
alter table public.risks_issues_decisions enable row level security;
alter table public.clients enable row level security;
alter table public.activity_records enable row level security;
alter table public.delivery_metrics enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_action_items enable row level security;
alter table public.kpi_feed enable row level security;
alter table public.ai_daily_briefs enable row level security;

-- profiles: a user may only see their own profile row.
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

-- Finance tables: admin/exec only.
create policy "project_finance_select_admin_exec" on public.project_finance
  for select using (public.current_role() in ('admin', 'exec'));

create policy "finance_company_totals_select_admin_exec" on public.finance_company_totals
  for select using (public.current_role() in ('admin', 'exec'));

-- People/activity data: admin/exec only.
create policy "activity_records_select_admin_exec" on public.activity_records
  for select using (public.current_role() in ('admin', 'exec'));

-- Everything else: readable by any authenticated user with a profile.
create policy "projects_select_authenticated" on public.projects
  for select using (public.current_role() is not null);

create policy "milestones_select_authenticated" on public.milestones
  for select using (public.current_role() is not null);

create policy "tasks_select_authenticated" on public.tasks
  for select using (public.current_role() is not null);

create policy "risks_issues_decisions_select_authenticated" on public.risks_issues_decisions
  for select using (public.current_role() is not null);

create policy "clients_select_authenticated" on public.clients
  for select using (public.current_role() is not null);

create policy "delivery_metrics_select_authenticated" on public.delivery_metrics
  for select using (public.current_role() is not null);

create policy "meetings_select_authenticated" on public.meetings
  for select using (public.current_role() is not null);

create policy "meeting_action_items_select_authenticated" on public.meeting_action_items
  for select using (public.current_role() is not null);

create policy "kpi_feed_select_authenticated" on public.kpi_feed
  for select using (public.current_role() is not null);

create policy "ai_daily_briefs_select_authenticated" on public.ai_daily_briefs
  for select using (public.current_role() is not null);
