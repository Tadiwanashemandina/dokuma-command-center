import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ADMIN_ONLY, EXEC_ONLY } from "@dokuma/shared";
import { requireRole, requireAuthContext, requireAnyRole } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { HttpError } from "../middleware/error.js";
import { JiraProjectLink, JiraIssueLink } from "../db/models/jira.js";
import { Project, RiskIssueDecision } from "../db/models/index.js";
import { describeJiraConfig, resolveJiraConfig } from "../services/jira/config.js";
import {
  getCurrentUser,
  listProjects,
  createIssue,
  addComment,
  searchIssuesForAccount,
  JiraNotConfiguredError,
  JiraError,
} from "../services/jira/client.js";
import { syncAllProjects, getJiraSyncHealth } from "../services/jira/sync.js";
import { computeJiraDeliveryMetrics } from "../services/jira/delivery-metrics.js";
import { handle, ok, uuidParam } from "./helpers.js";

/**
 * Jira integration.
 *
 * Distinct from `/api/projects`, which owns this system's own portfolio: this
 * router owns the CONNECTION to an external tracker. Keeping them apart means a
 * Jira outage cannot take the project pages down, and the portfolio endpoints
 * have no dependency on the integration existing.
 *
 * Reading status is exec-tier; configuring mappings and syncing is admin-only,
 * because a mapping decides which external issues become tasks in the CEO's
 * counts.
 */

export const jiraRouter = Router();

/** Translates client errors into HTTP the frontend can act on. */
function toHttpError(error: unknown): never {
  if (error instanceof JiraNotConfiguredError) {
    throw new HttpError(503, error.message);
  }
  if (error instanceof JiraError) {
    if (error.isAuthFailure) {
      throw new HttpError(502, "Jira rejected our credentials. Check JIRA_EMAIL / JIRA_API_TOKEN.");
    }
    if (error.isRateLimited) {
      throw new HttpError(429, "Jira is rate limiting us. Try again shortly.");
    }
    throw new HttpError(502, error.message);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// GET /api/jira/status — is it connected, and is the sync healthy?
// ---------------------------------------------------------------------------

/**
 * Configuration plus sync health, in one call.
 *
 * Health is included for the same reason the OnePlatform feed banner includes
 * it: a sync that silently stopped and a sync that found nothing look identical
 * from the outside, and "Tasks Due This Week" freezing at a stale number is
 * exactly the failure nobody notices.
 */
jiraRouter.get(
  "/status",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const config = resolveJiraConfig();
    ok(res, { config: describeJiraConfig(config), health: await getJiraSyncHealth() });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/jira/verify — prove the credentials work
// ---------------------------------------------------------------------------

/**
 * Calls `/myself`, the Jira equivalent of a whoami.
 *
 * A read-only probe: it confirms the token is valid and shows WHICH Atlassian
 * account this integration acts as — which is what an administrator checks
 * after a token rotation.
 */
jiraRouter.get(
  "/verify",
  ...requireRole(ADMIN_ONLY),
  handle(async (_req, res) => {
    try {
      const user = await getCurrentUser();
      ok(res, {
        connected: true,
        accountId: user.accountId,
        displayName: user.displayName,
        email: user.emailAddress ?? null,
      });
    } catch (error) {
      toHttpError(error);
    }
  }),
);

// ---------------------------------------------------------------------------
// Project mappings
// ---------------------------------------------------------------------------

/** Jira projects the token can see, for building a mapping UI. */
jiraRouter.get(
  "/projects",
  ...requireRole(ADMIN_ONLY),
  handle(async (_req, res) => {
    try {
      ok(res, { projects: await listProjects() });
    } catch (error) {
      toHttpError(error);
    }
  }),
);

jiraRouter.get(
  "/mappings",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const links = await JiraProjectLink.find({}).sort({ jiraProjectKey: 1 }).lean();

    // Resolved in one lookup rather than N — a mapping list is read on a page
    // that also loads several other things.
    const projectIds = [...new Set(links.map((l) => l.projectId))];
    const projects = projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select("name").lean()
      : [];
    const names = new Map(projects.map((p) => [p._id, p.name]));

    ok(res, {
      mappings: links.map((l) => ({
        id: l._id,
        jiraProjectKey: l.jiraProjectKey,
        jiraProjectName: l.jiraProjectName,
        projectId: l.projectId,
        projectName: names.get(l.projectId) ?? null,
        isActive: l.isActive,
        lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
      })),
    });
  }),
);

const mappingSchema = z.object({
  jiraProjectKey: z.string().min(1).max(40),
  jiraProjectName: z.string().max(200).optional(),
  projectId: z.string().uuid(),
});

jiraRouter.post(
  "/mappings",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const body = mappingSchema.parse(req.body);

    // A mapping to a project that does not exist would sync issues into a void.
    const project = await Project.findById(body.projectId).select("name").lean();
    if (!project) throw new HttpError(404, "That project does not exist.");

    const key = body.jiraProjectKey.toUpperCase();

    /**
     * Upsert rather than insert: re-mapping an existing Jira project should
     * MOVE it, not fail on the unique index with a confusing 500. The unique
     * constraint exists to stop one Jira project feeding two Dokuma projects
     * and double-counting, not to make remapping hard.
     */
    await JiraProjectLink.updateOne(
      { jiraProjectKey: key },
      {
        $set: {
          jiraProjectName: body.jiraProjectName ?? null,
          projectId: body.projectId,
          isActive: true,
          // Force a full resync: the new project has none of this issue history.
          lastSyncedAt: null,
        },
        $setOnInsert: { _id: randomUUID(), createdAt: new Date() },
      },
      { upsert: true },
    );

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "jira.mapping_set",
      entityType: "jira_project_link",
      entityId: key,
      metadata: { projectId: body.projectId, projectName: project.name },
    });

    ok(res, { jiraProjectKey: key, projectId: body.projectId }, 201);
  }),
);

jiraRouter.delete(
  "/mappings/:id",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const id = uuidParam(req);

    const link = await JiraProjectLink.findById(id).lean();
    if (!link) throw new HttpError(404, "Mapping not found.");

    /**
     * Deactivated, not deleted.
     *
     * Deleting would orphan every `jira_issue_links` row pointing at this
     * project key, and with them the audit trail of which task came from which
     * issue. Tasks already created stay — they are real work someone may be
     * relying on, and silently removing them from the CEO's counts because an
     * integration was unmapped would be worse than leaving them.
     */
    await JiraProjectLink.updateOne({ _id: id }, { $set: { isActive: false } });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "jira.mapping_disabled",
      entityType: "jira_project_link",
      entityId: link.jiraProjectKey,
    });

    ok(res, { id, isActive: false });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/jira/sync — pull issues now
// ---------------------------------------------------------------------------

jiraRouter.post(
  "/sync",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const full = req.query["full"] === "true";

    const result = await syncAllProjects({ full, mode: full ? "full" : "manual" });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "jira.sync",
      entityType: "jira_sync",
      metadata: {
        outcome: result.outcome,
        issuesFetched: result.issuesFetched,
        tasksCreated: result.tasksCreated,
      },
    });

    ok(res, result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/jira/delivery-metrics — the Group measures, from real issues
// ---------------------------------------------------------------------------

jiraRouter.get(
  "/delivery-metrics",
  ...requireRole(EXEC_ONLY),
  handle(async (req, res) => {
    const schema = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const q = schema.parse(req.query);

    // Defaults to the trailing 30 days, which is the window a delivery
    // conversation actually uses.
    const to = q.to ? new Date(`${q.to}T23:59:59Z`) : new Date();
    const from = q.from
      ? new Date(`${q.from}T00:00:00Z`)
      : new Date(to.getTime() - 30 * 86_400_000);

    ok(res, {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      metrics: await computeJiraDeliveryMetrics({ from, to }),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/jira/my-issues — the per-person list
// ---------------------------------------------------------------------------

/**
 * The caller's own assigned issues.
 *
 * Any authenticated role, because it returns only the requester's own work —
 * this is the surface the legacy `lib/hr/jira.ts` provided for the Employee 360
 * profile.
 */
jiraRouter.get(
  "/my-issues",
  requireAnyRole,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const accountId = (auth.user as { jiraAccountId?: string | null }).jiraAccountId ?? null;

    // Not an error: most users will never have a Jira account linked, and a 404
    // would make the profile page look broken rather than simply empty.
    if (!accountId) {
      ok(res, { linked: false, issues: [] });
      return;
    }

    try {
      ok(res, { linked: true, issues: await searchIssuesForAccount(accountId) });
    } catch (error) {
      toHttpError(error);
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /api/jira/issues — two-way: raise a Jira issue from here
// ---------------------------------------------------------------------------

const createIssueSchema = z.object({
  projectKey: z.string().min(1).max(40),
  summary: z.string().min(1).max(255),
  description: z.string().max(10_000).optional(),
  issueType: z.string().max(60).optional(),
  labels: z.array(z.string().max(60)).max(10).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Optional: the risk this issue was raised from, for the back-reference. */
  riskId: z.string().uuid().optional(),
});

/**
 * Creates an issue in Jira.
 *
 * Admin-only. This writes to an external system under Dokuma's Atlassian
 * account, so every call is audited with the issue key it produced — which is
 * what makes "who raised this?" answerable later.
 */
jiraRouter.post(
  "/issues",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const body = createIssueSchema.parse(req.body);

    try {
      const created = await createIssue({
        projectKey: body.projectKey.toUpperCase(),
        summary: body.summary,
        ...(body.description ? { description: body.description } : {}),
        ...(body.issueType ? { issueType: body.issueType } : {}),
        ...(body.labels ? { labels: body.labels } : {}),
        ...(body.dueDate ? { dueDate: body.dueDate } : {}),
      });

      /**
       * Record the link on the originating risk, so the risk register shows
       * where the work went. Best-effort: a failure here must not make the
       * caller think the issue was not created — it was, and retrying would
       * raise a duplicate in Jira.
       */
      if (body.riskId) {
        await RiskIssueDecision.updateOne(
          { _id: body.riskId },
          { $set: { jiraIssueKey: created.key } },
        ).catch(() => undefined);
      }

      await audit(req, {
        actorId: auth.user.id as string,
        actorRole: auth.role,
        action: "jira.issue_created",
        entityType: "jira_issue",
        entityId: created.key,
        metadata: { projectKey: body.projectKey, summary: body.summary, riskId: body.riskId ?? null },
      });

      ok(res, { key: created.key, id: created.id, url: created.self }, 201);
    } catch (error) {
      toHttpError(error);
    }
  }),
);

const commentSchema = z.object({ text: z.string().min(1).max(10_000) });

jiraRouter.post(
  "/issues/:key/comments",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const key = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/i, "Expected an issue key like ABC-123")
      .parse(req.params["key"]);
    const body = commentSchema.parse(req.body);

    try {
      const comment = await addComment(key.toUpperCase(), body.text);

      await audit(req, {
        actorId: auth.user.id as string,
        actorRole: auth.role,
        action: "jira.comment_added",
        entityType: "jira_issue",
        entityId: key.toUpperCase(),
      });

      ok(res, { id: comment.id }, 201);
    } catch (error) {
      toHttpError(error);
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /api/jira/issues — what has been synced
// ---------------------------------------------------------------------------

jiraRouter.get(
  "/issues",
  ...requireRole(EXEC_ONLY),
  handle(async (req, res) => {
    const schema = z.object({
      projectKey: z.string().max(40).optional(),
      limit: z.coerce.number().int().positive().max(200).optional().default(50),
    });
    const q = schema.parse(req.query);

    const filter = q.projectKey ? { jiraProjectKey: q.projectKey.toUpperCase() } : {};
    const issues = await JiraIssueLink.find(filter)
      .sort({ jiraUpdatedAt: -1 })
      .limit(q.limit)
      .lean();

    ok(res, {
      issues: issues.map((i) => ({
        key: i.jiraIssueKey,
        summary: i.summary,
        status: i.status,
        statusCategory: i.statusCategory,
        issueType: i.issueType,
        assigneeName: i.assigneeName,
        dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
        url: i.url,
        projectKey: i.jiraProjectKey,
        taskId: i.taskId,
      })),
    });
  }),
);
