-- Extend profiles.role with Finance-specific roles (Phase 1 of the Finance/HR
-- build). HR's roles (hr_officer, hr_manager, supervisor, employee) land in
-- Phase 2's own migration, kept separate so each phase's schema changes are
-- scoped to what that phase actually needs.
--
-- 'admin' remains a platform superuser. 'exec' remains the read-only
-- CEO/Exec tier across every module, including Finance. 'viewer' remains
-- the no-access-to-sensitive-modules default.

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'exec', 'viewer', 'finance_officer', 'finance_manager'));
