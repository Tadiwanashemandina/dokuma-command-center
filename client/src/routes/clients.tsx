import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { QueryError } from "@/components/query-states";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listClients } from "@/lib/api/risks";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

const TIER_STYLES: Record<string, string> = {
  strategic: "bg-gold/15 text-gold hover:bg-gold/15",
  key: "bg-steel/15 text-steel hover:bg-steel/15",
  standard: "bg-muted text-muted-foreground",
};

/**
 * Ported from `app/(dashboard)/clients/page.tsx`.
 *
 * Department-scoped like the risks register — see the note there. Linked
 * projects arrive nested per client, so the page no longer fetches every
 * project and filters in memory per card.
 */
export function ClientsPage() {
  useDocumentTitle("Clients & Stakeholders");

  const [offset, setOffset] = useState(0);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["clients", offset],
    queryFn: () => listClients({ limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  const clients = data?.items ?? [];
  const scope = data?.scope ?? null;
  const scopeLabel = scope === "finance" ? "Finance" : scope === "hr" ? "HR" : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Client &amp; Stakeholder Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scopeLabel
            ? `Clients relevant to ${scopeLabel}.`
            : "Projects, commitments and next deliverables by client."}
        </p>
      </div>

      {isPending && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading clients…</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="rounded-2xl">
              <CardHeader>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-2 h-4 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && <QueryError error={error} onRetry={() => void refetch()} resource="clients" />}

      {!isPending && !error && clients.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="py-8 text-center text-muted-foreground">
            No {scopeLabel ?? ""}-relevant clients on record.
          </CardContent>
        </Card>
      )}

      {!isPending && !error && clients.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <Card key={client.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="font-serif text-lg text-navy">{client.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{client.industry ?? "—"}</p>
                </div>
                {client.tier && (
                  <Badge className={`rounded-full border-0 capitalize ${TIER_STYLES[client.tier]}`}>
                    {client.tier}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Relationship owner: <span className="text-navy">{client.relationship_owner ?? "—"}</span>
                </p>
                {client.notes && <p className="text-sm text-muted-foreground">{client.notes}</p>}
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-steel">Projects</p>
                  {client.projects.length > 0 ? (
                    client.projects.map((p) => (
                      <div key={p.id} className="flex items-center justify-between">
                        <span className="text-sm text-navy">{p.name}</span>
                        <StatusBadge status={p.status} />
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No linked projects.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        total={data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="clients"
      />
    </div>
  );
}
