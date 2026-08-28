import { requireRole, createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { CashPositionPanel } from "@/components/finance/cash-position-panel";
import { getCashPosition } from "@/lib/finance/balances";

export default async function FinancePage() {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canWrite = ["admin", "finance_officer", "finance_manager"].includes(profile.role);
  const supabase = await createClient();

  const [{ data: totals }, { data: projectFinance }, cashPosition] = await Promise.all([
    supabase.from("finance_company_totals").select("*").order("as_of_date", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("project_finance")
      .select("*, projects(name, status)")
      .order("as_of_date", { ascending: false }),
    getCashPosition(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cash position, transactions, creditors, payment notices and structured reporting.
        </p>
      </div>

      <FinanceSubNav canWrite={canWrite} />

      <div className="space-y-8 pt-2">
        <CashPositionPanel initialData={cashPosition} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="Revenue Pipeline" value={formatUsdCompact(totals?.revenue_pipeline_usd)} />
          <KpiCard label="Contracted Revenue" value={formatUsdCompact(totals?.contracted_revenue_usd)} />
          <KpiCard label="Outstanding Receivables" value={formatUsdCompact(totals?.outstanding_receivables_usd)} />
        </div>

        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Cost to Date</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Contracted</TableHead>
                  <TableHead className="text-right">Receivables</TableHead>
                  <TableHead>As Of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectFinance?.map((pf) => {
                  const margin =
                    pf.budget_usd && pf.cost_to_date_usd != null
                      ? Math.round(((pf.budget_usd - pf.cost_to_date_usd) / pf.budget_usd) * 1000) / 10
                      : null;
                  return (
                    <TableRow key={pf.id}>
                      <TableCell className="font-medium text-navy">
                        {(pf.projects as unknown as { name: string } | null)?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatUsdCompact(pf.budget_usd)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatUsdCompact(pf.cost_to_date_usd)}</TableCell>
                      <TableCell className={`text-right font-medium ${margin != null && margin < 20 ? "text-status-red" : "text-status-green"}`}>
                        {margin != null ? `${margin}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatUsdCompact(pf.contracted_revenue_usd)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatUsdCompact(pf.receivables_usd)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(pf.as_of_date)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
