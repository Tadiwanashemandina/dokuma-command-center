import type { ClientSession } from "mongoose";
import { HttpError } from "../middleware/error.js";
import {
  User,
  Project,
  Milestone,
  Task,
  Client,
  RiskIssueDecision,
  DeliveryMetric,
  Meeting,
  MeetingActionItem,
  Notification,
} from "./models/core.js";
import { FinanceAccount, FinanceTransaction, ProjectFinance } from "./models/finance.js";
import {
  Employee,
  JobDescription,
  LeaveBalance,
  LeaveRequest,
  JobOpening,
  Candidate,
  Application,
  PerformanceReview,
  TrainingRecord,
  AttendanceRecord,
  EmployeeTask,
  JiraTaskCache,
} from "./models/hr.js";

/**
 * Referential integrity: the application-level replacement for the source
 * schema's `REFERENCES ... ON DELETE CASCADE / SET NULL / RESTRICT` clauses.
 *
 * Mongo enforces none of this. Postgres deleted a parent row and the database
 * itself removed or nulled every child; here a delete that does not go through
 * one of these functions leaves orphans behind, and an orphan in
 * `leave_requests` or `finance_transactions` is a row no authorization filter
 * matches — invisible to the UI but still present in the data.
 *
 * Every delete therefore goes through this module, never through
 * `Model.deleteOne()` directly. Each function documents the exact SQL clause
 * it stands in for.
 *
 * All of these take an optional session and should be called inside a
 * transaction where one is available: a cascade interrupted halfway leaves the
 * database in a state Postgres would never have produced.
 */

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

/**
 * Deletes a project.
 *
 * - `milestones.project_id` ON DELETE CASCADE (0002)
 * - `tasks.project_id` ON DELETE CASCADE (0002)
 * - `project_finance.project_id` ON DELETE CASCADE (0003)
 * - `risks_issues_decisions.project_id` ON DELETE SET NULL (0004)
 * - `delivery_metrics.project_id` ON DELETE SET NULL (0007)
 */
export async function deleteProject(projectId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};

  await Milestone.deleteMany({ projectId }, opts);
  await Task.deleteMany({ projectId }, opts);
  await ProjectFinance.deleteMany({ projectId }, opts);

  await RiskIssueDecision.updateMany({ projectId }, { $set: { projectId: null } }, opts);
  await DeliveryMetric.updateMany({ projectId }, { $set: { projectId: null } }, opts);

  await Project.deleteOne({ _id: projectId }, opts);
}

/**
 * Deletes a client.
 *
 * - `projects.client_id` ON DELETE SET NULL (0005)
 *
 * Note this does NOT delete the client's projects — the source schema
 * deliberately nulls the link and keeps them, so portfolio history survives
 * losing a client record.
 */
export async function deleteClient(clientId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  await Project.updateMany({ clientId }, { $set: { clientId: null } }, opts);
  await Client.deleteOne({ _id: clientId }, opts);
}

/**
 * Deletes a meeting.
 *
 * - `meeting_action_items.meeting_id` ON DELETE CASCADE (0008)
 */
export async function deleteMeeting(meetingId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  await MeetingActionItem.deleteMany({ meetingId }, opts);
  await Meeting.deleteOne({ _id: meetingId }, opts);
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/**
 * Deletes a finance account.
 *
 * - `finance_transactions.account_id` ON DELETE **RESTRICT** (0014)
 *
 * RESTRICT, not cascade: deleting an account that has ever been transacted on
 * would silently destroy ledger history. Postgres refused it with a FK
 * violation; here the refusal is explicit and surfaces as a 409.
 *
 * The intended way to retire an account is `isActive: false`, which is why
 * that column exists.
 */
export async function deleteFinanceAccount(
  accountId: string,
  session?: ClientSession,
): Promise<void> {
  const opts = session ? { session } : {};

  const transactionCount = await FinanceTransaction.countDocuments({ accountId }, opts);
  if (transactionCount > 0) {
    throw new HttpError(
      409,
      `Account has ${transactionCount} transaction(s) and cannot be deleted. ` +
        `Set isActive to false to retire it instead.`,
    );
  }

  await FinanceAccount.deleteOne({ _id: accountId }, opts);
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

/**
 * Deletes an employee.
 *
 * ON DELETE CASCADE (0020-0023): job_descriptions, leave_balances,
 * leave_requests, performance_reviews, training_records, attendance_records,
 * employee_tasks, jira_tasks_cache.
 *
 * ON DELETE SET NULL: `employees.supervisor_id` (direct reports lose their
 * supervisor rather than being deleted with them — 0020),
 * `leave_requests.supervisor_id` (0021),
 * `performance_reviews.reviewer_id` (0023).
 */
export async function deleteEmployee(employeeId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};

  await JobDescription.deleteMany({ employeeId }, opts);
  await LeaveBalance.deleteMany({ employeeId }, opts);
  await LeaveRequest.deleteMany({ employeeId }, opts);
  await PerformanceReview.deleteMany({ employeeId }, opts);
  await TrainingRecord.deleteMany({ employeeId }, opts);
  await AttendanceRecord.deleteMany({ employeeId }, opts);
  await EmployeeTask.deleteMany({ employeeId }, opts);
  await JiraTaskCache.deleteMany({ employeeId }, opts);

  // Direct reports survive; they simply lose the link.
  await Employee.updateMany({ supervisorId: employeeId }, { $set: { supervisorId: null } }, opts);
  // Requests this person was approving, and reviews they authored.
  await LeaveRequest.updateMany({ supervisorId: employeeId }, { $set: { supervisorId: null } }, opts);
  await PerformanceReview.updateMany({ reviewerId: employeeId }, { $set: { reviewerId: null } }, opts);

  await Employee.deleteOne({ _id: employeeId }, opts);
}

/**
 * Deletes a job opening.
 *
 * - `applications.job_opening_id` ON DELETE CASCADE (0022)
 */
export async function deleteJobOpening(jobOpeningId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  await Application.deleteMany({ jobOpeningId }, opts);
  await JobOpening.deleteOne({ _id: jobOpeningId }, opts);
}

/**
 * Deletes a candidate.
 *
 * - `applications.candidate_id` ON DELETE CASCADE (0022)
 */
export async function deleteCandidate(candidateId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  await Application.deleteMany({ candidateId }, opts);
  await Candidate.deleteOne({ _id: candidateId }, opts);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Deletes a user account.
 *
 * - `notifications.user_id` ON DELETE CASCADE (0028)
 * - `employees.user_id` ON DELETE SET NULL (0020) — the employee record
 *   outlives the login, which is what lets someone be offboarded from the app
 *   without erasing their HR history.
 * - `audit_log.actor_id`, `approvals.decided_by`, `finance_transactions.created_by`,
 *   `finance_reports.generated_by/published_by`, `employee_tasks.created_by`
 *   are all ON DELETE SET NULL, and are deliberately left to the audit
 *   retention policy rather than nulled here — see the note below.
 *
 * Audit rows are NOT rewritten: `audit_log.actor_id` would become null under
 * the SQL clause, but nulling it destroys the only record of who acted. The
 * source schema accepted that loss; we keep the id and rely on the user
 * document being gone. If a hard erasure is ever required (a GDPR request,
 * say) it belongs in a dedicated, audited erasure routine, not in an
 * incidental cascade.
 */
export async function deleteUser(userId: string, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  await Notification.deleteMany({ userId }, opts);
  await Employee.updateMany({ userId }, { $set: { userId: null } }, opts);
  await User.deleteOne({ _id: userId }, opts);
}
