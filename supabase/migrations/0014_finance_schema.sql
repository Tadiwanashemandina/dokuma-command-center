-- Finance module: cash accounts, transactions, structured reports,
-- creditors, and payment notices.

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('bank', 'cash', 'mobile-money')),
  currency text not null default 'USD',
  opening_balance numeric(14, 2) not null default 0,
  current_balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A reversal is a real offsetting entry (equal and opposite amount) linked
-- back to the transaction it corrects, not a hard delete or a hidden flag.
-- This keeps the balance trigger simple (reversals net out arithmetically)
-- and keeps a full, honest audit trail — nothing ever disappears.
create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  date date not null default current_date,
  type text not null check (type in ('debit', 'credit')),
  amount numeric(14, 2) not null check (amount > 0),
  category text,
  counterparty text,
  description text,
  reference_no text,
  is_dlap boolean not null default false,
  dlap_share_pct numeric(5, 2),
  source text not null default 'manual' check (source in ('manual', 'excel-import')),
  reverses_transaction_id uuid references public.finance_transactions (id),
  is_reversed boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_transactions_account_date on public.finance_transactions (account_id, date);
create index if not exists idx_finance_transactions_date on public.finance_transactions (date);

create table if not exists public.finance_reports (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  content jsonb not null default '{}'::jsonb,
  generated_by uuid references auth.users (id) on delete set null,
  generated_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published'))
);

create index if not exists idx_finance_reports_type_period on public.finance_reports (type, period_start);

create table if not exists public.finance_creditors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount_owed numeric(14, 2) not null,
  due_date date,
  status text not null default 'outstanding' check (status in ('outstanding', 'partially_paid', 'paid')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_payment_notices (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  payee text not null,
  amount numeric(14, 2) not null,
  due_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'paid')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_payment_notices_due_date on public.finance_payment_notices (due_date);
