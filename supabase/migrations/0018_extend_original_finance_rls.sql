-- The original CEO-dashboard Finance RLS (0011_rls_policies.sql) predates
-- finance_officer/finance_manager and only allowed admin/exec to read
-- project_finance and finance_company_totals. Since the Finance overview
-- page now merges that content with the new Finance module for the same
-- roles, those two roles need read access here too, or the page silently
-- renders blank for them (RLS filters to zero rows, no error).

drop policy if exists "project_finance_select_admin_exec" on public.project_finance;
create policy "project_finance_select_admin_exec" on public.project_finance
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));

drop policy if exists "finance_company_totals_select_admin_exec" on public.finance_company_totals;
create policy "finance_company_totals_select_admin_exec" on public.finance_company_totals
  for select using (public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager'));
