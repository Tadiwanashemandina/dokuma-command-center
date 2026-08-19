-- Dokuma Command Centre — illustrative seed data.
--
-- The following CEO KPIs are seeded to their EXACT confirmed figures from the
-- Dokuma AI Executive Command Centre concept doc and are stable regardless of
-- when this script runs: 12 active projects, 7 Green / 3 Amber / 2 Red,
-- 6 critical blockers, USD 4.2m revenue pipeline, USD 2.1m contracted
-- revenue, USD 480k outstanding receivables, 78.0% team utilisation,
-- 3 high-risk projects.
--
-- "Tasks Due This Week" (87) and "Overdue Tasks" (19) are rolling,
-- date-relative windows — they are tuned to land on exactly 87/19 the moment
-- this script runs, but will drift as real dates pass. That is expected and
-- documented in the README; it is not a bug.

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
insert into public.clients (name, industry, primary_contact_name, primary_contact_email, relationship_owner, tier, notes) values
  ('Deeds Registries Department', 'Government / Public Sector', 'S. Chikwanha', 'schikwanha@deeds.gov.zw', 'Webster Maposa', 'strategic', 'Government partner under the DLAP arrangement — data residency and classification safeguards apply.'),
  ('Fossil Group Holdings', 'Group / Conglomerate', 'Collins Jimu', 'collins.jimu@fossilgroup.com', 'Webster Maposa', 'strategic', 'Group Digital Transformation Initiative sponsor; Dokuma architecture proposed as Group platform core.'),
  ('Independent Conveyancer Network', 'Legal Services', 'T. Mangwiro', 't.mangwiro@iconveyancers.co.zw', 'Don Yambira', 'key', 'Represents the 300+ firm / 1,000+ conveyancer onboarding programme.'),
  ('Dokuma Internal', 'Internal', 'Lorraine Shoko', 'lorraine.shoko@dokuma.co.zw', 'Lorraine Shoko', 'standard', 'Internal-only initiatives with no external client.');

-- ---------------------------------------------------------------------------
-- Projects — 7 Green / 3 Amber / 2 Red (12 total)
-- ---------------------------------------------------------------------------
insert into public.projects (name, owner_name, status, budget_usd, start_date, target_end_date, description, client_id) values
  ('DLAP Conveyancer Onboarding Phase 2', 'Don Yambira', 'green', 620000, current_date - interval '120 days', current_date + interval '60 days', 'Onboarding the next tranche of conveyancer firms onto the DLAP platform.', (select id from public.clients where name = 'Independent Conveyancer Network')),
  ('Client Portal Revamp', 'Tanaka Mangwiro', 'green', 180000, current_date - interval '60 days', current_date + interval '45 days', 'Redesign of the client-facing conveyancer portal.', (select id from public.clients where name = 'Independent Conveyancer Network')),
  ('Finance Reporting Automation', 'Lorraine Shoko', 'green', 95000, current_date - interval '90 days', current_date + interval '20 days', 'Automating monthly management accounts preparation.', (select id from public.clients where name = 'Dokuma Internal')),
  ('Mobile App v2 Rollout', 'Nicole Maposa', 'green', 210000, current_date - interval '75 days', current_date + interval '30 days', 'Second-generation Dokuma mobile application.', (select id from public.clients where name = 'Dokuma Internal')),
  ('AI Daily Brief Rollout', 'Godwin Ndarevani', 'green', 60000, current_date - interval '30 days', current_date + interval '40 days', 'Executive daily brief generation pipeline.', (select id from public.clients where name = 'Dokuma Internal')),
  ('BYO3 Admin Register Automation', 'Tribute Mhaka', 'green', 130000, current_date - interval '100 days', current_date + interval '15 days', 'Automating the Bulawayo Phase 3 admin register.', (select id from public.clients where name = 'Independent Conveyancer Network')),
  ('Group Command Centre Integration', 'Webster Maposa', 'green', 340000, current_date - interval '45 days', current_date + interval '90 days', 'Aligning Dokuma''s command centre architecture with the Group platform.', (select id from public.clients where name = 'Fossil Group Holdings')),
  ('eConveyancer Platform Upgrade', 'Jethro Sithole', 'amber', 275000, current_date - interval '80 days', current_date + interval '25 days', 'Core platform upgrade for the eConveyancer application.', (select id from public.clients where name = 'Independent Conveyancer Network')),
  ('Data Warehouse Migration', 'Mphokuhle Ncube', 'amber', 150000, current_date - interval '50 days', current_date + interval '35 days', 'Migrating reporting data to the new warehouse.', (select id from public.clients where name = 'Dokuma Internal')),
  ('Regional Expansion — Eswatini', 'Collins Jimu', 'amber', 400000, current_date - interval '40 days', current_date + interval '120 days', 'Extending DLAP-style delivery into Eswatini.', (select id from public.clients where name = 'Fossil Group Holdings')),
  ('Deeds Registries API Integration', 'Webster Maposa', 'red', 220000, current_date - interval '150 days', current_date - interval '10 days', 'Direct API integration with the Deeds Registries Department — behind schedule.', (select id from public.clients where name = 'Deeds Registries Department')),
  ('Security & Compliance Hardening', 'Collins Jimu', 'red', 110000, current_date - interval '70 days', current_date + interval '5 days', 'Zimbabwe Cyber and Data Protection Act alignment work — critical path blocked.', (select id from public.clients where name = 'Dokuma Internal'));

-- ---------------------------------------------------------------------------
-- Milestones — a couple per project
-- ---------------------------------------------------------------------------
insert into public.milestones (project_id, name, due_date, status)
select p.id, m.name, current_date + m.offset_days, m.status
from public.projects p
cross join lateral (
  values
    ('Requirements sign-off', -20, 'done'),
    ('Go-live readiness review', 15, 'on_track')
) as m(name, offset_days, status);

-- ---------------------------------------------------------------------------
-- Tasks
-- Exactly 87 open tasks due within the next 7 days, exactly 19 open tasks
-- already overdue, plus a batch of completed tasks for realism.
-- ---------------------------------------------------------------------------
with proj as (
  select array_agg(id order by name) as ids from public.projects
),
assignees as (
  select array[
    'Tanaka Mangwiro', 'Nicole Maposa', 'Godwin Ndarevani', 'Tribute Mhaka',
    'Jethro Sithole', 'Mphokuhle Ncube', 'Don Yambira', 'Lorraine Shoko',
    'Collins Jimu', 'Webster Maposa'
  ] as names
)
insert into public.tasks (project_id, title, assignee_name, due_date, status)
select
  (select ids[1 + (n % array_length(ids, 1))] from proj),
  'Due-this-week task ' || n,
  (select names[1 + (n % array_length(names, 1))] from assignees),
  current_date + (n % 8),
  (array['todo', 'in_progress', 'blocked'])[1 + (n % 3)]
from generate_series(0, 86) as n;

with proj as (
  select array_agg(id order by name) as ids from public.projects
),
assignees as (
  select array[
    'Tanaka Mangwiro', 'Nicole Maposa', 'Godwin Ndarevani', 'Tribute Mhaka',
    'Jethro Sithole', 'Mphokuhle Ncube', 'Don Yambira', 'Lorraine Shoko'
  ] as names
)
insert into public.tasks (project_id, title, assignee_name, due_date, status)
select
  (select ids[1 + (n % array_length(ids, 1))] from proj),
  'Overdue task ' || n,
  (select names[1 + (n % array_length(names, 1))] from assignees),
  current_date - (1 + (n % 14)),
  (array['todo', 'in_progress', 'blocked'])[1 + (n % 3)]
from generate_series(0, 18) as n;

with proj as (
  select array_agg(id order by name) as ids from public.projects
)
insert into public.tasks (project_id, title, assignee_name, due_date, status)
select
  (select ids[1 + (n % array_length(ids, 1))] from proj),
  'Completed task ' || n,
  'Team',
  current_date - (5 + n),
  'done'
from generate_series(0, 19) as n;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
insert into public.finance_company_totals (as_of_date, revenue_pipeline_usd, contracted_revenue_usd, outstanding_receivables_usd)
values (current_date, 4200000, 2100000, 480000)
on conflict (as_of_date) do update set
  revenue_pipeline_usd = excluded.revenue_pipeline_usd,
  contracted_revenue_usd = excluded.contracted_revenue_usd,
  outstanding_receivables_usd = excluded.outstanding_receivables_usd;

insert into public.project_finance (project_id, budget_usd, cost_to_date_usd, revenue_pipeline_usd, contracted_revenue_usd, receivables_usd, as_of_date)
select
  p.id,
  p.budget_usd,
  round(p.budget_usd * (0.35 + (random() * 0.35))::numeric, 2),
  round(p.budget_usd * 0.4, 2),
  round(p.budget_usd * 0.55, 2),
  round(p.budget_usd * 0.08, 2),
  current_date
from public.projects p;

-- ---------------------------------------------------------------------------
-- Risks, Issues & Decisions
-- Exactly 6 open critical risks across exactly 3 distinct projects
-- (High-Risk Projects KPI = 3), plus additional rows for variety.
-- ---------------------------------------------------------------------------
insert into public.risks_issues_decisions (type, title, description, project_id, owner_name, due_date, severity, probability, impact, status) values
  ('risk', 'Deeds Registries API contract delay', 'Government counterpart has not confirmed the integration contract window.', (select id from public.projects where name = 'Deeds Registries API Integration'), 'Webster Maposa', current_date + 5, 'critical', 'high', 'high', 'open'),
  ('risk', 'Legacy API rate limits', 'Deeds Registries legacy endpoint throttles under production load.', (select id from public.projects where name = 'Deeds Registries API Integration'), 'Collins Jimu', current_date + 10, 'critical', 'medium', 'high', 'open'),
  ('risk', 'Compliance sign-off outstanding', 'Zimbabwe Cyber and Data Protection Act review not yet signed off by legal.', (select id from public.projects where name = 'Security & Compliance Hardening'), 'Collins Jimu', current_date + 3, 'critical', 'high', 'high', 'open'),
  ('risk', 'Penetration test findings unresolved', 'Three high-severity findings from the last pentest remain open.', (select id from public.projects where name = 'Security & Compliance Hardening'), 'Jethro Sithole', current_date + 7, 'critical', 'high', 'high', 'open'),
  ('risk', 'Warehouse migration data-loss exposure', 'Cutover plan has no verified rollback path yet.', (select id from public.projects where name = 'Data Warehouse Migration'), 'Mphokuhle Ncube', current_date + 12, 'critical', 'medium', 'high', 'open'),
  ('risk', 'Reporting downtime during cutover', 'Executive reporting will be unavailable for an unconfirmed window during migration.', (select id from public.projects where name = 'Data Warehouse Migration'), 'Lorraine Shoko', current_date + 12, 'critical', 'medium', 'medium', 'open'),
  ('issue', 'Eswatini data residency clarification needed', 'Hosting location not yet confirmed against local regulation.', (select id from public.projects where name = 'Regional Expansion — Eswatini'), 'Collins Jimu', current_date + 20, 'high', null, null, 'open'),
  ('issue', 'Conveyancer training backlog', 'Several firms still awaiting onboarding training slots.', (select id from public.projects where name = 'DLAP Conveyancer Onboarding Phase 2'), 'Don Yambira', current_date + 8, 'medium', null, null, 'mitigating'),
  ('decision', 'Approve Phase 3 budget contingency', 'Exec decision needed on releasing the 15% contingency for Phase 3.', (select id from public.projects where name = 'eConveyancer Platform Upgrade'), 'Webster Maposa', current_date + 4, 'high', null, null, 'open'),
  ('decision', 'Confirm Group resourcing split', 'Whether part of the Command Centre build is funded from the Group transformation budget.', null, 'Webster Maposa', current_date + 14, 'medium', null, null, 'open'),
  ('issue', 'Mobile app crash on older Android versions', 'Crash reports on Android 9 devices post-release.', (select id from public.projects where name = 'Mobile App v2 Rollout'), 'Nicole Maposa', current_date - 2, 'medium', null, null, 'open'),
  ('risk', 'Key engineer concentration on Finance Automation', 'Single point of failure — one engineer holds all context.', (select id from public.projects where name = 'Finance Reporting Automation'), 'Lorraine Shoko', current_date + 30, 'low', 'low', 'medium', 'mitigating'),
  ('decision', 'Retire manual weekly report', 'Confirm the manual DLAP weekly report is retired now the module is live.', (select id from public.projects where name = 'DLAP Conveyancer Onboarding Phase 2'), 'Don Yambira', current_date - 5, 'low', null, null, 'closed');

-- ---------------------------------------------------------------------------
-- Activity records (LazyBoss-shaped) — one day, tuned to exactly 78.0%
-- team utilisation regardless of headcount (each row's on/off ratio is
-- exactly 78% on its own, so any mix of these rows aggregates to 78.0%).
-- ---------------------------------------------------------------------------
insert into public.activity_records (person_name, role, department, activity_date, hours_today, on_project_minutes, off_project_minutes, screenshots_count, storage_used_mb, last_seen_at, status, source) values
  ('Tanaka Mangwiro', 'Business Systems Analyst', 'Delivery', current_date, 8.33, 390, 110, 142, 380.5, now() - interval '5 minutes', 'online', 'csv'),
  ('Nicole Maposa', 'Mobile Engineer', 'Engineering', current_date, 8.33, 390, 110, 168, 410.2, now() - interval '2 minutes', 'online', 'csv'),
  ('Godwin Ndarevani', 'Backend Engineer', 'Engineering', current_date, 8.33, 390, 110, 155, 395.0, now() - interval '10 minutes', 'online', 'csv'),
  ('Tribute Mhaka', 'QA Analyst', 'Delivery', current_date, 8.33, 390, 110, 133, 300.1, now() - interval '20 minutes', 'online', 'csv'),
  ('Jethro Sithole', 'Platform Engineer', 'Engineering', current_date, 8.33, 390, 110, 149, 360.7, now() - interval '1 minutes', 'online', 'csv'),
  ('Mphokuhle Ncube', 'Data Engineer', 'Engineering', current_date, 8.33, 390, 110, 121, 290.4, now() - interval '15 minutes', 'online', 'csv'),
  ('Don Yambira', 'Commercial Manager', 'Commercial', current_date, 8.33, 390, 110, 60, 120.0, now() - interval '30 minutes', 'online', 'csv'),
  ('Lorraine Shoko', 'CFO', 'Finance', current_date, 8.33, 390, 110, 45, 90.3, now() - interval '25 minutes', 'online', 'csv'),
  ('Collins Jimu', 'CTO', 'Engineering', current_date, 8.33, 390, 110, 58, 110.6, now() - interval '8 minutes', 'online', 'csv'),
  ('Webster Maposa', 'CEO', 'Executive', current_date, 8.33, 390, 110, 40, 80.2, now() - interval '3 minutes', 'online', 'csv'),
  ('Alex Chirwa', 'Junior Developer', 'Engineering', current_date, 5.00, 234, 66, 98, 210.0, now() - interval '40 minutes', 'offline', 'csv'),
  ('Nomsa Dube', 'Support Analyst', 'Delivery', current_date, 5.00, 234, 66, 87, 195.4, now() - interval '55 minutes', 'offline', 'csv'),
  ('Prince Moyo', 'QA Engineer', 'Delivery', current_date, 5.00, 234, 66, 102, 220.8, now() - interval '45 minutes', 'offline', 'csv'),
  ('Ruth Chikafu', 'Product Analyst', 'Commercial', current_date, 5.00, 234, 66, 71, 160.3, now() - interval '90 minutes', 'offline', 'csv'),
  ('Simon Gwara', 'DevOps Engineer', 'Engineering', current_date, 5.00, 234, 66, 110, 250.1, now() - interval '12 minutes', 'online', 'csv'),
  ('Faith Muronda', 'HR & People Ops', 'People', current_date, 5.00, 234, 66, 52, 100.9, now() - interval '75 minutes', 'offline', 'csv');

-- ---------------------------------------------------------------------------
-- Delivery metrics (illustrative)
-- ---------------------------------------------------------------------------
insert into public.delivery_metrics (project_id, repo_name, metric_date, commits_count, deploys_count, open_defects_count, closed_defects_count, source)
select
  (select id from public.projects where name = 'Mobile App v2 Rollout'),
  'dokuma/mobile-app', current_date - d, (5 + (d % 4)), (d % 3 = 0)::int, (3 + (d % 3)), (d % 5), 'illustrative'
from generate_series(0, 6) as d
union all
select
  (select id from public.projects where name = 'Client Portal Revamp'),
  'dokuma/client-portal', current_date - d, (3 + (d % 3)), (d % 4 = 0)::int, (2 + (d % 2)), (d % 4), 'illustrative'
from generate_series(0, 6) as d
union all
select
  (select id from public.projects where name = 'Deeds Registries API Integration'),
  'dokuma/deeds-api-integration', current_date - d, (2 + (d % 2)), 0, (6 + (d % 3)), (d % 2), 'illustrative'
from generate_series(0, 6) as d;

-- ---------------------------------------------------------------------------
-- Meetings & action items
-- ---------------------------------------------------------------------------
with meeting_1 as (
  insert into public.meetings (title, meeting_date, attendees, source_notes)
  values ('DLAP Stakeholders Sync', current_date - 3, array['Don Yambira', 'Tanaka Mangwiro', 'Webster Maposa'], 'Discussed onboarding backlog and training capacity.')
  returning id
)
insert into public.meeting_action_items (meeting_id, description, owner_name, due_date, status)
select id, 'Schedule additional training slots for pending firms', 'Don Yambira', current_date + 5, 'open' from meeting_1
union all
select id, 'Circulate updated onboarding tracker', 'Tanaka Mangwiro', current_date - 1, 'open' from meeting_1;

with meeting_2 as (
  insert into public.meetings (title, meeting_date, attendees, source_notes)
  values ('Exco Financial Review', current_date - 7, array['Lorraine Shoko', 'Webster Maposa', 'Don Yambira'], 'Reviewed management accounts and receivables ageing.')
  returning id
)
insert into public.meeting_action_items (meeting_id, description, owner_name, due_date, status)
select id, 'Follow up on outstanding receivables over 60 days', 'Lorraine Shoko', current_date + 2, 'open' from meeting_2
union all
select id, 'Prepare FY2027 revenue projection draft', 'Lorraine Shoko', current_date + 21, 'open' from meeting_2;

with meeting_3 as (
  insert into public.meetings (title, meeting_date, attendees, source_notes)
  values ('Security & Compliance Working Session', current_date - 2, array['Collins Jimu', 'Jethro Sithole'], 'Walked through outstanding pentest findings and remediation plan.')
  returning id
)
insert into public.meeting_action_items (meeting_id, description, owner_name, due_date, status)
select id, 'Patch high-severity findings on API gateway', 'Jethro Sithole', current_date + 3, 'open' from meeting_3
union all
select id, 'Get legal sign-off on data protection review', 'Collins Jimu', current_date + 3, 'open' from meeting_3;

with meeting_4 as (
  insert into public.meetings (title, meeting_date, attendees, source_notes)
  values ('Group Digital Transformation Check-in', current_date - 10, array['Webster Maposa', 'Collins Jimu'], 'Aligned Dokuma command centre architecture with Group-wide platform plans.')
  returning id
)
insert into public.meeting_action_items (meeting_id, description, owner_name, due_date, status)
select id, 'Draft Group resourcing proposal for exec review', 'Webster Maposa', current_date + 14, 'open' from meeting_4
union all
select id, 'Share data model documentation with Group Working Team', 'Collins Jimu', current_date - 4, 'done' from meeting_4;

-- ---------------------------------------------------------------------------
-- AI daily brief (stub)
-- ---------------------------------------------------------------------------
insert into public.ai_daily_briefs (brief_date, headline, body, generated_by)
values (
  current_date,
  'Three critical blockers need executive attention this week.',
  'Portfolio health is broadly stable: 7 of 12 projects are Green. Two Red projects — Deeds Registries API Integration and Security & Compliance Hardening — account for all 6 open critical risks and both need an executive decision this week. Team utilisation is holding at 78%. Outstanding receivables sit at $480k; Finance flagged one account over 60 days overdue for follow-up. Recommended focus today: unblock the Deeds Registries contract timeline and confirm the compliance sign-off before the Security & Compliance Hardening milestone slips further.',
  'stub'
)
on conflict (brief_date) do update set
  headline = excluded.headline,
  body = excluded.body,
  generated_by = excluded.generated_by;

-- ---------------------------------------------------------------------------
-- Snapshot the CEO KPI view into kpi_feed.
-- ---------------------------------------------------------------------------
select public.refresh_kpi_feed();
