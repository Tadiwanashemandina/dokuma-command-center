import { api } from "@/lib/api-client";

/**
 * Typed client functions for /api/dashboard (admin/exec only).
 *
 * These back the CEO Home and Company Overview pages. The KPI figures come
 * from the same server-side definition that feeds the Group-facing
 * `kpi_feed`, so the dashboard and the feed cannot drift apart.
 */

export interface CeoDashboardKpis {
  active_projects: number;
  projects_green: number;
  projects_amber: number;
  projects_red: number;
  tasks_due_this_week: number;
  overdue_tasks: number;
  critical_blockers: number;
  high_risk_projects: number;
  /** Exact decimal strings — parse only at the point of display (D-12). */
  revenue_pipeline_usd: string | null;
  contracted_revenue_usd: string | null;
  outstanding_receivables_usd: string | null;
  /** One decimal place, or null when no minutes are tracked — never 0. */
  team_utilisation_pct: string | null;
}

export interface DailyBrief {
  headline: string;
  body: string;
  brief_date: string | null;
  generated_by: string;
}

export interface UpcomingMilestone {
  id: string;
  name: string;
  due_date: string | null;
  status: "pending" | "on_track" | "at_risk" | "done";
  project_name: string | null;
}

export function getCeoDashboard(): Promise<CeoDashboardKpis> {
  return api.get<CeoDashboardKpis>("/dashboard/ceo");
}

/** Resolves to null when no brief has been generated yet. */
export function getDailyBrief(): Promise<DailyBrief | null> {
  return api.get<DailyBrief | null>("/dashboard/brief");
}

export function getUpcomingMilestones(): Promise<UpcomingMilestone[]> {
  return api.get<UpcomingMilestone[]>("/dashboard/upcoming-milestones");
}

/**
 * One metric's history, oldest first.
 *
 * `delta` is null — not 0 — when there are fewer than two snapshots. The daily
 * cron has to run at least twice before any comparison is honest, and a card
 * must say "Collecting trend" rather than show a fabricated 0%.
 */
export interface KpiSeries {
  metric_name: string;
  unit: string | null;
  points: { as_of_date: string; value: number | null }[];
  current: number | null;
  delta: number | null;
  deltaPct: number | null;
}

export function getKpiHistory(): Promise<{ series: KpiSeries[] }> {
  return api.get<{ series: KpiSeries[] }>("/dashboard/kpi-history");
}
