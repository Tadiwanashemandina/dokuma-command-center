import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/kpi-card";
import { formatDate } from "@/lib/utils";

export default async function DeliveryIntelligencePage() {
  const supabase = await createClient();
  const { data: metrics } = await supabase
    .from("delivery_metrics")
    .select("*, projects(name)")
    .order("metric_date", { ascending: false })
    .limit(30);

  const totals = (metrics ?? []).reduce(
    (acc, m) => ({
      commits: acc.commits + m.commits_count,
      deploys: acc.deploys + m.deploys_count,
      openDefects: acc.openDefects + m.open_defects_count,
    }),
    { commits: 0, deploys: 0, openDefects: 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Software Delivery Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Repo activity, deploys and defect counts across active engineering projects (illustrative until a real
          GitHub/GitLab integration is wired up).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Commits (last 7 days)" value={totals.commits} />
        <KpiCard label="Deploys (last 7 days)" value={totals.deploys} />
        <KpiCard label="Open Defects" value={totals.openDefects} />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repo</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Deploys</TableHead>
                <TableHead className="text-right">Open Defects</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs text-navy">{m.repo_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(m.projects as unknown as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{m.commits_count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{m.deploys_count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{m.open_defects_count}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(m.metric_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{m.source}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
