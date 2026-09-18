import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState, QueryError, TableSkeleton } from "@/components/query-states";
import { formatDate } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listDeliveryMetrics } from "@/lib/api/delivery";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

/**
 * Ported from `app/(dashboard)/delivery/page.tsx`.
 *
 * The three headline figures now come from the server, computed over a real
 * trailing-7-day window. The legacy page summed whichever rows it had fetched,
 * so "Commits (last 7 days)" actually described the last 30 ROWS — a different
 * number as soon as more than one repo reports.
 */
export function DeliveryPage() {
  useDocumentTitle("Software Delivery");

  const [offset, setOffset] = useState(0);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["delivery-metrics", offset],
    queryFn: () => listDeliveryMetrics({ limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  const metrics = data?.items ?? [];
  const totals = data?.totals;

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
        <KpiCard label="Commits (last 7 days)" value={totals?.commits ?? "—"} />
        <KpiCard label="Deploys (last 7 days)" value={totals?.deploys ?? "—"} />
        <KpiCard label="Open Defects" value={totals?.open_defects ?? "—"} accent="status-red" />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isPending && <TableSkeleton columns={7} />}

          {error && (
            <div className="p-4">
              <QueryError error={error} onRetry={() => void refetch()} resource="delivery metrics" />
            </div>
          )}

          {!isPending && !error && metrics.length === 0 && (
            <EmptyState
              message="No delivery metrics yet"
              hint="Metrics appear once a repository starts reporting."
            />
          )}

          {!isPending && !error && metrics.length > 0 && (
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
                {metrics.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs text-navy">{m.repo_name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.project_name ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.commits_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.deploys_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.open_defects_count}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(m.metric_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {m.source}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        total={data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="metric rows"
      />
    </div>
  );
}
