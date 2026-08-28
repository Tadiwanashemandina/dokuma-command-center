-- Critical fix found during Phase 2 verification: by default, a Postgres
-- view executes queries against its underlying tables using the VIEW
-- OWNER's privileges, not the actual calling user's — so leave_requests'
-- row-level RLS policy was being silently skipped for anyone querying
-- through v_leave_requests, even though the reason-masking CASE expression
-- (which reads auth.uid()/current_role() directly, unrelated to view
-- ownership) was evaluating correctly. Net effect: every authenticated
-- Supervisor could see every OTHER team's leave requests (status/dates/
-- employee_id) through the view, though never the masked reason.
--
-- `security_invoker = true` (Postgres 15+) makes the view run as the
-- calling user instead, so the base table's RLS applies exactly as it does
-- for a direct query. Verified via a live reproduction before and after
-- this migration — see PR notes / conversation for the before/after query
-- output. The same fix is applied to v_training_expiring_soon, which had
-- the identical pattern.

alter view public.v_leave_requests set (security_invoker = true);
alter view public.v_training_expiring_soon set (security_invoker = true);
