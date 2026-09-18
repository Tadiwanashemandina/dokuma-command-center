import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/kpi-card";
import { GarBar } from "@/components/gar-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getCeoDashboard, getUpcomingMilestones } from "@/lib/api/dashboard";
import { listRisks } from "@/lib/api/risks";

/**
 * Ported from `app/(dashboard)/company/page.tsx`.
 *
 * Shares the CEO dashboard's KPI endpoint — and its React Query cache key, so
 * navigating between CEO Home and here does not refetch the same figures.
 */
export function CompanyPage() {
  useDocumentTitle("Company Overview");

  const kpis = useQuery({ queryKey: ["dashboard", "ceo"], queryFn: getCeoDashboard });
  const milestones = useQuery({
    queryKey: ["dashboard", "upcoming-milestones"],
    queryFn: getUpcomingMilestones,
  });
  const openItems = useQuery({
    queryKey: ["risks", "open", 6],
    queryFn: () => listRisks({ limit: 6 }),
  });

  const k = kpis.data;
  const money = (v: string | null | undefined) =>
    kpis.isPending ? "…" : formatUsdCompact(v == null ? null : Number(v));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Company Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Company-level revenue, pipeline, delivery health and executive exceptions.
        </p>
      </div>

      {kpis.error && (
        <QueryError error={kpis.error} onRetry={() => void kpis.refetch()} resource="company KPIs" />
      )}

      {!kpis.error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Revenue Pipeline" value={money(k?.revenue_pipeline_usd)} href="/finance" />
          <KpiCard label="Contracted Revenue" value={money(k?.contracted_revenue_usd)} href="/finance" />
          <KpiCard
            label="Active Projects"
            value={kpis.isPending ? "…" : (k?.active_projects ?? "—")}
            href="/projects"
          />
          <KpiCard
            label="Team Utilisation"
            value={kpis.isPending ? "…" : (k?.team_utilisation_pct ?? "—")}
            unit="%"
            href="/people"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Upcoming Milestones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {milestones.isPending &&
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}

            {milestones.error && (
              <QueryError
                error={milestones.error}
                onRetry={() => void milestones.refetch()}
                resource="milestones"
              />
            )}

            {!milestones.isPending && !milestones.error && (milestones.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming milestones.</p>
            )}

            {milestones.data?.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-navy">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.project_name ?? "—"}</p>
                </div>
                <span className="text-sm text-muted-foreground">{formatDate(m.due_date)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Open Risks, Issues &amp; Decisions</CardTitle>
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
                className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-navy">{item.title}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {item.type} · {item.project_name ?? "Company-wide"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">{formatDate(item.due_date)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Portfolio Health</CardTitle>
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
    </div>
  );
}
