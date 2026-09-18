import { redirect } from "next/navigation";
import { createClient, requireRole } from "@/lib/supabase/server";
import { KpiCard } from "@/components/kpi-card";
import { GarBar } from "@/components/gar-bar";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsdCompact } from "@/lib/utils";
import { roleHomePath } from "@/lib/role-home";
import { Activity } from "lucide-react";
import { ArrowLink } from "@/components/arrow-link";

export default async function CeoHomePage() {
  const profile = await requireRole([
    "admin",
    "exec",
    "finance_officer",
    "finance_manager",
    "employee",
    "supervisor",
    "hr_officer",
    "hr_manager",
    "viewer",
  ]);
  if (profile.role !== "admin" && profile.role !== "exec") {
    redirect(roleHomePath(profile.role));
  }

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Projects" value={kpis?.active_projects ?? "—"} href="/projects" accent="teal" />
        <KpiCard label="Tasks Due This Week" value={kpis?.tasks_due_this_week ?? "—"} href="/projects" accent="steel" />
        <KpiCard label="Overdue Tasks" value={kpis?.overdue_tasks ?? "—"} href="/projects" accent="gold" />
        <KpiCard label="Critical Blockers" value={kpis?.critical_blockers ?? "—"} href="/risks" accent="status-red" />
        <KpiCard label="Revenue Pipeline" value={formatUsdCompact(kpis?.revenue_pipeline_usd)} href="/finance" accent="teal" />
        <KpiCard label="Contracted Revenue" value={formatUsdCompact(kpis?.contracted_revenue_usd)} href="/finance" accent="steel" />
        <KpiCard
          label="Outstanding Receivables"
          value={formatUsdCompact(kpis?.outstanding_receivables_usd)}
          href="/finance"
          accent="gold"
        />
        <KpiCard label="Team Utilisation" value={kpis?.team_utilisation_pct ?? "—"} unit="%" href="/people" accent="status-green" />
        <KpiCard label="High-Risk Projects" value={kpis?.high_risk_projects ?? "—"} href="/risks" accent="status-red" />
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
