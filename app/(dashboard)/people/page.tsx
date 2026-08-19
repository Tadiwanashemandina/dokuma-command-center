import { requireRole } from "@/lib/supabase/server";
import { getLazyBossAdapter } from "@/lib/datasources/lazyboss";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export default async function PeopleAndDeliveryPage() {
  await requireRole(["admin", "exec"]);
  const adapter = getLazyBossAdapter();
  const [summary, people] = await Promise.all([adapter.getTeamSummary(), adapter.listPeopleActivity()]);

  const utilisationPct =
    summary.onProjectMinutes + summary.offProjectMinutes > 0
      ? Math.round((summary.onProjectMinutes / (summary.onProjectMinutes + summary.offProjectMinutes)) * 1000) / 10
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">People &amp; Delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Team activity as of {summary.asOfDate ?? "—"}, sourced from LazyBoss ({process.env.LAZYBOSS_SOURCE ?? "csv"}).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="People Connected" value={summary.peopleConnected} />
        <KpiCard label="Hours Today" value={summary.hoursToday} />
        <KpiCard label="Utilisation" value={utilisationPct ?? "—"} unit="%" />
        <KpiCard label="Screenshots Taken" value={summary.screenshotsTaken} />
      </div>

      {people.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No LazyBoss activity imported yet. Use{" "}
            <a href="/admin/import/lazyboss-csv" className="text-steel underline">
              Import LazyBoss CSV
            </a>{" "}
            to load a day of activity data.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <Card key={p.personName} className="rounded-2xl">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-serif text-base font-semibold text-navy">{p.personName}</p>
                  <Badge
                    className={
                      p.status === "online"
                        ? "rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15"
                        : "rounded-full border-0 bg-muted text-muted-foreground"
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {p.role ?? "—"} · {p.department ?? "—"}
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2 text-sm">
                  <div>
                    <p className="text-xs text-steel">Hours today</p>
                    <p className="text-navy">{p.hoursToday}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">Screenshots</p>
                    <p className="text-navy">{p.screenshotsCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">On project</p>
                    <p className="text-navy">{p.onProjectMinutes}m</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">Off project</p>
                    <p className="text-navy">{p.offProjectMinutes}m</p>
                  </div>
                </div>
                <p className="pt-1 text-xs text-muted-foreground">Last seen {formatDateTime(p.lastSeenAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
