import type { FilterQuery } from "mongoose";
import {
  DEPARTMENT_SCOPES,
  departmentScopeForRole,
  type DepartmentScope,
  type UserRole,
} from "@dokuma/shared";
import { Employee } from "../db/models/index.js";

/**
 * Query scoping — the replacement for Postgres Row Level Security
 * (inventory §4.3, §10, D-5).
 *
 * This is the highest-risk module in the migration, for one structural reason:
 *
 *   RLS fails CLOSED. A policy that does not grant access denies it.
 *   A Mongo filter fails OPEN. A filter you forget to apply returns everything.
 *
 * So scope is not a helper that callers may use — it is a required argument
 * that repository functions cannot be called without. `ScopeContext` has no
 * default and no "unscoped" convenience constructor; the only way to read
 * without a scope filter is `systemScope()`, which is named to be conspicuous
 * in review and is reserved for background jobs with no user behind them.
 *
 * Each predicate below cites the RLS policy it replaces so the two can be
 * diffed by hand.
 */

export interface ScopeContext {
  readonly userId: string;
  readonly role: UserRole;
  /**
   * The caller's own employee id, or null if their account has no employee
   * record. Equivalent to `public.current_employee_id()`.
   */
  readonly employeeId: string | null;
  /**
   * Department for the row-level scoping applied to risks and clients.
   * Equivalent to `departmentScopeForRole(role)`.
   */
  readonly department: DepartmentScope;
  /**
   * True only for internal jobs with no user. Set exclusively by
   * `systemScope()`.
   */
  readonly isSystem: boolean;
}

/** Builds the scope for an authenticated request. */
export async function scopeForUser(userId: string, role: UserRole): Promise<ScopeContext> {
  const employee = await Employee.findOne({ userId }).select("_id").lean();
  return {
    userId,
    role,
    employeeId: employee?._id ?? null,
    department: departmentScopeForRole(role),
    isSystem: false,
  };
}

/**
 * An unscoped context for internal work with no user behind it — the seed
 * script, the KPI refresh, the notification sweeps.
 *
 * Deliberately verbose to name at the call site. Never build one from request
 * data, and never fall back to it when a user lookup fails.
 */
export function systemScope(reason: string): ScopeContext {
  return {
    userId: `system:${reason}`,
    role: "admin",
    employeeId: null,
    department: null,
    isSystem: true,
  };
}

/* ------------------------------------------------------------------ *
 * Role tiers used by the predicates below
 * ------------------------------------------------------------------ */

/** Sees org-wide HR data. `public.current_role() in (...)` in every HR policy. */
const HR_VISIBILITY_TIER: readonly UserRole[] = ["admin", "exec", "hr_officer", "hr_manager"];

/** Reads finance tables. 0016 + 0018. */
const FINANCE_VISIBILITY_TIER: readonly UserRole[] = [
  "admin",
  "exec",
  "finance_officer",
  "finance_manager",
];

/** Reads people/activity data. 0011 `activity_records_select_admin_exec`. */
const ACTIVITY_VISIBILITY_TIER: readonly UserRole[] = ["admin", "exec"];

/* ------------------------------------------------------------------ *
 * Employee-owned records — the dominant HR pattern
 * ------------------------------------------------------------------ */

/**
 * Replaces the predicate repeated across seven HR tables (employees,
 * leave_balances, leave_requests, performance_reviews, training_records,
 * attendance_records, employee_tasks, jira_tasks_cache):
 *
 *   employee_id = current_employee_id()
 *   or is_supervisor_of(employee_id)
 *   or current_role() in ('admin','exec','hr_officer','hr_manager')
 *
 * Written once rather than eight times, because eight hand-written copies is
 * eight chances to omit a clause — and omitting one here fails open.
 *
 * `is_supervisor_of` matched DIRECT reports only: one level, no recursion up
 * or down the org chart. That is preserved exactly.
 */
export async function employeeScopeFilter(
  scope: ScopeContext,
  field = "employeeId",
): Promise<FilterQuery<Record<string, unknown>>> {
  if (scope.isSystem || HR_VISIBILITY_TIER.includes(scope.role)) {
    return {};
  }

  // No employee record means no self rows and no direct reports.
  if (scope.employeeId === null) {
    return { [field]: { $in: [] } };
  }

  const directReports = await Employee.find({ supervisorId: scope.employeeId })
    .select("_id")
    .lean();

  const visible = [scope.employeeId, ...directReports.map((e) => e._id)];
  return { [field]: { $in: visible } };
}

/**
 * The same rule for the `employees` collection itself, where the identity
 * column is `_id` rather than `employeeId`.
 */
export function employeeRecordScopeFilter(
  scope: ScopeContext,
): Promise<FilterQuery<Record<string, unknown>>> {
  return employeeScopeFilter(scope, "_id");
}

/** True when the caller may act on this specific employee's records. */
export async function canAccessEmployee(scope: ScopeContext, employeeId: string): Promise<boolean> {
  if (scope.isSystem || HR_VISIBILITY_TIER.includes(scope.role)) return true;
  if (scope.employeeId === null) return false;
  if (scope.employeeId === employeeId) return true;

  const employee = await Employee.findById(employeeId).select("supervisorId").lean();
  return employee?.supervisorId === scope.employeeId;
}

/** `public.is_supervisor_of(p_employee_id)` — direct reports only. */
export async function isSupervisorOf(scope: ScopeContext, employeeId: string): Promise<boolean> {
  if (scope.employeeId === null) return false;
  const employee = await Employee.findById(employeeId).select("supervisorId").lean();
  return employee?.supervisorId === scope.employeeId;
}

/* ------------------------------------------------------------------ *
 * Column masking
 * ------------------------------------------------------------------ */

/**
 * Replaces the `reason` masking in `v_leave_requests`.
 *
 * A supervisor reviewing a direct report's leave sees the dates, the type and
 * the day count, but never the stated reason. Only HR-tier roles and the
 * employee themselves see it. `supervisor_comment` and `hr_comment` were NOT
 * masked and remain visible.
 *
 * Migration 0026 fixed a real bug here: the view defaulted to
 * `security_invoker = false`, so base-table RLS was skipped and every
 * supervisor could read every other team's requests. In Mongo the masking and
 * the row filter are two independent things, so BOTH must be applied — this
 * function handles the column, `employeeScopeFilter` handles the rows.
 */
export function canSeeLeaveReason(scope: ScopeContext, requestEmployeeId: string): boolean {
  if (scope.isSystem) return true;
  if (HR_VISIBILITY_TIER.includes(scope.role)) return true;
  return scope.employeeId !== null && scope.employeeId === requestEmployeeId;
}

/** Applies the masking to one leave request row. */
export function maskLeaveReason<T extends { employeeId: string; reason: string | null }>(
  scope: ScopeContext,
  row: T,
): T {
  if (canSeeLeaveReason(scope, row.employeeId)) return row;
  return { ...row, reason: null };
}

/* ------------------------------------------------------------------ *
 * Department scoping (0030, inventory §4.5)
 * ------------------------------------------------------------------ */

/**
 * Scopes `risks_issues_decisions` and `clients`.
 *
 * There is deliberately NO fallback to untagged rows: a scoped role sees only
 * rows explicitly tagged with its own department, and `null`-department rows
 * are exec-only. ONBOARDING §7 flags this as intentional — do not "fix" it by
 * adding `{ department: null }` to the scoped branch.
 */
export function departmentScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem) return {};
  if (scope.department === null) {
    // Exec-tier: everything, tagged or not.
    return {};
  }
  return { department: scope.department };
}

/* ------------------------------------------------------------------ *
 * Table-level read gates
 * ------------------------------------------------------------------ */

/**
 * Tables whose RLS granted read to a fixed role list with no row predicate.
 * Returning a filter that matches nothing (rather than throwing) mirrors RLS,
 * which filtered to zero rows rather than erroring — see the note in migration
 * 0018 about the Finance page rendering blank rather than failing.
 *
 * Endpoints still enforce the role with `requireRole` middleware and return a
 * real 403; this is the second, data-layer line of defence.
 */
const DENY_ALL: FilterQuery<Record<string, unknown>> = { _id: { $in: [] } };

export function financeScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem || FINANCE_VISIBILITY_TIER.includes(scope.role)) return {};
  return DENY_ALL;
}

export function activityScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem || ACTIVITY_VISIBILITY_TIER.includes(scope.role)) return {};
  return DENY_ALL;
}

export function recruitmentScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem || HR_VISIBILITY_TIER.includes(scope.role)) return {};
  return DENY_ALL;
}

/**
 * `approvals_select` (0027): admin/exec/finance_manager/hr_manager, OR the
 * caller decided it, OR it is a leave request whose subject is the caller or
 * one of their direct reports.
 */
export async function approvalScopeFilter(
  scope: ScopeContext,
): Promise<FilterQuery<Record<string, unknown>>> {
  if (scope.isSystem) return {};
  if (["admin", "exec", "finance_manager", "hr_manager"].includes(scope.role)) return {};

  const clauses: FilterQuery<Record<string, unknown>>[] = [{ decidedBy: scope.userId }];

  if (scope.employeeId !== null) {
    const { LeaveRequest } = await import("../db/models/index.js");
    const directReports = await Employee.find({ supervisorId: scope.employeeId }).select("_id").lean();
    const visibleEmployees = [scope.employeeId, ...directReports.map((e) => e._id)];
    const requests = await LeaveRequest.find({ employeeId: { $in: visibleEmployees } })
      .select("_id")
      .lean();

    if (requests.length > 0) {
      clauses.push({
        approvableType: "leave_request",
        approvableId: { $in: requests.map((r) => r._id) },
      });
    }
  }

  return { $or: clauses };
}

/** `notifications_select_own` — you read only your own. */
export function notificationScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem) return {};
  return { userId: scope.userId };
}

/** `audit_log_select_admin_exec_finance_manager` (0013). */
export function auditLogScopeFilter(scope: ScopeContext): FilterQuery<Record<string, unknown>> {
  if (scope.isSystem || ["admin", "exec", "finance_manager"].includes(scope.role)) return {};
  return DENY_ALL;
}

/* ------------------------------------------------------------------ *
 * Document storage (0029)
 * ------------------------------------------------------------------ */

export type StorageBucket = "jd-documents" | "contracts" | "payslips" | "receipts";

/**
 * The four buckets' read rules, including the `<employee_id>/` folder-prefix
 * check on contracts and payslips (inventory §10, D-7).
 *
 * Note `exec` reads jd-documents and receipts but is NOT in the bypass list
 * for contracts or payslips. That asymmetry is in the original policies and is
 * preserved rather than normalized.
 */
export function canReadStorageObject(
  scope: ScopeContext,
  bucket: StorageBucket,
  objectPath: string,
): boolean {
  if (scope.isSystem) return true;

  switch (bucket) {
    case "jd-documents":
      return ["admin", "exec", "hr_officer", "hr_manager", "supervisor", "employee"].includes(scope.role);

    case "receipts":
      return FINANCE_VISIBILITY_TIER.includes(scope.role);

    case "contracts":
    case "payslips": {
      if (["admin", "hr_officer", "hr_manager"].includes(scope.role)) return true;
      // `(storage.foldername(name))[1] = current_employee_id()::text`
      const firstSegment = objectPath.split("/")[0];
      return scope.employeeId !== null && firstSegment === scope.employeeId;
    }

    default: {
      // An unknown bucket denies rather than defaulting open.
      const exhaustive: never = bucket;
      void exhaustive;
      return false;
    }
  }
}

export const DEPARTMENT_VALUES = DEPARTMENT_SCOPES;
