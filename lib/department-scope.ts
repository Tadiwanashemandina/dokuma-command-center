import type { UserRole } from "@/types/database.types";

export type DepartmentScope = "finance" | "hr" | null;

// admin/exec/viewer see everything (null = unscoped); Finance and HR
// specialist roles see only rows explicitly tagged for their department —
// there's no fallback to untagged/company-wide rows, since "relevant to
// the department" means explicitly relevant, not merely unclassified.
export function departmentScopeForRole(role: UserRole): DepartmentScope {
  if (role === "finance_officer" || role === "finance_manager") return "finance";
  if (role === "employee" || role === "supervisor" || role === "hr_officer" || role === "hr_manager") return "hr";
  return null;
}
