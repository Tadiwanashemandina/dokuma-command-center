-- Extend profiles.role with HR-specific roles (Phase 2). Kept in its own
-- migration, separate from Phase 1's finance role migration, so each
-- phase's schema changes stay scoped to what that phase needs.

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin', 'exec', 'viewer',
    'finance_officer', 'finance_manager',
    'employee', 'supervisor', 'hr_officer', 'hr_manager'
  ));
