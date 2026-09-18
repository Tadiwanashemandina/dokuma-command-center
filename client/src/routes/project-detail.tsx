import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { NotFoundPage } from "@/routes/not-found";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiRequestError } from "@/lib/api-client";
import { getProject } from "@/lib/api/projects";

/**
 * Ported from `app/(dashboard)/projects/[id]/page.tsx`.
 *
 * The page's four parallel Supabase queries became one aggregated endpoint:
 * the browser makes a single request and cannot render a half-loaded project.
 * `notFound()` becomes a 404 from the API, which this renders as the shared
 * not-found page.
 */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["projects", "detail", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
    // A 404 is a definitive answer, not a transient failure worth retrying.
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 1,
  });

  useDocumentTitle(data?.project.name ?? "Project");

  // The API's 404 is this route's not-found state.
  if (error instanceof ApiRequestError && error.status === 404) {
    return <NotFoundPage />;
  }

  if (isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading project…</span>
        <Skeleton className="h-9 w-80" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return <QueryError error={error} onRetry={() => void refetch()} resource="this project" />;
  }

  const { project, milestones, tasks, risks } = data;
  const openRisks = risks.filter((r) => r.status !== "closed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.client_name ?? "Internal"} · Owner: {project.owner_name ?? "—"}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Budget</p>
            <p className="font-serif text-xl text-navy">
              {formatUsdCompact(project.budget_usd === null ? null : Number(project.budget_usd))}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Start</p>
            <p className="font-serif text-xl text-navy">{formatDate(project.start_date)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Target End</p>
            <p className="font-serif text-xl text-navy">{formatDate(project.target_end_date)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Open Risks/Issues</p>
            <p className="font-serif text-xl text-navy">{openRisks}</p>
          </CardContent>
        </Card>
      </div>

      {project.description && (
        <Card className="rounded-2xl">
          <CardContent className="p-4 text-sm text-muted-foreground">{project.description}</CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {milestones.length > 0 ? (
            milestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
              >
                <span className="text-sm text-navy">{m.name}</span>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="capitalize">
                    {m.status.replace("_", " ")}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{formatDate(m.due_date)}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No milestones recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-navy">{t.title}</TableCell>
                    <TableCell className="text-muted-foreground">{t.assignee_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {t.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(t.due_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No tasks on this project.</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Risks, Issues &amp; Decisions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {risks.length > 0 ? (
            risks.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
              >
                <div>
                  <p className="text-sm text-navy">{r.title}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {r.type} · {r.severity ?? "—"}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize">
                  {r.status}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nothing logged for this project.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
