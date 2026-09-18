import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarClock, ShieldAlert } from "lucide-react";
import { CommandDeck, type DeckFigure } from "@/components/command-deck";
import { type AttentionItem } from "@/components/attention-banner";
import { DataFreshness } from "@/components/data-freshness";
import { ArrowLink } from "@/components/arrow-link";
import {
  ChartFrame,
  ChartTable,
  ChartEmpty,
} from "@/components/charts/chart-frame";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { PortfolioDonut } from "@/components/charts/portfolio-donut";
import {
  DeliveryLoadChart,
  UtilisationMeter,
  type LoadRow,
} from "@/components/charts/delivery-load-chart";
import { MilestoneTimeline } from "@/components/charts/milestone-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  getCeoDashboard,
  getKpiHistory,
  getUpcomingMilestones,
} from "@/lib/api/dashboard";
import { listRisks } from "@/lib/api/risks";
import { seriesByMetric, trendProps } from "@/lib/kpi-trend";

/**
 * Company Overview.
 *
 * Ported from `app/(dashboard)/company/page.tsx`, then given the charts the
 * numbers always implied. The port showed four KPI cards, two lists and one
 * stacked bar — every figure a point value with no history behind it, even
 * though `/dashboard/kpi-history` was already serving 30 days of it to CEO Home.
 *
 * The page now reads in the same three beats as CEO Home (what needs me / how
 * is the business / what specifically is wrong), so the two exec pages are one
 * product rather than two designs. Where CEO Home answers "what is true right
 * now", this page answers "and how did it get there" — which is what the charts
 * are for and why the history query leads rather than decorates.
 *
 * Queries stay separate so a slow panel degrades alone, and `["dashboard",
 * "ceo"]` is deliberately the same cache key CEO Home uses: navigating between
 * the two pages must not refetch identical figures.
 */
export function CompanyPage() {
  useDocumentTitle("Company Overview");

  const kpis = useQuery({ queryKey: ["dashboard", "ceo"], queryFn: getCeoDashboard });

  // History changes once a day, so it is cached hard and never blocks a figure.
  const history = useQuery({
    queryKey: ["dashboard", "kpi-history"],
    queryFn: getKpiHistory,
    staleTime: 5 * 60_000,
  });

  const milestones = useQuery({
    queryKey: ["dashboard", "upcoming-milestones"],
    queryFn: getUpcomingMilestones,
  });

  const openItems = useQuery({
    queryKey: ["risks", "open", 6],
    queryFn: () => listRisks({ limit: 6 }),
  });

  const k = kpis.data;
  const series = seriesByMetric(history.data);

  const usd = (v: string | null | undefined): string =>
    kpis.isPending ? "…" : formatUsdCompact(v == null ? null : Number(v));

  // --- Revenue trend ------------------------------------------------------
  // Pipeline and contracted revenue are both USD, so they share one axis
  // legitimately and the gap between them is a real, readable quantity.
  const pipeline = series.get("revenue_pipeline_usd");
  const contracted = series.get("contracted_revenue_usd");

  // The two series are aligned on a union of their dates rather than zipped by
  // index: if the cron missed a day for one metric, zipping would silently
  // shift that series against the other and draw a lie.
  const revenueDates = Array.from(
    new Set([
      ...(pipeline?.points.map((p) => p.as_of_date) ?? []),
      ...(contracted?.points.map((p) => p.as_of_date) ?? []),
    ]),
  )
    .filter(Boolean)
    .sort();

  const valueOn = (s: typeof pipeline, date: string) =>
    s?.points.find((p) => p.as_of_date === date)?.value ?? null;

  const revenueSeries = [
    {
      label: "Pipeline",
      colour: "var(--color-series-1)",
      values: revenueDates.map((d) => valueOn(pipeline, d)),
    },
    {
      label: "Contracted",
      colour: "var(--color-series-2)",
      values: revenueDates.map((d) => valueOn(contracted, d)),
    },
  ];

  const hasRevenueTrend = revenueDates.length >= 2;

  // --- Delivery load ------------------------------------------------------
  const loadRows: LoadRow[] = [
    { label: "Tasks due this week", value: k?.tasks_due_this_week ?? 0 },
    {
      label: "Overdue tasks",
      value: k?.overdue_tasks ?? 0,
      tone: (k?.overdue_tasks ?? 0) > 0 ? "critical" : "neutral",
    },
    {
      label: "Critical blockers",
      value: k?.critical_blockers ?? 0,
      tone: (k?.critical_blockers ?? 0) > 0 ? "critical" : "neutral",
    },
    {
      label: "High-risk projects",
      value: k?.high_risk_projects ?? 0,
      tone: (k?.high_risk_projects ?? 0) > 0 ? "warning" : "neutral",
    },
  ];

  /**
   * The same triage rule as CEO Home: only genuinely actionable states appear.
   * Work being scheduled is normal, so "tasks due this week" is not an alert —
   * listing it would teach the reader to ignore the banner.
   */
  const attention: AttentionItem[] = [
    { label: "critical blockers", count: k?.critical_blockers ?? 0, href: "/risks", tone: "critical" },
    { label: "high-risk projects", count: k?.high_risk_projects ?? 0, href: "/risks", tone: "critical" },
    { label: "overdue tasks", count: k?.overdue_tasks ?? 0, href: "/projects", tone: "warning" },
  ];

  const figures: DeckFigure[] = [
    {
      label: "Revenue Pipeline",
      value: usd(k?.revenue_pipeline_usd),
      href: "/finance",
      primary: true,
      ...trendProps(pipeline),
    },
    {
      label: "Contracted Revenue",
      value: usd(k?.contracted_revenue_usd),
      href: "/finance",
      ...trendProps(contracted),
    },
    {
      label: "Outstanding Receivables",
      value: usd(k?.outstanding_receivables_usd),
      href: "/finance",
      ...trendProps(series.get("outstanding_receivables_usd"), "down"),
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <CommandDeck
        eyebrow={
          <>
            <Building2 className="h-3.5 w-3.5" /> Company overview
          </>
        }
        title="Company Overview"
        /* The eyebrow already names the section and the figures below carry
           the detail, so the heading stays for the outline only. */
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
              void milestones.refetch();
              void openItems.refetch();
            }}
          />
        }
      />

      {kpis.error && (
        <QueryError
          error={kpis.error}
          onRetry={() => void kpis.refetch()}
          resource="company KPIs"
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Revenue over time — the page's lead chart                           */}
      {/* ------------------------------------------------------------------ */}
      <ChartFrame
        title="Revenue Trend"
        subtitle="Pipeline against contracted revenue, last 30 days"
        series={[
          { label: "Pipeline", colour: "var(--color-series-1)" },
          { label: "Contracted", colour: "var(--color-series-2)" },
        ]}
        table={
          hasRevenueTrend ? (
            <ChartTable
              caption="Pipeline and contracted revenue by date"
              columns={["Date", "Pipeline", "Contracted"]}
              rows={revenueDates.map((d, i) => [
                formatDate(d),
                formatUsdCompact(revenueSeries[0]?.values[i] ?? null),
                formatUsdCompact(revenueSeries[1]?.values[i] ?? null),
              ])}
            />
          ) : undefined
        }
      >
        {history.isPending ? (
          <Skeleton className="h-[220px] w-full" />
        ) : history.error ? (
          <QueryError
            error={history.error}
            onRetry={() => void history.refetch()}
            resource="revenue history"
          />
        ) : hasRevenueTrend ? (
          <RevenueTrendChart dates={revenueDates} series={revenueSeries} />
        ) : (
          // Fewer than two snapshots is not a flat line — it is no trend at
          // all, and saying so is the honest render. Same rule as `Sparkline`.
          <ChartEmpty>
            Collecting trend — the daily snapshot needs to run at least twice
            before a revenue line can be drawn.
          </ChartEmpty>
        )}
      </ChartFrame>

      {/* ------------------------------------------------------------------ */}
      {/* Portfolio health + delivery load                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartFrame
          title="Portfolio Health"
          subtitle="Active projects by delivery status"
          table={
            <ChartTable
              caption="Project count by status"
              columns={["Status", "Projects"]}
              rows={[
                ["Green — on track", k?.projects_green ?? 0],
                ["Amber — needs attention", k?.projects_amber ?? 0],
                ["Red — at risk", k?.projects_red ?? 0],
              ]}
            />
          }
        >
          {kpis.isPending ? (
            <div className="flex items-center gap-6">
              <Skeleton className="h-[132px] w-[132px] rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ) : (
            <PortfolioDonut
              green={k?.projects_green ?? 0}
              amber={k?.projects_amber ?? 0}
              red={k?.projects_red ?? 0}
            />
          )}
        </ChartFrame>

        <ChartFrame
          title="Delivery Load"
          subtitle="Open work and exceptions across the portfolio"
          table={
            <ChartTable
              caption="Delivery load by measure"
              columns={["Measure", "Count"]}
              rows={loadRows.map((r) => [r.label, r.value])}
            />
          }
        >
          {kpis.isPending ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              <DeliveryLoadChart rows={loadRows} />
              {/* Utilisation is a ratio against a limit, not a count — so it
                  gets a meter below the bars rather than a fifth bar on a
                  scale it does not belong to. */}
              <div className="border-t border-border pt-4">
                <UtilisationMeter
                  pct={
                    k?.team_utilisation_pct == null
                      ? null
                      : Number(k.team_utilisation_pct)
                  }
                />
              </div>
            </div>
          )}
        </ChartFrame>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Milestones on a shared time axis                                    */}
      {/* ------------------------------------------------------------------ */}
      <ChartFrame
        title="Upcoming Milestones"
        subtitle="Positioned by due date, so clustering is visible"
        action={<ArrowLink href="/projects">All projects</ArrowLink>}
        table={
          <ChartTable
            caption="Upcoming milestones by due date"
            columns={["Milestone", "Project", "Due"]}
            rows={(milestones.data ?? []).map((m) => [
              m.name,
              m.project_name ?? "Company-wide",
              formatDate(m.due_date),
            ])}
          />
        }
      >
        {milestones.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : milestones.error ? (
          <QueryError
            error={milestones.error}
            onRetry={() => void milestones.refetch()}
            resource="milestones"
          />
        ) : (milestones.data?.length ?? 0) === 0 ? (
          <ChartEmpty>No upcoming milestones.</ChartEmpty>
        ) : (
          <MilestoneTimeline milestones={milestones.data ?? []} />
        )}
      </ChartFrame>

      {/* ------------------------------------------------------------------ */}
      {/* Open exceptions — a list, because a list is the right form          */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 font-serif text-lg text-navy">
            <ShieldAlert className="h-4 w-4 text-status-amber" />
            Open Risks, Issues &amp; Decisions
          </CardTitle>
          <ArrowLink href="/risks">All risks</ArrowLink>
        </CardHeader>
        <CardContent className="space-y-3">
          {openItems.isPending &&
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}

          {openItems.error && (
            <QueryError
              error={openItems.error}
              onRetry={() => void openItems.refetch()}
              resource="open items"
            />
          )}

          {!openItems.isPending && !openItems.error && (openItems.data?.items.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No open items.</p>
          )}

          {openItems.data?.items.map((item) => (
            <Link
              key={item.id}
              to="/risks"
              className="flex items-center justify-between gap-3 rounded-md border-b border-border/60 px-1 py-2 last:border-0 hover:bg-muted"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy">{item.title}</p>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {item.type} · {item.project_name ?? "Company-wide"}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                {formatDate(item.due_date)}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
