-- Same "read-broad (to Finance + exec roles), write-only-via-service-role"
-- shape as the existing Finance RLS in 0011_rls_policies.sql. No client-side
-- INSERT/UPDATE policies exist because every write in this codebase goes
-- through a Server Action using the service-role client (which bypasses RLS
-- entirely) after an app-level requireRole() + zod check — see
-- lib/finance/transactions.ts and the Server Actions that call it. RLS here
-- is what stops a signed-in viewer/employee from reading Finance data
-- directly via the Supabase client, regardless of what the UI shows.

alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_reports enable row level security;
alter table public.finance_creditors enable row level security;
alter table public.finance_payment_notices enable row level security;

create policy "finance_accounts_select" on public.finance_accounts
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));

create policy "finance_transactions_select" on public.finance_transactions
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));

create policy "finance_reports_select" on public.finance_reports
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));

create policy "finance_creditors_select" on public.finance_creditors
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));

create policy "finance_payment_notices_select" on public.finance_payment_notices
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));
