import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/kpi-card";
import { GarBar } from "@/components/gar-bar";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsdCompact } from "@/lib/utils";

export default async function CeoHomePage() {
  const supabase = await createClient();

  const [{ data: kpis }, { data: brief }] = await Promise.all([
    supabase.from("v_ceo_dashboard_kpis").select("*").single(),
    supabase
      .from("ai_daily_briefs")
      .select("headline, body, brief_date")
      .order("brief_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">CEO Home Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A live portfolio-level view of projects, finance, people and risk across Dokuma.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Projects" value={kpis?.active_projects ?? "—"} href="/projects" />
        <KpiCard label="Tasks Due This Week" value={kpis?.tasks_due_this_week ?? "—"} href="/projects" />
        <KpiCard label="Overdue Tasks" value={kpis?.overdue_tasks ?? "—"} href="/projects" />
        <KpiCard label="Critical Blockers" value={kpis?.critical_blockers ?? "—"} href="/risks" />
        <KpiCard label="Revenue Pipeline" value={formatUsdCompact(kpis?.revenue_pipeline_usd)} href="/finance" />
        <KpiCard label="Contracted Revenue" value={formatUsdCompact(kpis?.contracted_revenue_usd)} href="/finance" />
        <KpiCard
          label="Outstanding Receivables"
          value={formatUsdCompact(kpis?.outstanding_receivables_usd)}
          href="/finance"
        />
        <KpiCard label="Team Utilisation" value={kpis?.team_utilisation_pct ?? "—"} unit="%" href="/people" />
        <KpiCard label="High-Risk Projects" value={kpis?.high_risk_projects ?? "—"} href="/risks" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Projects — Green / Amber / Red</CardTitle>
          </CardHeader>
          <CardContent>
            <GarBar
              green={kpis?.projects_green ?? 0}
              amber={kpis?.projects_amber ?? 0}
              red={kpis?.projects_red ?? 0}
            />
          </CardContent>
        </Card>

        <DailyBriefPanel brief={brief ?? null} />
      </div>
    </div>
  );
}
