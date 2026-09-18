import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { USER_ROLES, DEPARTMENT_SCOPES } from "@dokuma/shared";
import {
  uuidPk,
  uuidRef,
  money,
  dateOnly,
  currentDate,
  timestampOptions,
  createdAtOnly,
  PERCENT_SCALE,
  toDecimal128,
  decimalSetter,
} from "../types.js";

/**
 * Core platform models — identity, portfolio, risk, clients, activity,
 * delivery, meetings, KPI feed, audit, approvals and notifications.
 *
 * Source: supabase/migrations 0001-0013, 0027-0030. Inventory §5.1.
 *
 * Every CHECK constraint in the source SQL appears here as a Mongoose `enum`
 * or validator. That is deliberately the *second* line of defence — the zod
 * schemas in `api/schemas/` reject bad input at the boundary before it reaches
 * a model — but it means a service that bypasses its zod schema still cannot
 * write a value the Postgres schema would have rejected.
 */

// ---------------------------------------------------------------------------
// User — profiles + auth.users merged (D-10)
// ---------------------------------------------------------------------------

/**
 * TOTP state (inventory §4.4). `secret` is set only once a factor is verified;
 * `pendingSecret` holds an enrollment in progress. Modelling the two
 * separately is what removes the Supabase verified-vs-unverified-factor quirk
 * SECURITY.md had to work around.
 *
 * Declared as its own schema with `_id: false` rather than inline, so that the
 * subdocument is always present. Inline nested paths are inferred as possibly
 * undefined, which would force a null check at every one of the ~15 places the
 * auth routes touch `user.mfa` — for a field that, with a default, can never
 * actually be missing.
 */
const mfaSchema = new Schema(
  {
    secret: { type: String, default: null },
    pendingSecret: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    /**
     * Argon2 hashes of single-use recovery codes. A recovery code bypasses the
     * second factor, so it gets password-equivalent storage.
     */
    recoveryCodeHashes: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * `public.profiles` joined with `auth.users` into one collection (D-10).
 *
 * Supabase forced the split: `auth.users` was not writable by the app, so
 * role lived in a mirror table kept in sync by the `handle_new_user` trigger.
 * With our own identity store there is nothing to mirror, so the trigger
 * disappears and `role` sits on the user itself.
 *
 * `role` defaults to `viewer`, exactly as `profiles.role` did — a new account
 * with no explicit grant can read nothing sensitive.
 */
const userSchema = new Schema(
  {
    _id: uuidPk,
    email: {
      type: String,
      required: true,
      // Stored lowercase so the unique index is effectively case-insensitive,
      // matching how Supabase Auth treated email identity.
      lowercase: true,
      trim: true,
    },
    /**
     * Argon2id. `select: false` so a careless `User.findById()` cannot leak it
     * into a response — the login and password-change paths ask for it
     * explicitly with `.select("+passwordHash")`.
     */
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, default: null },
    role: {
      type: String,
      required: true,
      default: "viewer",
      enum: USER_ROLES,
    },
    /**
     * TOTP state (inventory §4.4). `secret` is set only once a factor is
     * verified; `pendingSecret` holds an enrollment in progress. Modelling the
     * two separately is what removes the Supabase
     * verified-vs-unverified-factor quirk SECURITY.md had to work around.
     */
    mfa: { type: mfaSchema, required: true, default: () => ({}) },

    /**
     * Failed-password tracking — the account-identifier half of the rate
     * limiting in §4.6 (the IP half lives in `rate_limit_windows`). IP-only
     * limiting lets an attacker spread a password-spray across a botnet;
     * account-only lets them lock every user out deliberately. Both are needed.
     */
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },

    /**
     * Soft-delete / suspension. `requireAuth` rejects a session whose user is
     * disabled, so revoking access does not depend on hunting down sessions.
     */
    disabledAt: { type: Date, default: null },
  },
  timestampOptions,
);

userSchema.index({ email: 1 }, { unique: true, name: "uniq_users_email" });
userSchema.index({ role: 1 }, { name: "idx_users_role" });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User: Model<UserDoc> = model<UserDoc>("User", userSchema, "users");

// ---------------------------------------------------------------------------
// Portfolio — projects, milestones, tasks
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["green", "amber", "red"] as const;

const projectSchema = new Schema(
  {
    _id: uuidPk,
    name: { type: String, required: true, trim: true },
    ownerName: { type: String, default: null },
    status: { type: String, required: true, default: "green", enum: PROJECT_STATUSES },
    budgetUsd: money(),
    startDate: dateOnly(),
    targetEndDate: dateOnly(),
    description: { type: String, default: null },
    // ON DELETE SET NULL (0005) — applied by cascade.ts on client delete.
    clientId: uuidRef("Client", { index: true }),
  },
  timestampOptions,
);

// The portfolio board groups by status and the CEO KPI counts each bucket.
projectSchema.index({ status: 1 }, { name: "idx_projects_status" });

export type ProjectDoc = InferSchemaType<typeof projectSchema>;
export const Project: Model<ProjectDoc> = model<ProjectDoc>("Project", projectSchema, "projects");

export const MILESTONE_STATUSES = ["pending", "on_track", "at_risk", "done"] as const;

const milestoneSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0002).
    projectId: uuidRef("Project", { required: true, index: true }),
    name: { type: String, required: true },
    dueDate: dateOnly(),
    status: { type: String, required: true, default: "pending", enum: MILESTONE_STATUSES },
  },
  createdAtOnly,
);

export type MilestoneDoc = InferSchemaType<typeof milestoneSchema>;
export const Milestone: Model<MilestoneDoc> = model<MilestoneDoc>(
  "Milestone",
  milestoneSchema,
  "milestones",
);

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;

const taskSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0002).
    projectId: uuidRef("Project", { required: true, index: true }),
    title: { type: String, required: true },
    assigneeName: { type: String, default: null },
    dueDate: dateOnly(),
    status: { type: String, required: true, default: "todo", enum: TASK_STATUSES },
  },
  createdAtOnly,
);

taskSchema.index({ dueDate: 1 }, { name: "idx_tasks_due_date" });
/**
 * The two headline task KPIs both filter `status <> 'done'` and then range on
 * `dueDate` (due-this-week, overdue). A compound index in that order lets both
 * counts be served from the index alone.
 */
taskSchema.index({ status: 1, dueDate: 1 }, { name: "idx_tasks_status_due_date" });

export type TaskDoc = InferSchemaType<typeof taskSchema>;
export const Task: Model<TaskDoc> = model<TaskDoc>("Task", taskSchema, "tasks");

// ---------------------------------------------------------------------------
// Clients — department-scoped (0030)
// ---------------------------------------------------------------------------

export const CLIENT_TIERS = ["strategic", "key", "standard"] as const;

const clientSchema = new Schema(
  {
    _id: uuidPk,
    name: { type: String, required: true, trim: true },
    industry: { type: String, default: null },
    primaryContactName: { type: String, default: null },
    primaryContactEmail: { type: String, default: null },
    relationshipOwner: { type: String, default: null },
    tier: { type: String, default: null, enum: [...CLIENT_TIERS, null] },
    notes: { type: String, default: null },
    /**
     * Department scope (0030). `null` means company-wide, which is
     * **exec-only** in the scoped queries — deliberately NOT a fallback that
     * finance/hr roles also see. See shared/department-scope.ts.
     */
    department: { type: String, default: null, enum: [...DEPARTMENT_SCOPES, null], index: true },
  },
  createdAtOnly,
);

export type ClientDoc = InferSchemaType<typeof clientSchema>;
export const Client: Model<ClientDoc> = model<ClientDoc>("Client", clientSchema, "clients");

// ---------------------------------------------------------------------------
// Risks / issues / decisions — department-scoped (0030)
// ---------------------------------------------------------------------------

export const RID_TYPES = ["risk", "issue", "decision"] as const;
export const RID_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const RID_LIKELIHOODS = ["low", "medium", "high"] as const;
export const RID_STATUSES = ["open", "mitigating", "closed"] as const;

const riskIssueDecisionSchema = new Schema(
  {
    _id: uuidPk,
    type: { type: String, required: true, enum: RID_TYPES },
    title: { type: String, required: true },
    description: { type: String, default: null },
    // ON DELETE SET NULL (0004).
    projectId: uuidRef("Project", { index: true }),
    ownerName: { type: String, default: null },
    dueDate: dateOnly(),
    severity: { type: String, default: null, enum: [...RID_SEVERITIES, null] },
    probability: { type: String, default: null, enum: [...RID_LIKELIHOODS, null] },
    impact: { type: String, default: null, enum: [...RID_LIKELIHOODS, null] },
    status: { type: String, required: true, default: "open", enum: RID_STATUSES },
    department: { type: String, default: null, enum: [...DEPARTMENT_SCOPES, null], index: true },
  },
  timestampOptions,
);

riskIssueDecisionSchema.index({ type: 1 }, { name: "idx_rid_type" });
riskIssueDecisionSchema.index({ status: 1 }, { name: "idx_rid_status" });
/**
 * Critical Blockers and High-Risk Projects both filter
 * `type/severity/status` together; the register page filters the same three.
 */
riskIssueDecisionSchema.index(
  { type: 1, severity: 1, status: 1 },
  { name: "idx_rid_type_severity_status" },
);

export type RiskIssueDecisionDoc = InferSchemaType<typeof riskIssueDecisionSchema>;
export const RiskIssueDecision: Model<RiskIssueDecisionDoc> = model<RiskIssueDecisionDoc>(
  "RiskIssueDecision",
  riskIssueDecisionSchema,
  "risks_issues_decisions",
);

// ---------------------------------------------------------------------------
// Activity records — LazyBoss feed
// ---------------------------------------------------------------------------

export const ACTIVITY_STATUSES = ["online", "offline"] as const;
export const ACTIVITY_SOURCES = ["csv", "api"] as const;

const activityRecordSchema = new Schema(
  {
    _id: uuidPk,
    personName: { type: String, required: true },
    role: { type: String, default: null },
    department: { type: String, default: null },
    activityDate: dateOnly({ required: true }),
    hoursToday: {
      type: Schema.Types.Decimal128,
      default: null,
      set: decimalSetter(PERCENT_SCALE),
    },
    onProjectMinutes: { type: Number, default: null },
    offProjectMinutes: { type: Number, default: null },
    screenshotsCount: { type: Number, default: null },
    storageUsedMb: {
      type: Schema.Types.Decimal128,
      default: null,
      set: decimalSetter(PERCENT_SCALE),
    },
    lastSeenAt: { type: Date, default: null },
    status: { type: String, default: null, enum: [...ACTIVITY_STATUSES, null] },
    source: { type: String, required: true, default: "csv", enum: ACTIVITY_SOURCES },
    importedAt: { type: Date, required: true, default: () => new Date() },
    /**
     * Nullable forward-link to an employee (D-18). The LazyBoss feed matches
     * to `employees` by `full_name` string today and that matching rule is
     * preserved unchanged; this column exists so a future migration can
     * establish a real link without a schema change.
     */
    employeeId: uuidRef("Employee"),
  },
  createdAtOnly,
);

// unique (person_name, activity_date, source) — 0006. The CSV import upserts
// on exactly this key, so re-importing the same day is idempotent.
activityRecordSchema.index(
  { personName: 1, activityDate: 1, source: 1 },
  { unique: true, name: "uniq_activity_person_date_source" },
);
activityRecordSchema.index({ activityDate: 1 }, { name: "idx_activity_records_date" });

export type ActivityRecordDoc = InferSchemaType<typeof activityRecordSchema>;
export const ActivityRecord: Model<ActivityRecordDoc> = model<ActivityRecordDoc>(
  "ActivityRecord",
  activityRecordSchema,
  "activity_records",
);

// ---------------------------------------------------------------------------
// Delivery metrics
// ---------------------------------------------------------------------------

export const DELIVERY_SOURCES = ["manual", "github", "illustrative"] as const;

const deliveryMetricSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE SET NULL (0007).
    projectId: uuidRef("Project", { index: true }),
    repoName: { type: String, required: true },
    metricDate: dateOnly({ required: true }),
    commitsCount: { type: Number, required: true, default: 0 },
    deploysCount: { type: Number, required: true, default: 0 },
    openDefectsCount: { type: Number, required: true, default: 0 },
    closedDefectsCount: { type: Number, required: true, default: 0 },
    source: { type: String, required: true, default: "manual", enum: DELIVERY_SOURCES },
  },
  createdAtOnly,
);

// unique (repo_name, metric_date, source) — 0007. Shaped so a GitHub webhook
// can upsert the same day's row repeatedly without duplicating it.
deliveryMetricSchema.index(
  { repoName: 1, metricDate: 1, source: 1 },
  { unique: true, name: "uniq_delivery_repo_date_source" },
);
deliveryMetricSchema.index({ metricDate: 1 }, { name: "idx_delivery_metrics_date" });

export type DeliveryMetricDoc = InferSchemaType<typeof deliveryMetricSchema>;
export const DeliveryMetric: Model<DeliveryMetricDoc> = model<DeliveryMetricDoc>(
  "DeliveryMetric",
  deliveryMetricSchema,
  "delivery_metrics",
);

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

const meetingSchema = new Schema(
  {
    _id: uuidPk,
    title: { type: String, required: true },
    meetingDate: dateOnly({ required: true }),
    // Postgres text[] → native array, the one place Mongo is the better fit.
    attendees: { type: [String], default: [] },
    sourceNotes: { type: String, default: null },
  },
  createdAtOnly,
);

meetingSchema.index({ meetingDate: -1 }, { name: "idx_meetings_date" });

export type MeetingDoc = InferSchemaType<typeof meetingSchema>;
export const Meeting: Model<MeetingDoc> = model<MeetingDoc>("Meeting", meetingSchema, "meetings");

export const ACTION_ITEM_STATUSES = ["open", "done"] as const;

const meetingActionItemSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0008).
    meetingId: uuidRef("Meeting", { required: true, index: true }),
    description: { type: String, required: true },
    ownerName: { type: String, default: null },
    dueDate: dateOnly(),
    status: { type: String, required: true, default: "open", enum: ACTION_ITEM_STATUSES },
  },
  createdAtOnly,
);

export type MeetingActionItemDoc = InferSchemaType<typeof meetingActionItemSchema>;
export const MeetingActionItem: Model<MeetingActionItemDoc> = model<MeetingActionItemDoc>(
  "MeetingActionItem",
  meetingActionItemSchema,
  "meeting_action_items",
);

// ---------------------------------------------------------------------------
// KPI feed — the Group-facing contract (D-13)
// ---------------------------------------------------------------------------

const kpiFeedSchema = new Schema(
  {
    _id: uuidPk,
    company: { type: String, required: true, default: "Dokuma" },
    metricName: { type: String, required: true },
    // Nullable by design: team_utilisation_pct is null when no activity rows
    // exist for the latest date, and the feed must carry that through rather
    // than coercing it to 0.
    value: { type: Schema.Types.Decimal128, default: null },
    unit: { type: String, default: null },
    asOfDate: dateOnly({ required: true, default: currentDate }),
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// unique (company, metric_name, as_of_date) — 0009. refreshKpiFeed() upserts
// on exactly this key set, matching the SQL ON CONFLICT target.
kpiFeedSchema.index(
  { company: 1, metricName: 1, asOfDate: 1 },
  { unique: true, name: "uniq_kpi_feed_company_metric_date" },
);

export type KpiFeedDoc = InferSchemaType<typeof kpiFeedSchema>;
export const KpiFeed: Model<KpiFeedDoc> = model<KpiFeedDoc>("KpiFeed", kpiFeedSchema, "kpi_feed");

// ---------------------------------------------------------------------------
// AI daily briefs
// ---------------------------------------------------------------------------

const aiDailyBriefSchema = new Schema(
  {
    _id: uuidPk,
    briefDate: dateOnly({ required: true }),
    headline: { type: String, required: true },
    body: { type: String, required: true },
    generatedBy: { type: String, required: true, default: "stub" },
  },
  createdAtOnly,
);

// unique brief_date (0010) — the dashboard reads the most recent row, and the
// generator upserts on the day.
aiDailyBriefSchema.index({ briefDate: 1 }, { unique: true, name: "uniq_ai_daily_briefs_date" });

export type AiDailyBriefDoc = InferSchemaType<typeof aiDailyBriefSchema>;
export const AiDailyBrief: Model<AiDailyBriefDoc> = model<AiDailyBriefDoc>(
  "AiDailyBrief",
  aiDailyBriefSchema,
  "ai_daily_briefs",
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const auditLogSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE SET NULL (0013) — an actor's deletion must not erase history.
    actorId: uuidRef("User"),
    actorRole: { type: String, default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    /**
     * Free-form entity id. Not a `uuidRef` because it is polymorphic across
     * every module and the source column carries no FK either.
     */
    entityId: { type: String, default: null },
    // jsonb → Mixed. Native in Mongo.
    metadata: { type: Schema.Types.Mixed, default: null },

    /**
     * Request context. Not columns in the Postgres table — the legacy
     * `audit_log` had no equivalent — but `services/audit.ts` has been passing
     * them since it was written, and Mongoose was silently dropping both
     * because the schema did not declare them. That meant every recorded
     * failed login had no source IP, which is most of what makes a failed
     * login worth recording.
     *
     * Added rather than removed from the service: during an incident, "which
     * address was this attempted from" is the first question asked.
     */
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  createdAtOnly,
);

auditLogSchema.index({ entityType: 1, entityId: 1 }, { name: "idx_audit_log_entity" });
auditLogSchema.index({ createdAt: -1 }, { name: "idx_audit_log_created_at" });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>("AuditLog", auditLogSchema, "audit_log");

// ---------------------------------------------------------------------------
// Approvals engine (0027)
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

const approvalSchema = new Schema(
  {
    _id: uuidPk,
    approvableType: { type: String, required: true },
    approvableId: { type: String, required: true },
    step: { type: String, required: true },
    status: { type: String, required: true, default: "pending", enum: APPROVAL_STATUSES },
    decidedBy: uuidRef("User"),
    decidedAt: { type: Date, default: null },
    comment: { type: String, default: null },
  },
  createdAtOnly,
);

approvalSchema.index({ approvableType: 1, approvableId: 1 }, { name: "idx_approvals_approvable" });
approvalSchema.index({ status: 1 }, { name: "idx_approvals_status" });

export type ApprovalDoc = InferSchemaType<typeof approvalSchema>;
export const Approval: Model<ApprovalDoc> = model<ApprovalDoc>("Approval", approvalSchema, "approvals");

// ---------------------------------------------------------------------------
// Notifications (0028)
// ---------------------------------------------------------------------------

const notificationSchema = new Schema(
  {
    _id: uuidPk,
    // ON DELETE CASCADE (0028).
    userId: uuidRef("User", { required: true }),
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: null },
    link: { type: String, default: null },
    readAt: { type: Date, default: null },
  },
  createdAtOnly,
);

// idx (user_id, created_at desc) — the bell menu's only query.
notificationSchema.index({ userId: 1, createdAt: -1 }, { name: "idx_notifications_user_created" });
/**
 * Dedupe key for the pull-based due-soon checks (D-15): the payment-notice and
 * training-expiry sweeps must not re-notify on every page load. Partial so it
 * constrains only the generated notifications, leaving ad-hoc ones free of it.
 */
notificationSchema.index(
  { userId: 1, type: 1, link: 1 },
  {
    unique: true,
    name: "uniq_notifications_dedupe",
    partialFilterExpression: { link: { $type: "string" } },
  },
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification: Model<NotificationDoc> = model<NotificationDoc>(
  "Notification",
  notificationSchema,
  "notifications",
);
