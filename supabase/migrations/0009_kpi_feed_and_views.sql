-- The CEO dashboard and the Group-facing kpi_feed table must never be two
-- separate sources of truth. v_ceo_dashboard_kpis computes every headline
-- figure live from the underlying tables; refresh_kpi_feed() snapshots that
-- same view into kpi_feed. The dashboard page queries the view directly.

create or replace view public.v_ceo_dashboard_kpis as
select
  (select count(*) from public.projects) as active_projects,
  (select count(*) from public.projects where status = 'green') as projects_green,
  (select count(*) from public.projects where status = 'amber') as projects_amber,
  (select count(*) from public.projects where status = 'red') as projects_red,
  (
    select count(*) from public.tasks
    where status <> 'done'
      and due_date between current_date and current_date + interval '7 days'
  ) as tasks_due_this_week,
  (
    select count(*) from public.tasks
    where status <> 'done' and due_date < current_date
  ) as overdue_tasks,
  (
    select count(*) from public.risks_issues_decisions
    where type = 'risk' and severity = 'critical' and status = 'open'
  ) as critical_blockers,
  (
    select revenue_pipeline_usd from public.finance_company_totals
    order by as_of_date desc limit 1
  ) as revenue_pipeline_usd,
  (
    select contracted_revenue_usd from public.finance_company_totals
    order by as_of_date desc limit 1
  ) as contracted_revenue_usd,
  (
    select outstanding_receivables_usd from public.finance_company_totals
    order by as_of_date desc limit 1
  ) as outstanding_receivables_usd,
  (
    select round(
      100.0 * sum(on_project_minutes) / nullif(sum(on_project_minutes) + sum(off_project_minutes), 0),
      1
    )
    from public.activity_records
    where activity_date = (select max(activity_date) from public.activity_records)
  ) as team_utilisation_pct,
  (
    select count(distinct project_id) from public.risks_issues_decisions
    where severity = 'critical' and status = 'open' and project_id is not null
  ) as high_risk_projects;

create table if not exists public.kpi_feed (
  id uuid primary key default gen_random_uuid(),
  company text not null default 'Dokuma',
  metric_name text not null,
  value numeric,
  unit text,
  as_of_date date not null default current_date,
  updated_at timestamptz not null default now(),
  unique (company, metric_name, as_of_date)
);

create or replace function public.refresh_kpi_feed()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k record;
  today date := current_date;
begin
  select * into k from public.v_ceo_dashboard_kpis;

  insert into public.kpi_feed (company, metric_name, value, unit, as_of_date, updated_at)
  values
    ('Dokuma', 'active_projects', k.active_projects, 'count', today, now()),
    ('Dokuma', 'projects_green', k.projects_green, 'count', today, now()),
    ('Dokuma', 'projects_amber', k.projects_amber, 'count', today, now()),
    ('Dokuma', 'projects_red', k.projects_red, 'count', today, now()),
    ('Dokuma', 'tasks_due_this_week', k.tasks_due_this_week, 'count', today, now()),
    ('Dokuma', 'overdue_tasks', k.overdue_tasks, 'count', today, now()),
    ('Dokuma', 'critical_blockers', k.critical_blockers, 'count', today, now()),
    ('Dokuma', 'revenue_pipeline_usd', k.revenue_pipeline_usd, 'usd', today, now()),
    ('Dokuma', 'contracted_revenue_usd', k.contracted_revenue_usd, 'usd', today, now()),
    ('Dokuma', 'outstanding_receivables_usd', k.outstanding_receivables_usd, 'usd', today, now()),
    ('Dokuma', 'team_utilisation_pct', k.team_utilisation_pct, 'pct', today, now()),
    ('Dokuma', 'high_risk_projects', k.high_risk_projects, 'count', today, now())
  on conflict (company, metric_name, as_of_date)
  do update set value = excluded.value, unit = excluded.unit, updated_at = excluded.updated_at;
end;
$$;
