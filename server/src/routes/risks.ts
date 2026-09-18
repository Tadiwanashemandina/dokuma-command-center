import { Router } from "express";
import { z } from "zod";
import { Project, RiskIssueDecision } from "../db/models/index.js";
import { requireAnyRole, requireAuthContext } from "../middleware/auth.js";
import { handle, ok, pagination, page } from "./helpers.js";
import { dateOnly } from "./serializers.js";

/**
 * Risks, issues and decisions (inventory §2.3, route 9).
 *
 * DEPARTMENT-SCOPED (§4.5, D-5). This is one of only two collections that
 * carry a `department` column, and the scoping rule has a sharp edge worth
 * restating at the query:
 *
 *   There is NO fallback to untagged rows. A scoped role (finance or HR) sees
 *   ONLY rows explicitly tagged with its own department. `null`-department
 *   rows — the company-wide ones — are exec-only.
 *
 * ONBOARDING §7 flags this as intentional, and notes that HR's view being
 * empty today is correct rather than broken. Adding `{ department: null }` to
 * the scoped branch would look like a bug fix and would in fact be a data
 * leak, so the filter is derived from `req.auth.departmentScope` — resolved
 * once by `requireAuth` — rather than recomputed here.
 */

export const risksRouter = Router();

const listQuerySchema = z.object({
  type: z.enum(["risk", "issue", "decision"]).optional(),
  status: z.enum(["open", "mitigating", "closed"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  /** `/company` asks for open criticals only. */
  critical: z.coerce.boolean().optional(),
});

risksRouter.get(
  "/",
  ...requireAnyRole,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { limit, offset } = pagination(req);
    const { type, status, severity, critical } = listQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = {};

    // The department gate. `departmentScope` is null for admin/exec/viewer,
    // who see every row including the untagged ones.
    if (auth.departmentScope !== null) {
      filter["department"] = auth.departmentScope;
    }

    if (type) filter["type"] = type;
    if (status) filter["status"] = status;
    if (severity) filter["severity"] = severity;
    if (critical) {
      filter["severity"] = "critical";
      filter["status"] = "open";
    }

    const [items, total] = await Promise.all([
      // status then due_date, as the register table ordered.
      RiskIssueDecision.find(filter).sort({ status: 1, dueDate: 1 }).skip(offset).limit(limit).lean(),
      RiskIssueDecision.countDocuments(filter),
    ]);

    // The `projects(name)` join the Supabase shim drops.
    const projectIds = [...new Set(items.map((i) => i.projectId).filter((id): id is string => id !== null))];
    const projects = projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select("name").lean()
      : [];
    const names = new Map(projects.map((p) => [p._id, p.name]));

    ok(res, {
      ...page(
        items.map((item) => ({
          id: item._id,
          type: item.type,
          title: item.title,
          description: item.description,
          project_id: item.projectId,
          /** null means company-wide, which the table renders as such. */
          project_name: names.get(item.projectId ?? "") ?? null,
          owner_name: item.ownerName,
          due_date: dateOnly(item.dueDate),
          severity: item.severity,
          probability: item.probability,
          impact: item.impact,
          status: item.status,
          department: item.department,
        })),
        total,
        { limit, offset },
      ),
      /**
       * Echoed so the page can title itself "scoped to Finance" without
       * recomputing the rule from the user's role — one source of truth for
       * what the caller is actually seeing.
       */
      scope: auth.departmentScope,
    });
  }),
);
