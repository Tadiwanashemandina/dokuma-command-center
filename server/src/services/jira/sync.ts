import { randomUUID } from "node:crypto";
import { Task } from "../../db/models/index.js";
import { JiraProjectLink, JiraIssueLink, JiraSync } from "../../db/models/jira.js";
import { toDateOnly } from "../../db/types.js";
import { resolveJiraConfig } from "./config.js";
import { searchProjectIssues, type JiraIssue } from "./client.js";

/**
 * Jira issues → Dokuma tasks.
 *
 * This is what makes the CEO dashboard's "Tasks Due This Week" and "Overdue
 * Tasks" mean something: today those count seeded rows, and after this they
 * count real engineering work.
 *
 * ---------------------------------------------------------------------------
 * Incremental by default
 * ---------------------------------------------------------------------------
 * Each mapping keeps a `lastSyncedAt` watermark and fetches only issues updated
 * since. A full sync of a large board is thousands of issues against a rate
 * limit; an incremental one is usually a handful.
 *
 * The watermark is set from the time the sync STARTED, not finished. An issue
 * edited while the sync was running would otherwise fall in the gap between the
 * two and be missed until it happened to change again.
 */

/** Jira's three status buckets → this system's task vocabulary. */
function mapStatus(issue: JiraIssue): "todo" | "in_progress" | "done" {
  switch (issue.statusCategory) {
    case "done":
      return "done";
    case "indeterminate":
      return "in_progress";
    default:
      return "todo";
  }
}

export interface SyncResult {
  outcome: "success" | "partial" | "failed" | "skipped";
  projectsSynced: number;
  issuesFetched: number;
  tasksCreated: number;
  tasksUpdated: number;
  errors: { projectKey: string; message: string }[];
  durationMs: number;
}

/**
 * Syncs every active project mapping.
 *
 * One mapping failing does not abort the rest — a single misconfigured board
 * should not stop the whole portfolio updating. Failures are collected and the
 * outcome becomes `partial`.
 */
export async function syncAllProjects(
  options: { full?: boolean; mode?: string } = {},
): Promise<SyncResult> {
  const startedAt = new Date();
  const config = resolveJiraConfig();

  const result: SyncResult = {
    outcome: "success",
    projectsSynced: 0,
    issuesFetched: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    errors: [],
    durationMs: 0,
  };

  const finish = async (outcome: SyncResult["outcome"], detail?: unknown): Promise<SyncResult> => {
    result.outcome = outcome;
    result.durationMs = Date.now() - startedAt.getTime();

    await JiraSync.create({
      _id: randomUUID(),
      startedAt,
      finishedAt: new Date(),
      mode: options.mode ?? (options.full ? "full" : "incremental"),
      outcome,
      projectsSynced: result.projectsSynced,
      issuesFetched: result.issuesFetched,
      tasksCreated: result.tasksCreated,
      tasksUpdated: result.tasksUpdated,
      detail: detail ?? (result.errors.length > 0 ? { errors: result.errors } : null),
      durationMs: result.durationMs,
    });

    return result;
  };

  // A disabled integration is logged as `skipped`, not failed — it is a normal
  // state, and the log is what distinguishes it from a sync that never ran.
  if (!config.enabled) {
    return finish("skipped", { reason: config.reason });
  }

  const links = await JiraProjectLink.find({ isActive: true }).lean();
  if (links.length === 0) {
    return finish("skipped", { reason: "No active Jira project mappings." });
  }

  for (const link of links) {
    try {
      const issues = await searchProjectIssues(link.jiraProjectKey, {
        ...(options.full || !link.lastSyncedAt ? {} : { updatedSince: link.lastSyncedAt }),
        config,
      });

      result.issuesFetched += issues.length;

      for (const issue of issues) {
        const applied = await applyIssue(issue, link.projectId);
        if (applied === "created") result.tasksCreated += 1;
        else if (applied === "updated") result.tasksUpdated += 1;
      }

      // Watermark from the sync's START — see the header for why.
      await JiraProjectLink.updateOne({ _id: link._id }, { $set: { lastSyncedAt: startedAt } });
      result.projectsSynced += 1;
    } catch (error) {
      result.errors.push({
        projectKey: link.jiraProjectKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return finish(result.errors.length === 0 ? "success" : "partial");
}

/**
 * Applies one issue: upserts the link row and the task it maps to.
 *
 * Returns what happened so the caller can report created vs updated — the
 * difference matters when reading a sync log, because a run that "created" 400
 * tasks on its second execution is a duplication bug, not a busy day.
 */
async function applyIssue(
  issue: JiraIssue,
  projectId: string,
): Promise<"created" | "updated" | "unchanged"> {
  const existing = await JiraIssueLink.findOne({ jiraIssueKey: issue.key });

  const snapshot = {
    jiraIssueId: issue.id,
    jiraProjectKey: issue.projectKey,
    projectId,
    summary: issue.summary,
    status: issue.status,
    statusCategory: issue.statusCategory,
    issueType: issue.issueType,
    priority: issue.priority,
    assigneeAccountId: issue.assigneeAccountId,
    assigneeName: issue.assigneeName,
    dueDate: issue.dueDate ? toDateOnly(issue.dueDate) : null,
    jiraCreatedAt: issue.created ? new Date(issue.created) : null,
    jiraUpdatedAt: issue.updated ? new Date(issue.updated) : null,
    resolvedAt: issue.resolutionDate ? new Date(issue.resolutionDate) : null,
    labels: issue.labels,
    url: issue.url,
    syncedAt: new Date(),
  };

  const taskFields = {
    projectId,
    title: issue.summary,
    assigneeName: issue.assigneeName,
    dueDate: issue.dueDate ? toDateOnly(issue.dueDate) : null,
    status: mapStatus(issue),
  };

  if (existing?.taskId) {
    // The task still exists → update it. If it was deleted here, fall through
    // and recreate rather than leaving a link pointing at nothing.
    const updated = await Task.findByIdAndUpdate(existing.taskId, { $set: taskFields });
    if (updated) {
      await JiraIssueLink.updateOne({ _id: existing._id }, { $set: snapshot });
      return "updated";
    }
  }

  const task = await Task.create({ _id: randomUUID(), ...taskFields });

  await JiraIssueLink.updateOne(
    { jiraIssueKey: issue.key },
    { $set: { ...snapshot, taskId: task._id }, $setOnInsert: { _id: randomUUID() } },
    { upsert: true },
  );

  return "created";
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface JiraSyncHealth {
  lastRunAt: string | null;
  lastOutcome: string | null;
  lastIssuesFetched: number | null;
  /** True when no successful sync has run in 24h — the alert condition. */
  stale: boolean;
  activeMappings: number;
  linkedIssues: number;
}

export async function getJiraSyncHealth(): Promise<JiraSyncHealth> {
  const [last, lastSuccess, activeMappings, linkedIssues] = await Promise.all([
    JiraSync.findOne({}).sort({ startedAt: -1 }).lean(),
    JiraSync.findOne({ outcome: { $in: ["success", "partial"] } }).sort({ startedAt: -1 }).lean(),
    JiraProjectLink.countDocuments({ isActive: true }),
    JiraIssueLink.countDocuments({}),
  ]);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  return {
    lastRunAt: last?.startedAt.toISOString() ?? null,
    lastOutcome: last?.outcome ?? null,
    lastIssuesFetched: last?.issuesFetched ?? null,
    // No mappings means nothing is expected to sync, so "stale" would be a
    // false alarm rather than a signal.
    stale: activeMappings > 0 && (!lastSuccess || lastSuccess.startedAt.getTime() < dayAgo),
    activeMappings,
    linkedIssues,
  };
}
