-- Finance: per-project economics, plus a company-level totals table so the
-- three headline USD KPIs (pipeline / contracted / receivables) are exact
-- figures rather than a sum over many synthetic per-project rows.

create table if not exists public.project_finance (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects (id) on delete cascade,
  budget_usd numeric(14, 2),
  cost_to_date_usd numeric(14, 2),
  revenue_pipeline_usd numeric(14, 2),
  contracted_revenue_usd numeric(14, 2),
  receivables_usd numeric(14, 2),
  as_of_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_company_totals (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null unique,
  revenue_pipeline_usd numeric(14, 2) not null,
  contracted_revenue_usd numeric(14, 2) not null,
  outstanding_receivables_usd numeric(14, 2) not null,
  created_at timestamptz not null default now()
);

-- Margin is derived, not stored, so it can never drift out of sync with budget/cost.
create or replace view public.v_project_margins as
select
  pf.project_id,
  pf.budget_usd,
  pf.cost_to_date_usd,
  case
    when pf.budget_usd is null or pf.budget_usd = 0 then null
    else round(((pf.budget_usd - pf.cost_to_date_usd) / pf.budget_usd) * 100, 2)
  end as margin_pct
from public.project_finance pf;
