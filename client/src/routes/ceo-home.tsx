import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { GarBar } from "@/components/gar-bar";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import { ArrowLink } from "@/components/arrow-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getCeoDashboard, getDailyBrief } from "@/lib/api/dashboard";

/**
 * Ported from `app/(dashboard)/page.tsx`.
 *
 * The role gate that the page applied itself — pass every role to
 * `requireRole()`, then redirect anyone who is not admin/exec — is now the
 * `<RequireRole roles={EXEC_ONLY}>` boundary in the route tree, with the
 * endpoint enforcing the same rule server-side.
 *
 * KPIs and the brief are two queries rather than one: the brief is a
 * standalone panel, so a slow or missing brief should not hold up nine KPI
 * cards that are already available.
 */
export function CeoHomePage() {
  useDocumentTitle("CEO Home");

  const kpis = useQuery({
    queryKey: ["dashboard", "ceo"],
    queryFn: getCeoDashboard,
  });

  const brief = useQuery({
    queryKey: ["dashboard", "brief"],
    queryFn: getDailyBrief,
  });

  const k = kpis.data;

  /** A KPI value, or a skeleton while loading, or an em dash on failure. */
  const value = (v: number | string | null | undefined): string | number => {
    if (kpis.isPending) return "…";
    return v ?? "—";
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-8">
      <div className="flex flex-col justify-between gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-steel">
            <Activity className="h-3.5 w-3.5" /> Executive overview
          </div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-navy">CEO Home Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            A live portfolio-level view of projects, finance, people and risk across Dokuma.
          </p>
        </div>
        <ArrowLink href="/projects">View project portfolio</ArrowLink>
      </div>

      {kpis.error && (
        <QueryError
          error={kpis.error}
          onRetry={() => void kpis.refetch()}
          resource="the executive dashboard"
        />
      )}

      {!kpis.error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Active Projects" value={value(k?.active_projects)} href="/projects" accent="teal" />
          <KpiCard label="Tasks Due This Week" value={value(k?.tasks_due_this_week)} href="/projects" accent="steel" />
          <KpiCard label="Overdue Tasks" value={value(k?.overdue_tasks)} href="/projects" accent="gold" />
          <KpiCard label="Critical Blockers" value={value(k?.critical_blockers)} href="/risks" accent="status-red" />
          <KpiCard
            label="Revenue Pipeline"
            value={kpis.isPending ? "…" : formatUsdCompact(k?.revenue_pipeline_usd == null ? null : Number(k.revenue_pipeline_usd))}
            href="/finance"
            accent="teal"
          />
          <KpiCard
            label="Contracted Revenue"
            value={kpis.isPending ? "…" : formatUsdCompact(k?.contracted_revenue_usd == null ? null : Number(k.contracted_revenue_usd))}
            href="/finance"
            accent="steel"
          />
          <KpiCard
            label="Outstanding Receivables"
            value={kpis.isPending ? "…" : formatUsdCompact(k?.outstanding_receivables_usd == null ? null : Number(k.outstanding_receivables_usd))}
            href="/finance"
            accent="gold"
          />
          <KpiCard
            label="Team Utilisation"
            value={value(k?.team_utilisation_pct)}
            unit="%"
            href="/people"
            accent="status-green"
          />
          <KpiCard label="High-Risk Projects" value={value(k?.high_risk_projects)} href="/risks" accent="status-red" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Projects — Green / Amber / Red</CardTitle>
          </CardHeader>
          <CardContent>
            {kpis.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full rounded-full" />
                <Skeleton className="h-4 w-48" />
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

        {brief.isPending ? (
          <Card className="rounded-2xl border-teal/30 bg-gradient-to-br from-navy to-navy/90">
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-40 bg-white/10" />
              <Skeleton className="h-4 w-full bg-white/10" />
              <Skeleton className="h-4 w-5/6 bg-white/10" />
            </CardContent>
          </Card>
        ) : (
          <DailyBriefPanel brief={brief.data ?? null} />
        )}
      </div>
    </div>
  );
}
