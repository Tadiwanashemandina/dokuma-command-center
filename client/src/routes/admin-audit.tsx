import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, QueryError, TableSkeleton } from "@/components/query-states";
import { formatDateTime } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listAuditActions, queryAuditLog } from "@/lib/api/admin";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

/**
 * The audit trail — readable by admin, exec and finance_manager.
 *
 * Newest first, because this is read backwards from an incident. Each row
 * shows who, what, when and from where; the metadata column carries the
 * action-specific detail (a role change records both the old and new role, so
 * a reviewer can tell an escalation from a demotion).
 */
export function AdminAuditPage() {
  useDocumentTitle("Audit Trail");

  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const actions = useQuery({ queryKey: ["admin", "audit-actions"], queryFn: listAuditActions });

  const log = useQuery({
    queryKey: ["admin", "audit-log", action, offset],
    queryFn: () => queryAuditLog({ action: action || undefined, limit: PAGE_SIZE, offset }),
  });

  const rows = log.data?.items ?? [];
  const total = log.data?.total ?? 0;

  /** Colours the noisy security-relevant actions so they stand out in a scan. */
  const toneFor = (a: string) => {
    if (a.includes("failed") || a.includes("locked") || a.includes("rate_limited") || a.includes("disabled")) {
      return "bg-status-red/15 text-status-red hover:bg-status-red/15";
    }
    if (a.startsWith("admin.") || a.includes("role_changed") || a.includes("reset")) {
      return "bg-gold/15 text-gold hover:bg-gold/15";
    }
    return "bg-steel/15 text-steel hover:bg-steel/15";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Audit Trail</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every authentication event and administrative change, newest first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {actions.data?.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {log.isPending && <TableSkeleton columns={5} />}

          {log.error && (
            <div className="p-4">
              <QueryError error={log.error} onRetry={() => void log.refetch()} resource="the audit trail" />
            </div>
          )}

          {!log.isPending && !log.error && rows.length === 0 && (
            <EmptyState
              message="No audit entries"
              hint={action ? "No events match that action." : "Events appear here as people use the system."}
            />
          )}

          {!log.isPending && !log.error && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>From</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  // A keyed Fragment: this maps one row to two <tr>s (the row
                  // and its expanded detail), and a bare <> cannot carry the
                  // key React needs to tell them apart across renders.
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge className={`rounded-full border-0 font-mono text-[11px] ${toneFor(row.action)}`}>
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-navy">
                        {row.actor_email ?? <span className="text-muted-foreground">system</span>}
                        {row.actor_role && (
                          <span className="ml-2 text-xs text-muted-foreground">{row.actor_role}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.ip ?? "—"}
                      </TableCell>
                    </TableRow>

                    {expanded === row.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                            <dt className="text-muted-foreground">Entity id</dt>
                            <dd className="font-mono text-navy">{row.entity_id ?? "—"}</dd>
                            <dt className="text-muted-foreground">User agent</dt>
                            <dd className="break-all text-navy">{row.user_agent ?? "—"}</dd>
                            <dt className="text-muted-foreground">Detail</dt>
                            <dd className="break-all font-mono text-navy">
                              {row.metadata && Object.keys(row.metadata).length > 0
                                ? JSON.stringify(row.metadata)
                                : "—"}
                            </dd>
                          </dl>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="entries"
      />

    </div>
  );
}
