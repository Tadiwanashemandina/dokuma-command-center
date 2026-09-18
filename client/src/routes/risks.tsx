import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError, TableSkeleton } from "@/components/query-states";
import { cn, formatDate } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listRisks } from "@/lib/api/risks";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-status-red/15 text-status-red hover:bg-status-red/15",
  high: "bg-gold/15 text-gold hover:bg-gold/15",
  medium: "bg-steel/15 text-steel hover:bg-steel/15",
  low: "bg-muted text-muted-foreground",
};

/**
 * Ported from `app/(dashboard)/risks/page.tsx`.
 *
 * Department scoping is applied server-side and the caller's scope is echoed
 * back, so this page reads it from the response rather than recomputing
 * `departmentScopeForRole(role)` in the browser. That matters beyond tidiness:
 * a client-side copy of an authorization rule can drift from the one the
 * server enforces, and the copy is the one users would see.
 *
 * An empty result for an HR-scoped role is CORRECT, not a failure — no rows
 * are tagged 'hr' in the seed, and there is deliberately no fallback to
 * untagged rows (ONBOARDING §7).
 */
export function RisksPage() {
  useDocumentTitle("Risks, Issues & Decisions");

  const [offset, setOffset] = useState(0);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["risks", offset],
    queryFn: () => listRisks({ limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  const items = data?.items ?? [];
  const scope = data?.scope ?? null;
  const scopeLabel = scope === "finance" ? "Finance" : scope === "hr" ? "HR" : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Risks, Issues &amp; Decisions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scopeLabel
            ? `Register scoped to ${scopeLabel}-relevant items.`
            : "Central register with owner, severity and due date, across every project."}
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isPending && <TableSkeleton columns={7} />}

          {error && (
            <div className="p-4">
              <QueryError error={error} onRetry={() => void refetch()} resource="the register" />
            </div>
          )}

          {!isPending && !error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-xs font-medium text-navy">{item.title}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{item.type}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.project_name ?? "Company-wide"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.owner_name ?? "—"}</TableCell>
                    <TableCell>
                      {item.severity ? (
                        <Badge
                          className={cn("rounded-full border-0 capitalize", SEVERITY_STYLES[item.severity])}
                        >
                          {item.severity}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{item.status}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(item.due_date)}</TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No {scopeLabel ?? ""}-relevant items on record.
                    </TableCell>
                  </TableRow>
                )}
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
        label="items"
      />
    </div>
  );
}
