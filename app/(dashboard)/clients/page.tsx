import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import type { ProjectStatus } from "@/types/database.types";

const TIER_STYLES: Record<string, string> = {
  strategic: "bg-gold/15 text-gold hover:bg-gold/15",
  key: "bg-steel/15 text-steel hover:bg-steel/15",
  standard: "bg-muted text-muted-foreground",
};

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("*").order("tier").order("name");
  const { data: projects } = await supabase.from("projects").select("id, name, status, client_id");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Client &amp; Stakeholder Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Projects, commitments and next deliverables by client.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {clients?.map((client) => {
          const clientProjects = projects?.filter((p) => p.client_id === client.id) ?? [];
          return (
            <Card key={client.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="font-serif text-lg text-navy">{client.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{client.industry ?? "—"}</p>
                </div>
                {client.tier && (
                  <Badge className={`rounded-full border-0 capitalize ${TIER_STYLES[client.tier]}`}>{client.tier}</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Relationship owner: <span className="text-navy">{client.relationship_owner ?? "—"}</span>
                </p>
                {client.notes && <p className="text-sm text-muted-foreground">{client.notes}</p>}
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-steel">Projects</p>
                  {clientProjects.length > 0 ? (
                    clientProjects.map((p) => (
                      <div key={p.id} className="flex items-center justify-between">
                        <span className="text-sm text-navy">{p.name}</span>
                        <StatusBadge status={p.status as ProjectStatus} />
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No linked projects.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
