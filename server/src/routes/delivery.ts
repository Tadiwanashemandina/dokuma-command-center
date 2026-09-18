import { Router } from "express";
import { DeliveryMetric, Project } from "../db/models/index.js";
import { requireAnyRole } from "../middleware/auth.js";
import { handle, ok, pagination, page } from "./helpers.js";
import { dateOnly } from "./serializers.js";

/**
 * Software delivery metrics (inventory §2.3, route 11).
 *
 * `requireAnyRole` per D-2 — the page had no `requireRole()` and relied on
 * RLS's `current_role() is not null`.
 *
 * The totals are computed server-side rather than by the client. The legacy
 * page summed whatever rows it had fetched, so its "Commits (last 7 days)"
 * card actually described the last 30 ROWS, not seven days — which is a
 * different number as soon as more than one repo reports. Computing the
 * totals here over an explicit window makes the card mean what it says, and
 * keeps the arithmetic in one place.
 */

export const deliveryRouter = Router();

deliveryRouter.get(
  "/",
  ...requireAnyRole,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);

    const [metrics, total] = await Promise.all([
      DeliveryMetric.find({}).sort({ metricDate: -1 }).skip(offset).limit(limit).lean(),
      DeliveryMetric.countDocuments({}),
    ]);

    // Resolve project names in one lookup rather than per row. The legacy page
    // used a `projects(name)` joined select, which the Mongo shim silently
    // dropped — so this column renders "—" in the current working tree.
    const projectIds = [...new Set(metrics.map((m) => m.projectId).filter((id): id is string => id !== null))];
    const projects = projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select("name").lean()
      : [];
    const names = new Map(projects.map((p) => [p._id, p.name]));

    // The headline cards: a real trailing-7-day window, across every repo.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const [windowTotals] = await DeliveryMetric.aggregate<{
      commits: number;
      deploys: number;
      openDefects: number;
    }>([
      { $match: { metricDate: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          commits: { $sum: "$commitsCount" },
          deploys: { $sum: "$deploysCount" },
          openDefects: { $sum: "$openDefectsCount" },
        },
      },
    ]);

    ok(res, {
      ...page(
        metrics.map((m) => ({
          id: m._id,
          repo_name: m.repoName,
          project_id: m.projectId,
          project_name: names.get(m.projectId ?? "") ?? null,
          metric_date: dateOnly(m.metricDate),
          commits_count: m.commitsCount,
          deploys_count: m.deploysCount,
          open_defects_count: m.openDefectsCount,
          closed_defects_count: m.closedDefectsCount,
          source: m.source,
        })),
        total,
        { limit, offset },
      ),
      totals: {
        commits: windowTotals?.commits ?? 0,
        deploys: windowTotals?.deploys ?? 0,
        open_defects: windowTotals?.openDefects ?? 0,
      },
    });
  }),
);
