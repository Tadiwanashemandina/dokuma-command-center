-- Department-scoped visibility for Risks/Issues/Decisions and Clients &
-- Stakeholders. Both tables were previously company-wide/unscoped — every
-- signed-in role saw every row. `department` narrows what Finance and HR
-- specialist roles see to what's actually theirs; admin/exec continue to
-- see everything, tagged or not.
--
-- null = general/company-wide (delivery, security, exec-level — visible
-- only to admin/exec in the department-scoped views built on top of this).
-- This is deliberately NOT a fallback Finance/HR roles see — "relevant to
-- the department" means explicitly tagged, not "untagged and therefore
-- default-visible".

alter table public.risks_issues_decisions
  add column if not exists department text check (department in ('finance', 'hr'));

alter table public.clients
  add column if not exists department text check (department in ('finance', 'hr'));

-- Backfill based on actual subject matter, not a guess spread evenly across
-- rows — most existing rows are delivery/technical/security concerns with
-- no real Finance or HR ownership, and stay null (company-wide/exec-only
-- in the scoped views). Only rows that are genuinely about Finance's own
-- remit are tagged; none of the seeded rows are genuinely HR's remit yet
-- (no HR-specific risk/issue/decision exists in the current data), so HR's
-- scoped view is correctly empty until real HR risk content is entered.
update public.risks_issues_decisions
set department = 'finance'
where title in (
  'Approve Phase 3 budget contingency',
  'Confirm Group resourcing split',
  'Retire manual weekly report',
  'Key engineer concentration on Finance Automation'
);

-- Independent Conveyancer Network is the counterparty behind the DLAP
-- conveyancer-fee revenue share Finance already tracks in its weekly
-- report; Dokuma Internal is the pseudo-client for Finance's own
-- reporting-automation initiative (relationship owner: the CFO). Neither
-- Deeds Registries Department nor Fossil Group Holdings has any Finance-
-- or HR-specific relevance — both are exec/delivery-level relationships
-- and stay null. No client is HR-relevant in the current data.
update public.clients
set department = 'finance'
where name in ('Independent Conveyancer Network', 'Dokuma Internal');
