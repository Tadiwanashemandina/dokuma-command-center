import type { UserRole } from "@/types/database.types";

// CEO Home ("/") and Company Overview are exec-tier only. Every other role
// gets sent straight to the module that's actually theirs instead of a
// company-wide view they have no reason to see.
export function roleHomePath(role: UserRole): string {
  switch (role) {
    case "admin":
    case "exec":
      return "/";
    case "finance_officer":
    case "finance_manager":
      return "/finance";
    case "employee":
    case "supervisor":
    case "hr_officer":
    case "hr_manager":
      return "/hr";
    default:
      return "/projects";
  }
}
