import { Router } from "express";
import { EXEC_ONLY } from "@dokuma/shared";
import { AiDailyBrief, Milestone, Project } from "../db/models/index.js";
import { requireRole } from "../middleware/auth.js";
import { computeCeoDashboardKpis, getKpiHistory } from "../services/kpi.js";
import { handle, ok } from "./helpers.js";
import { dateOnly } from "./serializers.js";

/**
 * The CEO dashboard (inventory §2.2, routes 4-5).
 *
 * admin/exec only. The legacy page passed all nine roles to `requireRole()`
 * and then redirected non-exec roles itself; the endpoint states the real rule
 * directly, and the client's `<RequireRole>` handles the redirect. Same
 * outcome, one place instead of two.
 *
 * The KPIs come from `computeCeoDashboardKpis()` — the same function
 * `refreshKpiFeed()` snapshots into `kpi_feed`. Migration 0009 is explicit
 * that the dashboard and the Group-facing feed must never become two separate
 * sources of truth, so they share one definition rather than two queries that
 * happen to agree today.
 */

export const dashboardRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/ceo — the 9 KPI cards + the GAR bar's three counts
// ---------------------------------------------------------------------------

dashboardRouter.get(
  "/ceo",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const kpis = await computeCeoDashboardKpis();

    ok(res, {
      // Counts.
      active_projects: kpis.activeProjects,
      projects_green: kpis.projectsGreen,
      projects_amber: kpis.projectsAmber,
      projects_red: kpis.projectsRed,
      tasks_due_this_week: kpis.tasksDueThisWeek,
      overdue_tasks: kpis.overdueTasks,
      critical_blockers: kpis.criticalBlockers,
      high_risk_projects: kpis.highRiskProjects,

      // Money — exact decimal strings, parsed only at the point of display.
      revenue_pipeline_usd: kpis.revenuePipelineUsd,
      contracted_revenue_usd: kpis.contractedRevenueUsd,
      outstanding_receivables_usd: kpis.outstandingReceivablesUsd,

      // A one-decimal percentage, or null when no minutes are tracked. The
      // SQL used `nullif(..., 0)` so an import day with no activity shows no
      // figure rather than a misleading 0%.
      team_utilisation_pct: kpis.teamUtilisationPct,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/brief — the most recent AI daily brief
// ---------------------------------------------------------------------------

/**
 * Returns the latest brief, or null.
 *
 * `generated_by` defaults to 'stub' today; a real LLM step is a drop-in
 * replacement because this only ever reads the most recent row.
 */
dashboardRouter.get(
  "/brief",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const brief = await AiDailyBrief.findOne({}).sort({ briefDate: -1 }).lean();

    ok(
      res,
      brief
        ? {
            headline: brief.headline,
            body: brief.body,
            brief_date: dateOnly(brief.briefDate),
            generated_by: brief.generatedBy,
          }
        : null,
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/upcoming-milestones — the Company Overview's next six
// ---------------------------------------------------------------------------

/**
 * The six soonest milestones that are not yet done.
 *
 * Lives here rather than under /api/projects because it is a dashboard
 * concern: it crosses every project and is ordered by urgency, not by parent.
 */
dashboardRouter.get(
  "/upcoming-milestones",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const milestones = await Milestone.find({ status: { $ne: "done" } })
      .sort({ dueDate: 1 })
      .limit(6)
      .lean();

    // The `projects(name)` join, resolved in one lookup.
    const projectIds = [...new Set(milestones.map((m) => m.projectId))];
    const projects = projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select("name").lean()
      : [];
    const names = new Map(projects.map((p) => [p._id, p.name]));

    ok(
      res,
      milestones.map((m) => ({
        id: m._id,
        name: m.name,
        due_date: dateOnly(m.dueDate),
        status: m.status,
        project_name: names.get(m.projectId) ?? null,
      })),
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/kpi-history — the data behind sparklines and deltas
// ---------------------------------------------------------------------------

/**
 * Per-metric history from `kpi_feed`, oldest first.
 *
 * Returns short series (and null deltas) until the daily cron has accumulated
 * enough days. That is the honest answer — a card must render "no trend yet"
 * rather than invent a comparison it does not have.
 */
dashboardRouter.get(
  "/kpi-history",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    ok(res, { series: await getKpiHistory(30) });
  }),
);
