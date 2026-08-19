import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import type { ProjectStatus } from "@/types/database.types";

export default async function ProjectPortfolioPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, owner_name, budget_usd, target_end_date, clients(name)")
    .order("status", { ascending: true })
    .order("name", { ascending: true });

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
              {projects?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-navy">
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(p.clients as unknown as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status as ProjectStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.owner_name ?? "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatUsdCompact(p.budget_usd)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.target_end_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
