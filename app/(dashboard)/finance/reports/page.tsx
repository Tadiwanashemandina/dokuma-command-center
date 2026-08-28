import Link from "next/link";
import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { generateDailyReportAction } from "./actions";

export default async function FinanceReportsPage() {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canCreate = ["admin", "finance_officer", "finance_manager"].includes(profile.role);

  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("finance_reports")
    .select("id, type, period_start, period_end, status, generated_at")
    .order("generated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">Daily, weekly and monthly reports.</p>
      </div>

      <FinanceSubNav />

      {canCreate && (
        <div className="flex flex-wrap gap-3">
          <form action={generateDailyReportAction}>
            <input type="hidden" name="date" value={new Date().toISOString().slice(0, 10)} />
            <Button type="submit" variant="outline">
              Generate Today&apos;s Report
            </Button>
          </form>
          <Button asChild variant="outline">
            <Link href="/finance/reports/weekly/new">New Weekly Report</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/finance/reports/monthly/new">New Monthly Report</Link>
          </Button>
        </div>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Generated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">
                    <Link href={`/finance/reports/${r.id}`} className="font-medium text-navy hover:underline">
                      {r.type}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.period_start)} — {formatDate(r.period_end)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        r.status === "published"
                          ? "rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15"
                          : "rounded-full border-0 bg-gold/15 text-gold hover:bg-gold/15"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.generated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
