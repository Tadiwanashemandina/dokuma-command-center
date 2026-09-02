-- Document storage: four private buckets. Two are wired to a real upload
-- flow in this phase (jd-documents, receipts); contracts/payslips are
-- created with correct policies now so the next real consumer (a future
-- HR contract-upload feature) doesn't have to touch RLS at all — just build
-- the upload Server Action. All buckets are private; nothing is served via
-- a public URL, only signed URLs the app generates after an RLS-gated read.

insert into storage.buckets (id, name, public)
values
  ('jd-documents', 'jd-documents', false),
  ('contracts', 'contracts', false),
  ('payslips', 'payslips', false),
  ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- jd-documents: same broad readability as job_descriptions itself — no
-- per-employee folder scoping needed since that table's own RLS
-- (0025_hr_rls_policies.sql) already grants read to every HR-tier/
-- supervisor/employee role, not just self/direct-reports.
create policy "jd_documents_select" on storage.objects
  for select using (
    bucket_id = 'jd-documents'
    and public.current_role() in ('admin', 'exec', 'hr_officer', 'hr_manager', 'supervisor', 'employee')
  );

-- contracts / payslips: HR-tier sees everything; an employee sees only
-- objects under their own employee-id folder prefix (path convention:
-- `<employee_id>/<filename>`).
create policy "contracts_select" on storage.objects
  for select using (
    bucket_id = 'contracts'
    and (
      public.current_role() in ('admin', 'hr_officer', 'hr_manager')
      or (storage.foldername(name))[1] = public.current_employee_id()::text
    )
  );

create policy "payslips_select" on storage.objects
  for select using (
    bucket_id = 'payslips'
    and (
      public.current_role() in ('admin', 'hr_officer', 'hr_manager')
      or (storage.foldername(name))[1] = public.current_employee_id()::text
    )
  );

-- receipts: Finance-tier only, matching finance_transactions' own RLS.
create policy "receipts_select" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and public.current_role() in ('admin', 'exec', 'finance_officer', 'finance_manager')
  );

-- No INSERT/UPDATE/DELETE policies: every upload goes through a Server
-- Action using the service-role client after an app-level requireRole()
-- check, exactly like every other write path in this codebase — the
-- service role bypasses Storage RLS the same way it bypasses table RLS.

alter table public.job_descriptions add column if not exists attachment_path text;
alter table public.finance_transactions add column if not exists receipt_path text;
