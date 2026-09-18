/**
 * Department scoping — ported verbatim from lib/department-scope.ts.
 * Inventory §4.5.
 *
 * Applied to `risks_issues_decisions` and `clients`, which carry a nullable
 * `department` column constrained to ('finance','hr')
 * (supabase/migrations/0030_department_scoping.sql).
 *
 * There is deliberately NO fallback to untagged rows: a scoped role sees only
 * rows explicitly tagged with its department, and `null`-department rows are
 * exec-only. ONBOARDING §7 flags this as intentional. Preserve exactly.
 *
 * Note this is a different concept from the free-text `department` field on
 * employees / job_openings / LazyBoss CSV rows, which is unconstrained.
 */

import type { UserRole } from "./roles.js";

export type DepartmentScope = "finance" | "hr" | null;

export const DEPARTMENT_SCOPES = ["finance", "hr"] as const;

export function departmentScopeForRole(role: UserRole): DepartmentScope {
  switch (role) {
    case "finance_officer":
    case "finance_manager":
      return "finance";
    case "employee":
    case "supervisor":
    case "hr_officer":
    case "hr_manager":
      return "hr";
    default:
      return null;
  }
}
