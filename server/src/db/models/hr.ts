import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import {
  uuidPk,
  uuidRef,
  dateOnly,
  currentDate,
  createdAtOnly,
  LEAVE_DAY_SCALE,
  toDecimal128,
  decimalToString,
  decimalSetter,
} from "../types.js";

/**
 * HR models. Source: supabase/migrations 0020-0024, 0029. Inventory §5.3.
 *
 * Two Postgres behaviors are reproduced in application code here and are
 * called out at their definitions: the `days_remaining` generated column
 * (a virtual) and the `recompute_leave_balance` AFTER UPDATE trigger
 * (services/hr/leave.ts, guarded on the previous status).
 */

/** `numeric(5,1)` leave-day counts — the schema is half-day granular. */
function leaveDays(options: { required?: boolean; default?: number } = {}) {
  return {
    type: Schema.Types.Decimal128,
    required: options.required ?? false,
    default:
      options.default === undefined
        ? options.required
          ? undefined
          : null
        : toDecimal128(options.default, LEAVE_DAY_SCALE),
    set: decimalSetter(LEAVE_DAY_SCALE),
  };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const EMPLOYEE_STATUSES = ["active", "on-leave", "exited"] as const;

const employeeSchema = new Schema(
  {
    _id: uuidPk,
    fullName: { type: String, required: true, trim: true },
    roleTitle: { type: String, default: null },
    /**
     * Free-text organizational department ("Engineering", "Delivery", …).
     * NOT the same thing as the `department` scope enum on clients and risks —
     * that one is constrained to finance/hr and drives authorization.
     */
    department: { type: String, default: null },
    employmentDate: dateOnly(),
    // Self-reference, ON DELETE SET NULL (0020).
    supervisorId: uuidRef("Employee", { index: true }),
    status: { type: String, required: true, default: "active", enum: EMPLOYEE_STATUSES },
    // unique, ON DELETE SET NULL (0020). One employee record per login.
    userId: uuidRef("User"),
    jiraAccountId: { type: String, default: null },
  },
  createdAtOnly,
);

/**
 * `user_id uuid unique` (0020). Partial, because most employees have no login
 * at all: a plain unique index would let only one of them hold null, whereas
 * Postgres allows unlimited nulls under a UNIQUE constraint.
 */
employeeSchema.index(
  { userId: 1 },
  {
    unique: true,
    name: "uniq_employees_user_id",
    partialFilterExpression: { userId: { $type: "string" } },
  },
);
// LazyBoss matches activity rows to employees by full_name (D-18).
employeeSchema.index({ fullName: 1 }, { name: "idx_employees_full_name" });

export type EmployeeDoc = InferSchemaType<typeof employeeSchema>;
export const Employee: Model<EmployeeDoc> = model<EmployeeDoc>("Employee", employeeSchema, "employees");

// ---------------------------------------------------------------------------
// Job descriptions — versioned, never overwritten
// ---------------------------------------------------------------------------

const jobDescriptionSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0020).
    employeeId: uuidRef("Employee"),
    roleTitle: { type: String, default: null },
    responsibilities: { type: String, default: null },
    reportingLine: { type: String, default: null },
    requirements: { type: String, default: null },
    /** A new row per revision. "Current" is the highest version. */
    version: { type: Number, required: true, default: 1, min: 1 },
    effectiveDate: dateOnly({ required: true, default: currentDate }),
    // Storage path for the jd-documents bucket (0029).
    attachmentPath: { type: String, default: null },
  },
  createdAtOnly,
);

/**
 * CHECK (employee_id is not null or role_title is not null) — 0020.
 * A JD is either attached to a person or is a generic template for a role;
 * one that is neither cannot be found by any query the UI issues.
 */
jobDescriptionSchema.pre("validate", function (next) {
  if (!this.employeeId && !this.roleTitle) {
    next(new Error("job_descriptions requires either employeeId or roleTitle"));
    return;
  }
  next();
});

// idx (employee_id, version desc) — "current JD for this employee".
jobDescriptionSchema.index({ employeeId: 1, version: -1 }, { name: "idx_jd_employee_version" });

export type JobDescriptionDoc = InferSchemaType<typeof jobDescriptionSchema>;
export const JobDescription: Model<JobDescriptionDoc> = model<JobDescriptionDoc>(
  "JobDescription",
  jobDescriptionSchema,
  "job_descriptions",
);

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

const leaveTypeSchema = new Schema(
  {
    _id: uuidPk,
    name: { type: String, required: true, trim: true },
    daysPerYear: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);

leaveTypeSchema.index({ name: 1 }, { unique: true, name: "uniq_leave_types_name" });

export type LeaveTypeDoc = InferSchemaType<typeof leaveTypeSchema>;
export const LeaveType: Model<LeaveTypeDoc> = model<LeaveTypeDoc>(
  "LeaveType",
  leaveTypeSchema,
  "leave_types",
);

const leaveBalanceSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE on both (0021).
    employeeId: uuidRef("Employee", { required: true }),
    leaveTypeId: uuidRef("LeaveType", { required: true }),
    year: { type: Number, required: true },
    daysAllocated: leaveDays({ required: true }),
    daysUsed: leaveDays({ required: true, default: 0 }),
  },
  { timestamps: false, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/**
 * PRIMARY KEY (employee_id, leave_type_id, year) — 0021.
 *
 * Postgres used the triple as the table's actual PK; here `_id` is a UUID and
 * the triple becomes a compound unique index. The upsert in the leave-approval
 * service must target exactly this key set, matching the SQL ON CONFLICT.
 */
leaveBalanceSchema.index(
  { employeeId: 1, leaveTypeId: 1, year: 1 },
  { unique: true, name: "uniq_leave_balance_employee_type_year" },
);

/**
 * `days_remaining numeric(5,1) generated always as (days_allocated - days_used) stored`
 * — 0021.
 *
 * Mongo has no generated columns, so this is a virtual: computed on read,
 * never stored, which keeps the same guarantee the generated column gave —
 * it cannot drift from its inputs because it has no independent existence.
 * Included in JSON output via the schema's `toJSON: { virtuals: true }`.
 *
 * The subtraction runs on scaled integers rather than float64. Leave days are
 * half-day granular (`numeric(5,1)`), and float64 cannot represent one decimal
 * place exactly: `0.3 - 0.1` evaluates to `0.19999999999999998`, which would
 * surface in the UI as a balance that is visibly wrong. Returning a
 * fixed-scale string keeps the value exact all the way to the client, matching
 * how every other decimal crosses the serialization boundary (D-12).
 *
 * NOTE: this can legitimately be NEGATIVE. The leave-approval upsert seeds
 * `days_allocated = 0` when no allocation exists yet, exactly as the Postgres
 * trigger did, so an approved request with no allocation yields a negative
 * remainder. That is real current behavior, not a defect.
 */
leaveBalanceSchema.virtual("daysRemaining").get(function (this: LeaveBalanceDoc): string {
  const allocated = decimalToString(this.daysAllocated, LEAVE_DAY_SCALE) ?? "0.0";
  const used = decimalToString(this.daysUsed, LEAVE_DAY_SCALE) ?? "0.0";

  const scaled = (value: string): bigint => {
    const negative = value.startsWith("-");
    const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
    const digits = BigInt(whole + fraction.padEnd(LEAVE_DAY_SCALE, "0").slice(0, LEAVE_DAY_SCALE));
    return negative ? -digits : digits;
  };

  const difference = scaled(allocated) - scaled(used);
  const negative = difference < 0n;
  const digits = (negative ? -difference : difference).toString().padStart(LEAVE_DAY_SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - LEAVE_DAY_SCALE);
  const fraction = digits.slice(digits.length - LEAVE_DAY_SCALE);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
});

export type LeaveBalanceDoc = InferSchemaType<typeof leaveBalanceSchema>;
export const LeaveBalance: Model<LeaveBalanceDoc> = model<LeaveBalanceDoc>(
  "LeaveBalance",
  leaveBalanceSchema,
  "leave_balances",
);

/** The leave state machine (0021): supervisor first, then HR. */
export const LEAVE_STATUSES = ["pending_supervisor", "pending_hr", "approved", "rejected"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

const leaveRequestSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0021).
    employeeId: uuidRef("Employee", { required: true, index: true }),
    leaveTypeId: uuidRef("LeaveType", { required: true }),
    startDate: dateOnly({ required: true }),
    endDate: dateOnly({ required: true }),
    daysRequested: {
      ...leaveDays({ required: true }),
      // CHECK (days_requested > 0) — 0021.
      validate: {
        validator: (v: unknown) => v !== null && v !== undefined && Number(v.toString()) > 0,
        message: "daysRequested must be greater than 0",
      },
    },
    /**
     * Masked for supervisors by the leave serializer, never by the route.
     * See services/hr/leave.ts `serializeLeaveRequest` — the Postgres
     * equivalent was the CASE expression in `v_leave_requests` (0024).
     */
    reason: { type: String, default: null },
    status: { type: String, required: true, default: "pending_supervisor", enum: LEAVE_STATUSES },
    // ON DELETE SET NULL (0021).
    supervisorId: uuidRef("Employee", { index: true }),
    supervisorDecisionAt: { type: Date, default: null },
    supervisorComment: { type: String, default: null },
    hrDecisionAt: { type: Date, default: null },
    hrComment: { type: String, default: null },
  },
  createdAtOnly,
);

leaveRequestSchema.index({ status: 1 }, { name: "idx_leave_requests_status" });
// The two approval queues: "pending for my signature".
leaveRequestSchema.index({ supervisorId: 1, status: 1 }, { name: "idx_leave_requests_supervisor_status" });

export type LeaveRequestDoc = InferSchemaType<typeof leaveRequestSchema>;
export const LeaveRequest: Model<LeaveRequestDoc> = model<LeaveRequestDoc>(
  "LeaveRequest",
  leaveRequestSchema,
  "leave_requests",
);

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------

export const JOB_OPENING_STATUSES = ["open", "closed"] as const;

const jobOpeningSchema = new Schema(
  {
    _id: uuidPk,
    title: { type: String, required: true },
    department: { type: String, default: null },
    status: { type: String, required: true, default: "open", enum: JOB_OPENING_STATUSES },
    openedAt: dateOnly({ required: true, default: currentDate }),
  },
  { timestamps: false },
);

export type JobOpeningDoc = InferSchemaType<typeof jobOpeningSchema>;
export const JobOpening: Model<JobOpeningDoc> = model<JobOpeningDoc>(
  "JobOpening",
  jobOpeningSchema,
  "job_openings",
);

const candidateSchema = new Schema(
  {
    _id: uuidPk,
    fullName: { type: String, required: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, default: null },
    resumeUrl: { type: String, default: null },
  },
  createdAtOnly,
);

export type CandidateDoc = InferSchemaType<typeof candidateSchema>;
export const Candidate: Model<CandidateDoc> = model<CandidateDoc>(
  "Candidate",
  candidateSchema,
  "candidates",
);

export const APPLICATION_STAGES = [
  "applied",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

const applicationSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE on both (0022).
    jobOpeningId: uuidRef("JobOpening", { required: true }),
    candidateId: uuidRef("Candidate", { required: true }),
    stage: { type: String, required: true, default: "applied", enum: APPLICATION_STAGES },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// unique (job_opening_id, candidate_id) — 0022. One application per candidate
// per opening; moving stage is an update, never a second row.
applicationSchema.index(
  { jobOpeningId: 1, candidateId: 1 },
  { unique: true, name: "uniq_applications_opening_candidate" },
);
// idx (job_opening_id, stage) — the pipeline board groups by stage.
applicationSchema.index({ jobOpeningId: 1, stage: 1 }, { name: "idx_applications_opening_stage" });

export type ApplicationDoc = InferSchemaType<typeof applicationSchema>;
export const Application: Model<ApplicationDoc> = model<ApplicationDoc>(
  "Application",
  applicationSchema,
  "applications",
);

// ---------------------------------------------------------------------------
// Performance, training, attendance, tasks
// ---------------------------------------------------------------------------

export const REVIEW_STATUSES = ["draft", "submitted", "acknowledged"] as const;

const performanceReviewSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0023).
    employeeId: uuidRef("Employee", { required: true, index: true }),
    period: { type: String, required: true },
    // ON DELETE SET NULL (0023).
    reviewerId: uuidRef("Employee"),
    // jsonb `[]` → array of goal objects. Shape validated by zod at the boundary.
    goals: { type: Schema.Types.Mixed, required: true, default: () => [] },
    rating: { type: String, default: null },
    comments: { type: String, default: null },
    status: { type: String, required: true, default: "draft", enum: REVIEW_STATUSES },
  },
  createdAtOnly,
);

export type PerformanceReviewDoc = InferSchemaType<typeof performanceReviewSchema>;
export const PerformanceReview: Model<PerformanceReviewDoc> = model<PerformanceReviewDoc>(
  "PerformanceReview",
  performanceReviewSchema,
  "performance_reviews",
);

const trainingRecordSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0023).
    employeeId: uuidRef("Employee", { required: true, index: true }),
    courseName: { type: String, required: true },
    provider: { type: String, default: null },
    completedAt: dateOnly(),
    certificateUrl: { type: String, default: null },
    expiresAt: dateOnly(),
  },
  createdAtOnly,
);

// idx expires_at — drives `v_training_expiring_soon` (today .. +30d).
trainingRecordSchema.index({ expiresAt: 1 }, { name: "idx_training_records_expires_at" });

export type TrainingRecordDoc = InferSchemaType<typeof trainingRecordSchema>;
export const TrainingRecord: Model<TrainingRecordDoc> = model<TrainingRecordDoc>(
  "TrainingRecord",
  trainingRecordSchema,
  "training_records",
);

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "on_leave"] as const;
export const ATTENDANCE_SOURCES = ["manual", "lazyboss"] as const;

const attendanceRecordSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0023).
    employeeId: uuidRef("Employee", { required: true }),
    date: dateOnly({ required: true }),
    status: { type: String, required: true, enum: ATTENDANCE_STATUSES },
    source: { type: String, required: true, default: "manual", enum: ATTENDANCE_SOURCES },
  },
  createdAtOnly,
);

// unique (employee_id, date) — 0023. One attendance mark per person per day,
// whichever source wrote it.
attendanceRecordSchema.index(
  { employeeId: 1, date: 1 },
  { unique: true, name: "uniq_attendance_employee_date" },
);

export type AttendanceRecordDoc = InferSchemaType<typeof attendanceRecordSchema>;
export const AttendanceRecord: Model<AttendanceRecordDoc> = model<AttendanceRecordDoc>(
  "AttendanceRecord",
  attendanceRecordSchema,
  "attendance_records",
);

export const EMPLOYEE_TASK_STATUSES = ["todo", "in_progress", "done"] as const;

const employeeTaskSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0023).
    employeeId: uuidRef("Employee", { required: true, index: true }),
    title: { type: String, required: true },
    description: { type: String, default: null },
    dueDate: dateOnly(),
    status: { type: String, required: true, default: "todo", enum: EMPLOYEE_TASK_STATUSES },
    createdBy: uuidRef("User"),
  },
  createdAtOnly,
);

export type EmployeeTaskDoc = InferSchemaType<typeof employeeTaskSchema>;
export const EmployeeTask: Model<EmployeeTaskDoc> = model<EmployeeTaskDoc>(
  "EmployeeTask",
  employeeTaskSchema,
  "employee_tasks",
);

const jiraTaskCacheSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0023).
    employeeId: uuidRef("Employee", { required: true, index: true }),
    jiraIssueKey: { type: String, required: true },
    summary: { type: String, default: null },
    status: { type: String, default: null },
    dueDate: dateOnly(),
    url: { type: String, default: null },
    /** Refreshed lazily when older than 15 minutes — this IS the refresh cycle. */
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// unique (employee_id, jira_issue_key) — 0023. The refresh upserts on this key.
jiraTaskCacheSchema.index(
  { employeeId: 1, jiraIssueKey: 1 },
  { unique: true, name: "uniq_jira_cache_employee_issue" },
);

export type JiraTaskCacheDoc = InferSchemaType<typeof jiraTaskCacheSchema>;
export const JiraTaskCache: Model<JiraTaskCacheDoc> = model<JiraTaskCacheDoc>(
  "JiraTaskCache",
  jiraTaskCacheSchema,
  "jira_tasks_cache",
);
