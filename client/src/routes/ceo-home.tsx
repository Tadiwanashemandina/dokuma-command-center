import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarClock, ShieldAlert } from "lucide-react";
import { type AttentionItem } from "@/components/attention-banner";
import { CommandDeck, type DeckFigure } from "@/components/command-deck";
import { MetricStrip, type StripMetric } from "@/components/metric-strip";
import { CriticalRiskList } from "@/components/critical-risk-list";
import { GarBar } from "@/components/gar-bar";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import { ArrowLink } from "@/components/arrow-link";
import { DataFreshness } from "@/components/data-freshness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  getCeoDashboard,
  getDailyBrief,
  getKpiHistory,
  getUpcomingMilestones,
} from "@/lib/api/dashboard";
import { listRisks } from "@/lib/api/risks";
import { seriesByMetric, trendProps } from "@/lib/kpi-trend";

/**
 * CEO Home.
 *
 * Ported from `app/(dashboard)/page.tsx`, then restructured. The port was a
 * faithful grid of nine equal KPI cards, which is what the Next page did — and
 * it read as a wall of numbers: every figure at the same weight, no statement
 * of what was wrong, and nothing to act on without leaving the page.
 *
 * The page now answers three questions in the order an executive asks them:
 *
 *   1. What needs me today?        → the attention banner
 *   2. How is the business?        → the money hero + the metric strip
 *   3. What specifically is wrong? → critical risks, milestones, portfolio health
 *
 * Role gating is unchanged: the `<RequireRole roles={EXEC_ONLY}>` boundary in
 * the route tree, with the endpoint enforcing the same rule server-side.
 *
 * Queries are kept separate rather than merged into one payload so a slow or
 * failing panel degrades alone — the money figures must not wait on the risk
 * list, and neither waits on the brief.
 */
export function CeoHomePage() {
  useDocumentTitle("Dashboard");

  const kpis = useQuery({ queryKey: ["dashboard", "ceo"], queryFn: getCeoDashboard });
  const brief = useQuery({ queryKey: ["dashboard", "brief"], queryFn: getDailyBrief });

  // History changes once a day, so it is cached hard and never blocks a figure.
  const history = useQuery({
    queryKey: ["dashboard", "kpi-history"],
    queryFn: getKpiHistory,
    staleTime: 5 * 60_000,
  });

  const risks = useQuery({
    queryKey: ["risks", "critical", "dashboard"],
    queryFn: () => listRisks({ critical: true, limit: 5 }),
  });

  const milestones = useQuery({
    queryKey: ["dashboard", "upcoming-milestones"],
    queryFn: getUpcomingMilestones,
  });

  const k = kpis.data;
  const series = seriesByMetric(history.data);

  const value = (v: number | string | null | undefined): string | number =>
    kpis.isPending ? "…" : (v ?? "—");

  const usd = (v: string | null | undefined): string =>
    kpis.isPending ? "…" : formatUsdCompact(v == null ? null : Number(v));

  /**
   * The triage rule, stated once.
   *
   * Only genuinely actionable states appear. "Tasks due this week" is not here:
   * work being scheduled is normal, and listing it as an alert would teach the
   * reader to ignore the banner.
   */
  const attention: AttentionItem[] = [
    {
      label: "critical blockers",
      count: k?.critical_blockers ?? 0,
      href: "/risks",
      tone: "critical",
    },
    {
      label: "high-risk projects",
      count: k?.high_risk_projects ?? 0,
      href: "/risks",
      tone: "critical",
    },
    {
      label: "overdue tasks",
      count: k?.overdue_tasks ?? 0,
      href: "/projects",
      tone: "warning",
    },
  ];

  const figures: DeckFigure[] = [
    {
      label: "Revenue Pipeline",
      value: usd(k?.revenue_pipeline_usd),
      href: "/finance",
      primary: true,
      ...trendProps(series.get("revenue_pipeline_usd")),
    },
    {
      label: "Contracted Revenue",
      value: usd(k?.contracted_revenue_usd),
      href: "/finance",
      ...trendProps(series.get("contracted_revenue_usd")),
    },
    {
      label: "Outstanding Receivables",
      value: usd(k?.outstanding_receivables_usd),
      href: "/finance",
      ...trendProps(series.get("outstanding_receivables_usd"), "down"),
    },
  ];

  const strip: StripMetric[] = [
    {
      label: "Active Projects",
      value: value(k?.active_projects),
      href: "/projects",
      ...trendProps(series.get("active_projects")),
    },
    {
      label: "Tasks Due This Week",
      value: value(k?.tasks_due_this_week),
      href: "/projects",
      ...trendProps(series.get("tasks_due_this_week"), "down"),
    },
    {
      label: "Overdue Tasks",
      value: value(k?.overdue_tasks),
      href: "/projects",
      tone: (k?.overdue_tasks ?? 0) > 0 ? "critical" : "default",
      ...trendProps(series.get("overdue_tasks"), "down"),
    },
    {
      label: "Team Utilisation",
      value: value(k?.team_utilisation_pct),
      unit: "%",
      href: "/people",
      ...trendProps(series.get("team_utilisation_pct")),
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <CommandDeck
        eyebrow={
          <>
            <Activity className="h-3.5 w-3.5" /> Executive overview
          </>
        }
        title="Dashboard"
        /* The figures below say what this page is faster than a heading can,
           so the <h1> is kept for the document outline and screen readers
           without taking up space on screen. */
        hideTitle
        figures={figures}
        attention={attention}
        isPending={kpis.isPending}
        right={
          <DataFreshness
            tone="dark"
            updatedAt={kpis.dataUpdatedAt}
            isFetching={kpis.isFetching}
            onRefresh={() => {
              void kpis.refetch();
              void history.refetch();
              void risks.refetch();
            }}
          />
        }
      />

      {kpis.error && (
        <QueryError
          error={kpis.error}
          onRetry={() => void kpis.refetch()}
          resource="the executive dashboard"
        />
      )}

      {!kpis.error && <MetricStrip metrics={strip} />}

      {/* ------------------------------------------------------------------ */}
      {/* 3. What specifically is wrong?                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 font-serif text-lg text-navy">
              <ShieldAlert className="h-4 w-4 text-status-red" />
              Critical Risks &amp; Blockers
            </CardTitle>
            <ArrowLink href="/risks">All risks</ArrowLink>
          </CardHeader>
          <CardContent>
            {risks.error ? (
              <QueryError
                error={risks.error}
                onRetry={() => void risks.refetch()}
                resource="critical risks"
              />
            ) : (
              <CriticalRiskList risks={risks.data?.items ?? []} isPending={risks.isPending} />
            )}
          </CardContent>
        </Card>

        {brief.isPending ? (
          <Card className="h-full">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </CardContent>
          </Card>
        ) : (
          <DailyBriefPanel brief={brief.data ?? null} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Portfolio Health</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {kpis.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-3 w-full rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : (
              <GarBar
                green={k?.projects_green ?? 0}
                amber={k?.projects_amber ?? 0}
                red={k?.projects_red ?? 0}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 font-serif text-lg text-navy">
              <CalendarClock className="h-4 w-4 text-steel" />
              Upcoming Milestones
            </CardTitle>
            <ArrowLink href="/projects">All projects</ArrowLink>
          </CardHeader>
          <CardContent>
            {milestones.isPending ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (milestones.data?.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No upcoming milestones.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {milestones.data?.slice(0, 5).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy">
                        {m.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.project_name ?? "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDate(m.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
