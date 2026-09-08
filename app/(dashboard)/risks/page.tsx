import { createClient, getProfile } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { redirect } from "next/navigation";
import { departmentScopeForRole } from "@/lib/department-scope";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-status-red/15 text-status-red hover:bg-status-red/15",
  high: "bg-gold/15 text-gold hover:bg-gold/15",
  medium: "bg-steel/15 text-steel hover:bg-steel/15",
  low: "bg-muted text-muted-foreground",
};

export default async function RisksPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const scope = departmentScopeForRole(profile.role);

  const supabase = await createClient();
  let query = supabase
    .from("risks_issues_decisions")
    .select("*, projects(name)")
    .order("status", { ascending: true })
    .order("due_date", { ascending: true });
  if (scope) query = query.eq("department", scope);
  const { data: items } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Risks, Issues &amp; Decisions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope
            ? `Register scoped to ${scope === "finance" ? "Finance" : "HR"}-relevant items.`
            : "Central register with owner, severity and due date, across every project."}
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
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
              {items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-xs font-medium text-navy">{item.title}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{item.type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(item.projects as unknown as { name: string } | null)?.name ?? "Company-wide"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.owner_name ?? "—"}</TableCell>
                  <TableCell>
                    {item.severity ? (
                      <Badge className={cn("rounded-full border-0 capitalize", SEVERITY_STYLES[item.severity])}>
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
              {(!items || items.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No {scope === "finance" ? "Finance" : scope === "hr" ? "HR" : ""}-relevant items on record.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
