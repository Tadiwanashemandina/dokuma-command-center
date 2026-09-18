/**
 * Role definitions — ported verbatim from types/database.types.ts (UserRole)
 * and the profiles.role CHECK constraint in
 * supabase/migrations/0019_hr_role_enum.sql.
 *
 * Inventory §4.1. Do not add, remove, or rename a role here without changing
 * the Mongoose enum on the User model to match.
 */

export const USER_ROLES = [
  "admin",
  "exec",
  "viewer",
  "finance_officer",
  "finance_manager",
  "employee",
  "supervisor",
  "hr_officer",
  "hr_manager",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Recurring role tiers. These mirror the exact arrays passed to requireRole()
 * across the current app — see inventory §2 and §3.2. Named so an Express
 * route reads the same way the Server Action it replaces did.
 */

/** Finance pages: read access. */
export const FINANCE_READ: readonly UserRole[] = [
  "admin",
  "exec",
  "finance_officer",
  "finance_manager",
];

/** Finance mutations: create transactions, creditors, notices, drafts. */
export const FINANCE_WRITE: readonly UserRole[] = [
  "admin",
  "finance_officer",
  "finance_manager",
];

/** Finance approve / publish / status-edit. */
export const FINANCE_APPROVE: readonly UserRole[] = ["admin", "finance_manager"];

/** Every role with any HR module access. */
export const HR_ALL: readonly UserRole[] = [
  "admin",
  "exec",
  "employee",
  "supervisor",
  "hr_officer",
  "hr_manager",
];

/** HR-tier: sees org-wide HR data (open roles, all leave, all records). */
export const HR_TIER: readonly UserRole[] = ["admin", "exec", "hr_officer", "hr_manager"];

/** HR mutations. */
export const HR_WRITE: readonly UserRole[] = ["admin", "hr_officer", "hr_manager"];

/** Performance review creation — supervisors included. */
export const PERFORMANCE_CREATE: readonly UserRole[] = [
  "admin",
  "supervisor",
  "hr_officer",
  "hr_manager",
];

/** Leave submission — anyone who may hold an employee record. */
export const LEAVE_SUBMIT: readonly UserRole[] = [
  "admin",
  "employee",
  "supervisor",
  "hr_officer",
  "hr_manager",
];

/**
 * First leave-approval step — the requesting employee's supervisor.
 * `supervisorDecisionAction` in app/(dashboard)/hr/leave/actions.ts.
 * Note this is role membership only; the action additionally checks that the
 * caller actually supervises the requester (the old is_supervisor_of RLS
 * predicate), which becomes an explicit service-layer check.
 */
export const LEAVE_DECIDE_SUPERVISOR: readonly UserRole[] = ["admin", "supervisor"];

/** Second leave-approval step — HR sign-off. */
export const LEAVE_DECIDE_HR: readonly UserRole[] = ["admin", "hr_officer", "hr_manager"];

/** Executive-only surfaces: CEO Home, /company, /people. */
export const EXEC_ONLY: readonly UserRole[] = ["admin", "exec"];

/** Admin-only surfaces: LazyBoss CSV import. */
export const ADMIN_ONLY: readonly UserRole[] = ["admin"];

/**
 * Roles that would be required to hold a verified TOTP factor.
 * Ported from lib/supabase/mfa.ts — admin and exec are deliberately excluded
 * (see the comment in lib/supabase/server.ts).
 *
 * This is the policy, not the switch: read MFA_REQUIRED_ROLES below, which is
 * empty while MFA is disabled.
 */
export const MFA_POLICY_ROLES: readonly UserRole[] = [
  "finance_officer",
  "finance_manager",
  "hr_officer",
  "hr_manager",
];

/**
 * MFA is currently DISABLED across the app. Every gate reads
 * `MFA_REQUIRED_ROLES`, so emptying it turns off enrollment prompts, the
 * `requireMfa` middleware and the client-side redirects in one place.
 *
 * To turn MFA back on, set MFA_ENABLED=true in the server environment (or
 * simply export MFA_POLICY_ROLES here again). The enroll/verify routes,
 * services and models are all left intact — nothing was deleted.
 */
export const MFA_ENABLED = false;

export const MFA_REQUIRED_ROLES: readonly UserRole[] = MFA_ENABLED ? MFA_POLICY_ROLES : [];

/**
 * Per-role landing route. Ported verbatim from lib/role-home.ts.
 * `viewer` has no module of its own and falls through to /projects
 * (inventory §10, D-14 — preserved deliberately).
 */
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

/**
 * Month-end capture of the Group KPI register.
 *
 * Wider than EXEC_ONLY on purpose: §9 of the Group's KPI & Ingestion
 * Specification describes the 41 manual measures as typed in by "Dokuma's own
 * finance and operations people" as part of the month-end routine. Gating
 * capture on exec would mean the only people permitted to enter the figures are
 * the people the figures are for — impractical, and poor separation of duties.
 *
 * READING the board view stays EXEC_ONLY. This widens who may write, not who
 * may see. Both the Express route and the client route guard read this constant,
 * so the gate cannot drift between them.
 */
export const GROUP_CAPTURE: readonly UserRole[] = [
  "admin",
  "exec",
  "finance_officer",
  "finance_manager",
  "hr_officer",
  "hr_manager",
];
