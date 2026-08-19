import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/kpi-card";
import { GarBar } from "@/components/gar-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatUsdCompact } from "@/lib/utils";

export default async function CompanyOverviewPage() {
  const supabase = await createClient();

  const [{ data: kpis }, { data: milestones }, { data: openItems }] = await Promise.all([
    supabase.from("v_ceo_dashboard_kpis").select("*").single(),
    supabase
      .from("milestones")
      .select("id, name, due_date, status, projects(name)")
      .neq("status", "done")
      .order("due_date", { ascending: true })
      .limit(6),
    supabase
      .from("risks_issues_decisions")
      .select("id, type, title, severity, due_date, projects(name)")
      .eq("status", "open")
      .order("due_date", { ascending: true })
      .limit(6),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Company Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Company-level revenue, pipeline, delivery health and executive exceptions.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenue Pipeline" value={formatUsdCompact(kpis?.revenue_pipeline_usd)} href="/finance" />
        <KpiCard label="Contracted Revenue" value={formatUsdCompact(kpis?.contracted_revenue_usd)} href="/finance" />
        <KpiCard label="Active Projects" value={kpis?.active_projects ?? "—"} href="/projects" />
        <KpiCard label="Team Utilisation" value={kpis?.team_utilisation_pct ?? "—"} unit="%" href="/people" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Upcoming Milestones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {milestones && milestones.length > 0 ? (
              milestones.map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-navy">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(m.projects as unknown as { name: string } | null)?.name ?? "—"}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatDate(m.due_date)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming milestones.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Open Risks, Issues &amp; Decisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openItems && openItems.length > 0 ? (
              openItems.map((item) => (
                <Link
                  key={item.id}
                  href="/risks"
                  className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-navy">{item.title}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {item.type} · {(item.projects as unknown as { name: string } | null)?.name ?? "Company-wide"}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatDate(item.due_date)}</span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No open items.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Portfolio Health</CardTitle>
        </CardHeader>
        <CardContent>
          <GarBar
            green={kpis?.projects_green ?? 0}
            amber={kpis?.projects_amber ?? 0}
            red={kpis?.projects_red ?? 0}
          />
        </CardContent>
      </Card>
    </div>
  );
}
