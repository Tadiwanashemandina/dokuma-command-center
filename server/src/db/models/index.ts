/**
 * Model barrel. Importing this module registers every schema with Mongoose,
 * which is what `ensureIndexes()` and the seed script rely on.
 */

export * from "./core.js";
export * from "./finance.js";
export * from "./hr.js";
export * from "./auth.js";

import mongoose from "mongoose";

import {
  User,
  Project,
  Milestone,
  Task,
  Client,
  RiskIssueDecision,
  ActivityRecord,
  DeliveryMetric,
  Meeting,
  MeetingActionItem,
  KpiFeed,
  AiDailyBrief,
  AuditLog,
  Approval,
  Notification,
} from "./core.js";
import {
  FinanceAccount,
  FinanceTransaction,
  FinanceReport,
  FinanceCreditor,
  FinancePaymentNotice,
  ProjectFinance,
  FinanceCompanyTotals,
} from "./finance.js";
import {
  Employee,
  JobDescription,
  LeaveType,
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
} from "./hr.js";

/**
 * Every model, in dependency order (parents before children).
 *
 * The order matters to the seed script, which inserts along it, and to
 * `resetDatabase()`, which drops along its reverse.
 */
export const ALL_MODELS = [
  // Identity
  User,
  // Portfolio
  Client,
  Project,
  Milestone,
  Task,
  // Risk & delivery
  RiskIssueDecision,
  DeliveryMetric,
  // Meetings
  Meeting,
  MeetingActionItem,
  // People activity
  ActivityRecord,
  // Finance
  FinanceAccount,
  FinanceTransaction,
  FinanceReport,
  FinanceCreditor,
  FinancePaymentNotice,
  ProjectFinance,
  FinanceCompanyTotals,
  // HR
  Employee,
  JobDescription,
  LeaveType,
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
  // Cross-cutting
  KpiFeed,
  AiDailyBrief,
  AuditLog,
  Approval,
  Notification,
] as const;

/**
 * Builds every index declared on every schema.
 *
 * Mongoose's `autoIndex` does this implicitly in development, but it is
 * disabled in production (it races with the first queries and silently
 * swallows failures). Calling this explicitly is the migration step: it is
 * idempotent, and it *reports* failures instead of logging them to nowhere.
 */
export async function ensureIndexes(): Promise<{ model: string; indexes: number }[]> {
  const results: { model: string; indexes: number }[] = [];

  for (const m of ALL_MODELS) {
    await m.createIndexes();
    // `createIndexes()` is a no-op for a collection that does not exist yet
    // (nothing has been inserted), and listing indexes on a missing namespace
    // is an error rather than an empty list. Report 0 instead of throwing, so
    // this stays runnable against a freshly reset or brand-new database.
    const indexes = await m.collection.indexes().catch(() => []);
    results.push({ model: m.modelName, indexes: indexes.length });
  }

  return results;
}

/**
 * Drops every collection this application owns.
 *
 * Deliberately enumerates `ALL_MODELS` rather than calling `dropDatabase()`,
 * so pointing it at a database that also holds something else cannot destroy
 * the other thing. Used by the seed script's `--fresh` flag and by tests.
 */
export async function resetDatabase(): Promise<void> {
  const existing = new Set(
    (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name),
  );

  for (const m of [...ALL_MODELS].reverse()) {
    if (existing.has(m.collection.collectionName)) {
      await m.collection.drop();
    }
  }
}
