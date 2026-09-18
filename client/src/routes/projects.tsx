import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, QueryError, TableSkeleton } from "@/components/query-states";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listProjects } from "@/lib/api/projects";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

/**
 * Ported from `app/(dashboard)/projects/page.tsx`.
 *
 * The markup and classes are unchanged. What differs is where the data comes
 * from: an async server component became a query, which brings the loading,
 * error and empty states a server render never needed.
 */
export function ProjectsPage() {
  useDocumentTitle("Project Portfolio");

  const [offset, setOffset] = useState(0);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["projects", "list", offset],
    queryFn: () => listProjects({ limit: PAGE_SIZE, offset }),
    // Keeps the previous page on screen while the next one loads, so the
    // table does not collapse to a skeleton on every page change.
    placeholderData: (previous) => previous,
  });

  const projects = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Project Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every active project — status, owner, budget and next milestone date.
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isPending && <TableSkeleton columns={6} />}

          {error && (
            <div className="p-4">
              <QueryError error={error} onRetry={() => void refetch()} resource="projects" />
            </div>
          )}

          {!isPending && !error && projects.length === 0 && (
            <EmptyState message="No projects yet" hint="Projects appear here once they are created." />
          )}

          {!isPending && !error && projects.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead>Target End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-navy">
                      <Link to={`/projects/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    {/* Resolved server-side. The Supabase shim dropped this
                        join, so it renders "—" in the legacy app today. */}
                    <TableCell className="text-muted-foreground">{p.client_name ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.owner_name ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {/* budget_usd is an exact decimal string; parsed only
                          here, at the point of display. */}
                      {formatUsdCompact(p.budget_usd === null ? null : Number(p.budget_usd))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(p.target_end_date)}</TableCell>
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
        label="projects"
      />
    </div>
  );
}
