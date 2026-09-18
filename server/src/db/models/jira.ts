import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { uuidPk, uuidRef, dateOnly } from "../types.js";

/**
 * Jira linkage.
 *
 * Three collections, each answering a different question:
 *
 *   jira_project_links — which Jira project feeds which Dokuma project
 *   jira_issue_links   — which Jira issue produced which Dokuma task
 *   jira_syncs         — did the sync run, and what happened
 *
 * Kept OUT of the `Task` model deliberately. A `jiraIssueKey` column on `tasks`
 * would be null for every manually-created task and would tie the portfolio
 * schema to one vendor. A link table keeps Jira an optional integration rather
 * than a structural dependency — this system must work with Jira switched off.
 */

// ---------------------------------------------------------------------------
// Project mapping
// ---------------------------------------------------------------------------

/**
 * A Jira project feeding a Dokuma project.
 *
 * Many-to-one: several Jira projects can feed one Dokuma project (a programme
 * split across boards), but a Jira project belongs to at most one Dokuma
 * project — otherwise the same issue would be counted twice in the portfolio.
 */
const jiraProjectLinkSchema = new Schema(
  {
    _id: uuidPk,
    jiraProjectKey: { type: String, required: true, uppercase: true, trim: true },
    jiraProjectName: { type: String, default: null },
    projectId: uuidRef("Project", { required: true, index: true }),

    /** Pause a mapping without deleting it and losing the issue links. */
    isActive: { type: Boolean, required: true, default: true },

    /**
     * Watermark for incremental sync: only issues updated since this are
     * fetched. Null forces a full sync, which is what a new mapping needs.
     */
    lastSyncedAt: { type: Date, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// One Dokuma home per Jira project — the constraint that stops double-counting.
jiraProjectLinkSchema.index(
  { jiraProjectKey: 1 },
  { unique: true, name: "uniq_jira_project_link" },
);

export type JiraProjectLinkDoc = InferSchemaType<typeof jiraProjectLinkSchema>;
export const JiraProjectLink: Model<JiraProjectLinkDoc> = model<JiraProjectLinkDoc>(
  "JiraProjectLink",
  jiraProjectLinkSchema,
  "jira_project_links",
);

// ---------------------------------------------------------------------------
// Issue → task linkage
// ---------------------------------------------------------------------------

/**
 * One row per synced issue.
 *
 * Holds the Jira-side snapshot AND the id of the task it produced, so a
 * re-sync updates the same task instead of creating another. Without this the
 * nightly sync would multiply the portfolio by the number of times it ran.
 *
 * The snapshot fields are deliberately duplicated from `tasks`: they record
 * what JIRA said, so a later divergence (someone edited the task here) is
 * detectable rather than silently overwritten.
 */
const jiraIssueLinkSchema = new Schema(
  {
    _id: uuidPk,
    jiraIssueKey: { type: String, required: true, uppercase: true, trim: true },
    jiraIssueId: { type: String, required: true },
    jiraProjectKey: { type: String, required: true, uppercase: true, index: true },

    /** The task this issue produced, or null if it was filtered out. */
    taskId: uuidRef("Task"),
    projectId: uuidRef("Project", { index: true }),

    // ---- Snapshot of the Jira side, as of `syncedAt` ----------------------
    summary: { type: String, default: null },
    status: { type: String, default: null },
    /** new | indeterminate | done — Jira's own three-bucket rollup. */
    statusCategory: { type: String, default: null },
    issueType: { type: String, default: null },
    priority: { type: String, default: null },
    assigneeAccountId: { type: String, default: null, index: true },
    assigneeName: { type: String, default: null },
    dueDate: dateOnly(),
    jiraCreatedAt: { type: Date, default: null },
    jiraUpdatedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    labels: { type: [String], default: [] },
    url: { type: String, default: null },

    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

jiraIssueLinkSchema.index({ jiraIssueKey: 1 }, { unique: true, name: "uniq_jira_issue_link" });

/** Delivery metrics group by project and window on resolution date. */
jiraIssueLinkSchema.index(
  { jiraProjectKey: 1, resolvedAt: -1 },
  { name: "idx_jira_issue_resolved" },
);

export type JiraIssueLinkDoc = InferSchemaType<typeof jiraIssueLinkSchema>;
export const JiraIssueLink: Model<JiraIssueLinkDoc> = model<JiraIssueLinkDoc>(
  "JiraIssueLink",
  jiraIssueLinkSchema,
  "jira_issue_links",
);

// ---------------------------------------------------------------------------
// Sync log
// ---------------------------------------------------------------------------

/**
 * One row per sync attempt.
 *
 * The same reasoning as `sbu_kpi_dispatches`: a sync that stopped running and a
 * sync that found nothing look identical from the outside. Without this log,
 * "Tasks Due This Week" quietly freezing at last week's number is invisible.
 */
const jiraSyncSchema = new Schema(
  {
    _id: uuidPk,
    startedAt: { type: Date, required: true, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    /** full | incremental | single-project */
    mode: { type: String, required: true, default: "incremental" },
    outcome: {
      type: String,
      required: true,
      enum: ["success", "partial", "failed", "skipped"],
      default: "success",
    },
    projectsSynced: { type: Number, required: true, default: 0 },
    issuesFetched: { type: Number, required: true, default: 0 },
    tasksCreated: { type: Number, required: true, default: 0 },
    tasksUpdated: { type: Number, required: true, default: 0 },
    /** Shape is whatever failed; pinning it would lose the diagnostic. */
    detail: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: false },
);

jiraSyncSchema.index({ startedAt: -1 }, { name: "idx_jira_sync_recent" });

export type JiraSyncDoc = InferSchemaType<typeof jiraSyncSchema>;
export const JiraSync: Model<JiraSyncDoc> = model<JiraSyncDoc>(
  "JiraSync",
  jiraSyncSchema,
  "jira_syncs",
);
