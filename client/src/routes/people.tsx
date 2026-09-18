import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { formatDateTime } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getPeopleActivity } from "@/lib/api/people";

/**
 * Ported from `app/(dashboard)/people/page.tsx`.
 *
 * admin/exec only — this page had a real `requireRole()`, and the endpoint
 * enforces it, so a non-exec role gets a 403 that `<QueryError>` renders as
 * "Access denied" rather than an empty grid.
 *
 * Utilisation is computed server-side from the same minutes the CEO dashboard
 * KPI uses, so the two figures cannot drift apart.
 */
export function PeoplePage() {
  useDocumentTitle("People & Delivery");

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["people", "activity"],
    queryFn: getPeopleActivity,
  });

  const summary = data?.summary;
  const people = data?.people ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">People &amp; Delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Team activity as of {summary?.as_of_date ?? "—"}, sourced from LazyBoss ({data?.source ?? "csv"}).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="People Connected" value={summary?.people_connected ?? "—"} accent="teal" />
        <KpiCard label="Hours Today" value={summary?.hours_today ?? "—"} accent="steel" />
        <KpiCard label="Utilisation" value={summary?.utilisation_pct ?? "—"} unit="%" accent="status-green" />
        <KpiCard label="Screenshots Taken" value={summary?.screenshots_taken ?? "—"} accent="gold" />
      </div>

      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading team activity…</span>
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} className="rounded-2xl">
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && <QueryError error={error} onRetry={() => void refetch()} resource="team activity" />}

      {!isPending && !error && people.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No LazyBoss activity imported yet. Use{" "}
            <Link to="/admin/import/lazyboss-csv" className="text-steel underline">
              Import LazyBoss CSV
            </Link>{" "}
            to load a day of activity data.
          </CardContent>
        </Card>
      )}

      {!isPending && !error && people.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <Card key={p.person_name} className="rounded-2xl">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-serif text-base font-semibold text-navy">{p.person_name}</p>
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
                    <p className="text-navy">{p.hours_today}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">Screenshots</p>
                    <p className="text-navy">{p.screenshots_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">On project</p>
                    <p className="text-navy">{p.on_project_minutes}m</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel">Off project</p>
                    <p className="text-navy">{p.off_project_minutes}m</p>
                  </div>
                </div>
                <p className="pt-1 text-xs text-muted-foreground">
                  Last seen {formatDateTime(p.last_seen_at)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
