import { Router } from "express";
import { z } from "zod";
import {
  Client,
  Milestone,
  Project,
  RiskIssueDecision,
  Task,
  type ProjectDoc,
} from "../db/models/index.js";
import { requireAnyRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { handle, ok, pagination, page, uuidParam } from "./helpers.js";
import { dateOnly, money, timestamp } from "./serializers.js";

/**
 * Projects (inventory §2.3, routes 6-7).
 *
 * `requireAnyRole` rather than `requireRole([...])` is deliberate: these pages
 * had no `requireRole()` call and relied on RLS's `current_role() is not null`
 * plus the layout gate. D-2 makes that explicit — any authenticated role, now
 * stated in the route rather than left implicit in a policy.
 *
 * The client name comes from a real lookup here. In the Supabase shim a
 * joined select (`select("*, clients(name)")`) silently dropped any field
 * containing `(`, so every client column on these pages renders "—" today
 * (inventory §0). Porting the join properly is a bug fix, not just a move.
 */

export const projectsRouter = Router();

const listQuerySchema = z.object({
  /** Narrow to one RAG status, as the portfolio table's filter does. */
  status: z.enum(["green", "amber", "red"]).optional(),
  /** Case-insensitive substring match on the project name. */
  search: z.string().trim().max(200).optional(),
});

/** Wire shape — snake_case, matching what the ported components already read. */
function serializeProject(project: ProjectDoc, clientName: string | null) {
  return {
    id: project._id,
    name: project.name,
    status: project.status,
    owner_name: project.ownerName,
    budget_usd: money(project.budgetUsd),
    start_date: dateOnly(project.startDate),
    target_end_date: dateOnly(project.targetEndDate),
    description: project.description,
    client_id: project.clientId,
    /** The `clients(name)` join the shim was dropping. */
    client_name: clientName,
    created_at: timestamp(project.createdAt),
    updated_at: timestamp(project.updatedAt),
  };
}

/**
 * Resolves client names for a batch of projects in one query.
 *
 * Deliberately not `.populate()`: this returns only the name, and doing it as
 * a single `$in` lookup keeps it to two round trips regardless of page size
 * rather than one per project.
 */
async function clientNamesFor(projects: ProjectDoc[]): Promise<Map<string, string>> {
  const ids = [...new Set(projects.map((p) => p.clientId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();

  const clients = await Client.find({ _id: { $in: ids } })
    .select("name")
    .lean();

  return new Map(clients.map((c) => [c._id, c.name]));
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

projectsRouter.get(
  "/",
  ...requireAnyRole,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const { status, search } = listQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = {};
    if (status) filter["status"] = status;
    if (search) {
      // Escaped before it reaches the query: an unescaped user string here
      // would let a caller inject regex metacharacters (`.*`, a catastrophic
      // backtracking pattern) into a database query.
      filter["name"] = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const [projects, total] = await Promise.all([
      // The page ordered by status then name; preserved so the RAG grouping
      // the portfolio table relies on survives the port.
      Project.find(filter).sort({ status: 1, name: 1 }).skip(offset).limit(limit).lean(),
      Project.countDocuments(filter),
    ]);

    const names = await clientNamesFor(projects);

    ok(
      res,
      page(
        projects.map((p) => serializeProject(p, names.get(p.clientId ?? "") ?? null)),
        total,
        { limit, offset },
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------

/**
 * The aggregated detail view: project + milestones + tasks + risks.
 *
 * One endpoint rather than four, because the page renders them together and
 * four round trips from the browser would be slower and could show a
 * half-loaded project. The 20-task cap is the legacy page's `.limit(20)`.
 */
projectsRouter.get(
  "/:id",
  ...requireAnyRole,
  handle(async (req, res) => {
    const id = uuidParam(req);

    const project = await Project.findById(id).lean();
    // `notFound()` becomes a real 404 the client renders as its not-found route.
    if (!project) throw new HttpError(404, "Project not found.");

    const [milestones, tasks, risks, client] = await Promise.all([
      Milestone.find({ projectId: id }).sort({ dueDate: 1 }).lean(),
      Task.find({ projectId: id }).sort({ dueDate: 1 }).limit(20).lean(),
      RiskIssueDecision.find({ projectId: id }).sort({ dueDate: 1 }).lean(),
      project.clientId ? Client.findById(project.clientId).select("name").lean() : null,
    ]);

    ok(res, {
      project: serializeProject(project, client?.name ?? null),
      milestones: milestones.map((m) => ({
        id: m._id,
        name: m.name,
        due_date: dateOnly(m.dueDate),
        status: m.status,
      })),
      tasks: tasks.map((t) => ({
        id: t._id,
        title: t.title,
        assignee_name: t.assigneeName,
        due_date: dateOnly(t.dueDate),
        status: t.status,
      })),
      risks: risks.map((r) => ({
        id: r._id,
        type: r.type,
        title: r.title,
        description: r.description,
        owner_name: r.ownerName,
        due_date: dateOnly(r.dueDate),
        severity: r.severity,
        probability: r.probability,
        impact: r.impact,
        status: r.status,
      })),
    });
  }),
);
