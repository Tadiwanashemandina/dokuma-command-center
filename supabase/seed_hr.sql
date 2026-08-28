-- Phase 2 HR module seed data. Run once via
-- `supabase db query -f supabase/seed_hr.sql --linked` after migrations
-- 0019-0025 and after the HR test accounts have been created (their
-- user_id values are backfilled by name match below).
--
-- Reuses the same named people already seeded elsewhere on the platform
-- (activity_records, projects.owner_name) so the whole system reads as one
-- consistent company, rather than inventing a second cast of characters.

insert into public.employees (full_name, role_title, department, employment_date, status) values
  ('Webster Maposa', 'CEO', 'Executive', '2022-01-10', 'active'),
  ('Collins Jimu', 'CTO', 'Engineering', '2022-02-01', 'active'),
  ('Lorraine Shoko', 'CFO', 'Finance', '2022-02-01', 'active'),
  ('Don Yambira', 'Commercial Manager', 'Commercial', '2022-03-15', 'active'),
  ('Faith Muronda', 'HR & People Ops', 'People', '2022-06-01', 'active'),
  ('Jethro Sithole', 'Engineering Team Lead', 'Engineering', '2022-05-01', 'active'),
  ('Tadiwanashe Mandina', 'Business Systems Analyst', 'Delivery', '2023-01-09', 'active'),
  ('Tanaka Mangwiro', 'Business Systems Analyst', 'Delivery', '2023-02-01', 'active'),
  ('Nicole Maposa', 'Mobile Engineer', 'Engineering', '2023-03-01', 'active'),
  ('Godwin Ndarevani', 'Backend Engineer', 'Engineering', '2023-03-01', 'active'),
  ('Tribute Mhaka', 'QA Analyst', 'Delivery', '2023-04-01', 'active'),
  ('Mphokuhle Ncube', 'Data Engineer', 'Engineering', '2023-04-15', 'active'),
  ('Alex Chirwa', 'Junior Developer', 'Engineering', '2024-01-15', 'active'),
  ('Nomsa Dube', 'Support Analyst', 'Delivery', '2023-06-01', 'active'),
  ('Prince Moyo', 'QA Engineer', 'Delivery', '2023-07-01', 'active'),
  ('Ruth Chikafu', 'Product Analyst', 'Commercial', '2023-08-01', 'active'),
  ('Simon Gwara', 'DevOps Engineer', 'Engineering', '2023-05-01', 'active');

-- Org chart (self-referencing, applied after all rows exist).
update public.employees set supervisor_id = (select id from public.employees where full_name = 'Webster Maposa')
  where full_name in ('Collins Jimu', 'Lorraine Shoko', 'Don Yambira');
update public.employees set supervisor_id = (select id from public.employees where full_name = 'Lorraine Shoko')
  where full_name = 'Faith Muronda';
update public.employees set supervisor_id = (select id from public.employees where full_name = 'Collins Jimu')
  where full_name in ('Jethro Sithole', 'Nicole Maposa', 'Godwin Ndarevani', 'Tribute Mhaka', 'Mphokuhle Ncube', 'Prince Moyo', 'Simon Gwara');
update public.employees set supervisor_id = (select id from public.employees where full_name = 'Jethro Sithole')
  where full_name in ('Tadiwanashe Mandina', 'Alex Chirwa');
update public.employees set supervisor_id = (select id from public.employees where full_name = 'Don Yambira')
  where full_name in ('Tanaka Mangwiro', 'Nomsa Dube', 'Ruth Chikafu');

-- Real Jira account, confirmed live against dokumadigital.atlassian.net
-- during this build — lets the Employee 360 Jira section be tested against
-- genuine issues, not a mock.
update public.employees set jira_account_id = '712020:5812a4a8-eece-49dc-bfcb-362c1a7de25d'
  where full_name = 'Tadiwanashe Mandina';

-- Link the four HR test accounts (created separately via the Auth Admin
-- API) to their employee rows by matching auth.users.email.
update public.employees e set user_id = u.id
  from auth.users u
  where u.email = 'employee@dokuma.local' and e.full_name = 'Tadiwanashe Mandina';
update public.employees e set user_id = u.id
  from auth.users u
  where u.email = 'supervisor@dokuma.local' and e.full_name = 'Jethro Sithole';
update public.employees e set user_id = u.id
  from auth.users u
  where u.email = 'hr-officer@dokuma.local' and e.full_name = 'Faith Muronda';
update public.employees e set user_id = u.id
  from auth.users u
  where u.email = 'hr-manager@dokuma.local' and e.full_name = 'Lorraine Shoko';

-- Job descriptions (version 1 for a couple of people).
insert into public.job_descriptions (employee_id, role_title, responsibilities, reporting_line, requirements, version, effective_date)
select id, 'Business Systems Analyst',
  'Gather and document business requirements for the DLAP platform; liaise between conveyancer firms and the engineering team; maintain the onboarding tracker.',
  'Reports to the Engineering Team Lead',
  '3+ years business analysis experience; familiarity with legal/conveyancing workflows preferred.',
  1, '2023-01-09'
from public.employees where full_name = 'Tadiwanashe Mandina';

insert into public.job_descriptions (employee_id, role_title, responsibilities, reporting_line, requirements, version, effective_date)
select id, 'Engineering Team Lead',
  'Owns technical delivery for the DLAP and Command Centre workstreams; mentors engineering staff; escalates delivery risk to the CTO.',
  'Reports to the CTO',
  '5+ years software engineering, 1+ years leading a team.',
  1, '2022-05-01'
from public.employees where full_name = 'Jethro Sithole';

-- Leave types and this year's balances for the four test-linked employees.
insert into public.leave_types (name, days_per_year) values
  ('Annual Leave', 21),
  ('Sick Leave', 10),
  ('Compassionate Leave', 5)
on conflict (name) do nothing;

insert into public.leave_balances (employee_id, leave_type_id, year, days_allocated, days_used)
select e.id, lt.id, extract(year from current_date)::int, lt.days_per_year, 0
from public.employees e
cross join public.leave_types lt
where e.full_name in ('Tadiwanashe Mandina', 'Jethro Sithole', 'Faith Muronda', 'Lorraine Shoko', 'Alex Chirwa')
on conflict (employee_id, leave_type_id, year) do nothing;

-- Leave requests in three different states, so the workflow has real data
-- to click through immediately. The first one is inserted as
-- 'pending_supervisor' and then walked through an UPDATE to 'approved' in
-- two steps deliberately — recompute_leave_balance() only fires on UPDATE,
-- so inserting a row already 'approved' would silently skip the balance
-- deduction (caught during Phase 2 verification). Going through the real
-- transition here means the seed exercises the same trigger path
-- production traffic does.
insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, reason, status, supervisor_id)
select
  (select id from public.employees where full_name = 'Alex Chirwa'),
  (select id from public.leave_types where name = 'Annual Leave'),
  current_date - 30, current_date - 27, 3,
  'Family event out of town.',
  'pending_supervisor',
  (select id from public.employees where full_name = 'Jethro Sithole');

update public.leave_requests
set status = 'pending_hr', supervisor_decision_at = now() - interval '29 days', supervisor_comment = 'Fine, team coverage confirmed.'
where employee_id = (select id from public.employees where full_name = 'Alex Chirwa') and status = 'pending_supervisor';

update public.leave_requests
set status = 'approved', hr_decision_at = now() - interval '28 days', hr_comment = 'Approved — balance updated.'
where employee_id = (select id from public.employees where full_name = 'Alex Chirwa') and status = 'pending_hr';

insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, reason, status, supervisor_id)
select
  (select id from public.employees where full_name = 'Tadiwanashe Mandina'),
  (select id from public.leave_types where name = 'Annual Leave'),
  current_date + 10, current_date + 14, 5,
  'Pre-booked family trip to Victoria Falls.',
  'pending_supervisor',
  (select id from public.employees where full_name = 'Jethro Sithole');

insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, reason, status, supervisor_id, supervisor_decision_at, supervisor_comment)
select
  (select id from public.employees where full_name = 'Tanaka Mangwiro'),
  (select id from public.leave_types where name = 'Sick Leave'),
  current_date + 1, current_date + 2, 2,
  'Recovering from minor surgery.',
  'pending_hr',
  (select id from public.employees where full_name = 'Don Yambira'),
  now() - interval '1 day', 'Approved, hope you feel better.';

-- Performance review.
insert into public.performance_reviews (employee_id, reviewer_id, period, goals, rating, comments, status)
select
  (select id from public.employees where full_name = 'Tadiwanashe Mandina'),
  (select id from public.employees where full_name = 'Jethro Sithole'),
  'Q2 2026',
  '[{"text": "Complete the DLAP Phase 2 requirements document"}, {"text": "Improve conveyancer onboarding turnaround time"}]'::jsonb,
  'Exceeds Expectations',
  'Consistently clear requirements docs and strong stakeholder communication this quarter.',
  'acknowledged'
;

-- Training — one expiring soon so the HR overview/training expiry panel has
-- something real to show.
insert into public.training_records (employee_id, course_name, provider, completed_at, expires_at)
select
  (select id from public.employees where full_name = 'Simon Gwara'),
  'First Aid & Workplace Safety', 'Red Cross Zimbabwe', current_date - 350, current_date + 15;

insert into public.training_records (employee_id, course_name, provider, completed_at, expires_at)
select
  (select id from public.employees where full_name = 'Tadiwanashe Mandina'),
  'Business Analysis Fundamentals', 'IIBA', current_date - 100, null;

-- Manual attendance for a non-dev-staff employee (Commercial dept — not
-- tracked via LazyBoss), demonstrating the manual fallback path.
insert into public.attendance_records (employee_id, date, status, source)
select (select id from public.employees where full_name = 'Ruth Chikafu'), current_date - n,
  case when n = 3 then 'absent' else 'present' end, 'manual'
from generate_series(0, 6) as n;

-- Recruitment: one open role with candidates spread across the pipeline.
insert into public.job_openings (title, department, status) values
  ('Senior Backend Engineer', 'Engineering', 'open');

insert into public.candidates (full_name, email, phone) values
  ('Tinashe Moyo', 'tinashe.moyo@example.com', '+263771234567'),
  ('Rutendo Chikwanha', 'rutendo.c@example.com', '+263772345678'),
  ('Farai Ndlovu', 'farai.ndlovu@example.com', '+263773456789');

insert into public.applications (job_opening_id, candidate_id, stage)
select
  (select id from public.job_openings where title = 'Senior Backend Engineer'),
  c.id,
  case c.full_name
    when 'Tinashe Moyo' then 'interview'
    when 'Rutendo Chikwanha' then 'shortlisted'
    else 'applied'
  end
from public.candidates c
where c.full_name in ('Tinashe Moyo', 'Rutendo Chikwanha', 'Farai Ndlovu');

-- A couple of manually-typed tasks, distinct from the Jira-cached ones.
insert into public.employee_tasks (employee_id, title, description, due_date, status)
select
  (select id from public.employees where full_name = 'Tadiwanashe Mandina'),
  'Prepare August conveyancer onboarding summary', 'For the DLAP Stakeholders Sync.', current_date + 3, 'in_progress';
