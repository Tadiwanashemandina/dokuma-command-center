import { randomUUID } from "node:crypto";
import {
  ActivityRecord,
  FinanceCompanyTotals,
  KpiFeed,
  Project,
  RiskIssueDecision,
  Task,
} from "../db/models/index.js";
import {
  addDays,
  currentDate,
  toDateOnly,
  decimalToNumber,
  decimalToString,
  formatDateOnly,
  toDecimal128,
} from "../db/types.js";

/**
 * The CEO dashboard KPIs — the application-level replacement for the view
 * `v_ceo_dashboard_kpis` and the function `refresh_kpi_feed()` (migration
 * 0009).
 *
 * The view computed every headline figure live; `refresh_kpi_feed()` snapshots
 * that same view into `kpi_feed`, which is what the Group platform polls. The
 * migration comment is explicit that the two must never become separate
 * sources of truth, so `computeCeoDashboardKpis()` is the single definition
 * and the refresh merely writes its output.
 *
 * NOTE: `supabase.rpc()` is a no-op in the in-tree Mongo shim, so
 * `refresh_kpi_feed` has silently done nothing — every value in `kpi_feed` is
 * stale (inventory §0). This module is what makes the feed live again.
 */

export interface CeoDashboardKpis {
  activeProjects: number;
  projectsGreen: number;
  projectsAmber: number;
  projectsRed: number;
  tasksDueThisWeek: number;
  overdueTasks: number;
  criticalBlockers: number;
  revenuePipelineUsd: string | null;
  contractedRevenueUsd: string | null;
  outstandingReceivablesUsd: string | null;
  teamUtilisationPct: string | null;
  highRiskProjects: number;
}

export async function computeCeoDashboardKpis(): Promise<CeoDashboardKpis> {
  const today = currentDate();
  const weekOut = addDays(today, 7);

  const [
    activeProjects,
    projectsGreen,
    projectsAmber,
    projectsRed,
    tasksDueThisWeek,
    overdueTasks,
    criticalBlockers,
    latestTotals,
    teamUtilisationPct,
    highRiskProjectIds,
  ] = await Promise.all([
    // `count(*) from projects` — despite the name there is NO active filter.
    Project.countDocuments({}),
    Project.countDocuments({ status: "green" }),
    Project.countDocuments({ status: "amber" }),
    Project.countDocuments({ status: "red" }),

    // status <> 'done' AND due_date BETWEEN current_date AND current_date + 7,
    // inclusive at both ends. A null due_date is excluded by the comparison,
    // exactly as in SQL.
    Task.countDocuments({
      status: { $ne: "done" },
      dueDate: { $ne: null, $gte: today, $lte: weekOut },
    }),

    Task.countDocuments({
      status: { $ne: "done" },
      dueDate: { $ne: null, $lt: today },
    }),

    // Requires type = 'risk' — note this differs from highRiskProjects below.
    RiskIssueDecision.countDocuments({ type: "risk", severity: "critical", status: "open" }),

    // All three money figures come from the single latest snapshot row.
    FinanceCompanyTotals.findOne({}).sort({ asOfDate: -1 }).lean(),

    computeTeamUtilisation(),

    // count(distinct project_id): critical + open, but ANY type — unlike
    // criticalBlockers, which additionally requires type = 'risk'. The two
    // are deliberately different; do not unify them.
    RiskIssueDecision.distinct("projectId", {
      severity: "critical",
      status: "open",
      projectId: { $ne: null },
    }),
  ]);

  return {
    activeProjects,
    projectsGreen,
    projectsAmber,
    projectsRed,
    tasksDueThisWeek,
    overdueTasks,
    criticalBlockers,
    revenuePipelineUsd: decimalToString(latestTotals?.revenuePipelineUsd),
    contractedRevenueUsd: decimalToString(latestTotals?.contractedRevenueUsd),
    outstandingReceivablesUsd: decimalToString(latestTotals?.outstandingReceivablesUsd),
    teamUtilisationPct,
    highRiskProjects: highRiskProjectIds.length,
  };
}

/**
 * `round(100.0 * sum(on_project_minutes) /
 *        nullif(sum(on_project_minutes) + sum(off_project_minutes), 0), 1)`
 * restricted to the single most recent `activity_date` present.
 *
 * `nullif(..., 0)` means a zero denominator yields NULL rather than a division
 * error — an import day with no tracked minutes shows no figure instead of a
 * misleading zero. The feed carries that null through rather than coercing it.
 */
async function computeTeamUtilisation(): Promise<string | null> {
  const latest = await ActivityRecord.findOne({})
    .sort({ activityDate: -1 })
    .select("activityDate")
    .lean();

  if (!latest) return null;

  const [totals] = await ActivityRecord.aggregate<{ onMinutes: number; offMinutes: number }>([
    { $match: { activityDate: latest.activityDate } },
    {
      $group: {
        _id: null,
        onMinutes: { $sum: { $ifNull: ["$onProjectMinutes", 0] } },
        offMinutes: { $sum: { $ifNull: ["$offProjectMinutes", 0] } },
      },
    },
  ]);

  if (!totals) return null;

  const denominator = totals.onMinutes + totals.offMinutes;
  if (denominator === 0) return null; // nullif(..., 0)

  // Round half-up to one decimal place, matching Postgres `round(numeric, 1)`.
  return (Math.round((1000 * totals.onMinutes) / denominator) / 10).toFixed(1);
}

/**
 * `public.refresh_kpi_feed()`.
 *
 * Writes the twelve contract metrics for today, upserting on
 * `(company, metric_name, as_of_date)` so re-running on the same day
 * overwrites rather than duplicating. `company` is the hard-coded literal
 * `'Dokuma'` and the date is evaluated once so all twelve rows share it —
 * both exactly as in the SQL.
 */
export async function refreshKpiFeed(): Promise<void> {
  const kpis = await computeCeoDashboardKpis();
  const today = currentDate();
  const now = new Date();

  const rows: {
    metricName: KpiMetricName;
    value: string | number | null;
    unit: "count" | "usd" | "pct";
  }[] = [
    { metricName: "active_projects", value: kpis.activeProjects, unit: "count" },
    { metricName: "projects_green", value: kpis.projectsGreen, unit: "count" },
    { metricName: "projects_amber", value: kpis.projectsAmber, unit: "count" },
    { metricName: "projects_red", value: kpis.projectsRed, unit: "count" },
    { metricName: "tasks_due_this_week", value: kpis.tasksDueThisWeek, unit: "count" },
    { metricName: "overdue_tasks", value: kpis.overdueTasks, unit: "count" },
    { metricName: "critical_blockers", value: kpis.criticalBlockers, unit: "count" },
    { metricName: "revenue_pipeline_usd", value: kpis.revenuePipelineUsd, unit: "usd" },
    { metricName: "contracted_revenue_usd", value: kpis.contractedRevenueUsd, unit: "usd" },
    { metricName: "outstanding_receivables_usd", value: kpis.outstandingReceivablesUsd, unit: "usd" },
    { metricName: "team_utilisation_pct", value: kpis.teamUtilisationPct, unit: "pct" },
    { metricName: "high_risk_projects", value: kpis.highRiskProjects, unit: "count" },
  ];

  await KpiFeed.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { company: "Dokuma", metricName: row.metricName, asOfDate: today },
        update: {
          $set: {
            value: row.value === null ? null : toDecimal128(row.value, 2),
            unit: row.unit,
            updatedAt: now,
          },
          $setOnInsert: { _id: randomUUID() },
        },
        upsert: true,
      },
    })),
  );
}

/**
 * The twelve metric names are the external contract consumed by the Group
 * platform. Adding, renaming or removing one is a breaking change to a
 * downstream consumer, not an internal refactor (inventory §10, D-13).
 */
export const KPI_METRIC_NAMES = [
  "active_projects",
  "projects_green",
  "projects_amber",
  "projects_red",
  "tasks_due_this_week",
  "overdue_tasks",
  "critical_blockers",
  "revenue_pipeline_usd",
  "contracted_revenue_usd",
  "outstanding_receivables_usd",
  "team_utilisation_pct",
  "high_risk_projects",
] as const;

export type KpiMetricName = (typeof KPI_METRIC_NAMES)[number];

/** The unit vocabulary that discriminates `value`. Also part of the contract. */
export const KPI_UNITS = ["count", "usd", "pct"] as const;

/**
 * The Group-facing polling contract (inventory §10, D-13): same path, same
 * JSON shape, same session auth, same rate limit. Frozen deliberately — a
 * migration is the wrong time to renegotiate a cross-team interface.
 */
export interface KpiFeedRow {
  company: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  as_of_date: string;
  updated_at: string;
}

export async function getKpiFeed(): Promise<KpiFeedRow[]> {
  /**
   * Every row, every date, ordered by `metric_name` — exactly what the
   * Supabase query did:
   *
   *   .from("kpi_feed").select(...).order("metric_name")
   *
   * Deliberately NOT narrowed to today. The Group platform polls this and may
   * be reading history from it; silently dropping every prior day would be a
   * breaking change to a contract D-13 says to freeze until the cross-team
   * question is settled separately.
   *
   * The ordering is alphabetical by metric name, matching `.order()`, not the
   * view's column sequence — the two differ, and this is the one the consumer
   * has been receiving.
   */
  const rows = await KpiFeed.find({}).sort({ metricName: 1 }).lean();

  return rows.map((row) => ({
      company: row.company,
      metric_name: row.metricName,
      // The existing contract emits a JSON number here, so this is the one
      // place a decimal is deliberately not stringified. Counts, percentages
      // and USD totals at this magnitude are exact in float64.
      value: decimalToNumber(row.value),
      unit: row.unit ?? null,
      as_of_date: formatDateOnly(row.asOfDate) ?? "",
      updated_at: row.updatedAt.toISOString(),
    }));
}

/* --------------------------------------------------------------------- *
 * KPI history — the data behind sparklines and deltas
 * --------------------------------------------------------------------- */

/** One metric's values over time, oldest first. */
export interface KpiSeries {
  metric_name: KpiMetricName;
  unit: string | null;
  /** Oldest → newest, so a sparkline can render it directly. */
  points: { as_of_date: string; value: number | null }[];
  /** The most recent value, or null when the series is empty. */
  current: number | null;
  /**
   * Change against the oldest point in the window. Null when there is only one
   * snapshot — which is the honest answer, not zero. A dashboard that shows
   * "0%" when it means "we have no history" is lying quietly.
   */
  delta: number | null;
  deltaPct: number | null;
}

/**
 * Reads `kpi_feed` history for sparklines and trend deltas.
 *
 * `kpi_feed` has always been shaped to accumulate one row per metric per day —
 * that is what its `(company, metric_name, as_of_date)` unique key is for — but
 * nothing wrote it on a schedule, so it held a single snapshot and no card
 * could show a trend. The cron at `/api/cron/kpi-snapshot` fills it daily.
 *
 * Until enough days accumulate, `points` is short and `delta` is null. Callers
 * must render that as "no trend yet" rather than inventing one.
 */
export async function getKpiHistory(days = 30): Promise<KpiSeries[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await KpiFeed.find({ asOfDate: { $gte: toDateOnly(since) } })
    .sort({ asOfDate: 1 })
    .lean();

  const byMetric = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byMetric.get(row.metricName) ?? [];
    bucket.push(row);
    byMetric.set(row.metricName, bucket);
  }

  return KPI_METRIC_NAMES.map((metricName) => {
    const series = byMetric.get(metricName) ?? [];
    const points = series.map((row) => ({
      as_of_date: formatDateOnly(row.asOfDate) ?? "",
      value: decimalToNumber(row.value),
    }));

    const current = points.at(-1)?.value ?? null;
    const first = points[0]?.value ?? null;

    // A delta needs two distinct snapshots. One point means no trend exists.
    const hasTrend = points.length >= 2 && first !== null && current !== null;

    return {
      metric_name: metricName,
      unit: series.at(-1)?.unit ?? null,
      points,
      current,
      delta: hasTrend ? Number((current - first).toFixed(2)) : null,
      // Guard the zero denominator rather than emitting Infinity.
      deltaPct:
        hasTrend && first !== 0 ? Number((((current - first) / Math.abs(first)) * 100).toFixed(1)) : null,
    };
  });
}
