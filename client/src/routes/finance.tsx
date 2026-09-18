import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, QueryError, TableSkeleton } from "@/components/query-states";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { CsvExportButton } from "@/components/finance/csv-export-button";
import { cn, formatDate, formatMoney, formatMoneyCompact, formatPercent } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  getCashPosition,
  getCompanyTotals,
  listProjectFinance,
  type ProjectFinanceRow,
} from "@/lib/api/finance";

/**
 * Finance overview — cash position, company totals, and per-project finance.
 *
 * Three independent queries rather than one, so a 403 or a failure on any one
 * panel leaves the other two readable. They have genuinely different shapes and
 * failure modes, and a single combined loading state would hide the cheapest
 * data behind the slowest.
 */
export function FinancePage() {
  useDocumentTitle("Finance");

  const cash = useQuery({ queryKey: ["finance", "cash-position"], queryFn: getCashPosition });
  const totals = useQuery({ queryKey: ["finance", "company-totals"], queryFn: getCompanyTotals });
  const projects = useQuery({ queryKey: ["finance", "project-finance"], queryFn: listProjectFinance });

  const projectRows = projects.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cash on hand, company revenue position, and the margin picture project by project.
        </p>
      </div>

      <FinanceSubnav />

      <CashPositionPanel query={cash} />
      <CompanyTotalsPanel query={totals} />
      <ProjectFinancePanel query={projects} rows={projectRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash position
// ---------------------------------------------------------------------------

/**
 * One panel per currency.
 *
 * Balances are NEVER summed across currencies — not even for a headline
 * "total cash" figure. There is no exchange rate in this system, so adding USD
 * to ZWL would produce a number with no meaning that nonetheless looks
 * authoritative. Each currency carries its own server-computed total; the page
 * only lays them out.
 */
function CashPositionPanel({ query }: { query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getCashPosition>>>> }) {
  const currencies = query.data ?? [];

  return (
    <section className="space-y-3">
      <h2 className="font-serif text-xl font-semibold text-foreground">Cash position</h2>

      {query.isPending && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      )}

      {query.error && (
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          resource="the cash position"
        />
      )}

      {!query.isPending && !query.error && currencies.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <EmptyState
              message="No accounts on record"
              hint="Add a bank, cash or mobile-money account to start tracking a balance."
            />
          </CardContent>
        </Card>
      )}

      {!query.isPending && !query.error && currencies.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {currencies.map((entry) => (
            <Card key={entry.currency} className="rounded-2xl">
              <CardContent className="space-y-4 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {entry.currency}
                  </p>
                  <p className="mt-1 font-serif text-3xl font-semibold text-foreground">
                    {formatMoney(entry.total_balance, { currency: entry.currency })}
                  </p>
                </div>

                <ul className="space-y-2 border-t border-border pt-3">
                  {entry.accounts.map((account) => (
                    <li key={account.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-foreground">
                        {account.name}
                        <span className="ml-2 text-xs capitalize text-muted-foreground">
                          {account.type}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatMoney(account.current_balance, { currency: entry.currency })}
                      </span>
                    </li>
                  ))}
                  {entry.accounts.length === 0 && (
                    <li className="text-sm text-muted-foreground">No active accounts.</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Company totals
// ---------------------------------------------------------------------------

function CompanyTotalsPanel({
  query,
}: {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getCompanyTotals>>>>;
}) {
  const totals = query.data ?? null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-foreground">Company totals</h2>
        {totals?.as_of_date && (
          <p className="text-xs text-muted-foreground">As of {formatDate(totals.as_of_date)}</p>
        )}
      </div>

      {query.isPending && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      {query.error && (
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          resource="company totals"
        />
      )}

      {/* null is "no snapshot has ever been recorded", which is a different
          fact from "the totals are zero" and must not render as three zeros. */}
      {!query.isPending && !query.error && totals === null && (
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <EmptyState
              message="No snapshot recorded yet"
              hint="Company totals appear once the first daily finance snapshot is generated."
            />
          </CardContent>
        </Card>
      )}

      {!query.isPending && !query.error && totals !== null && (
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiTile label="Revenue Pipeline" value={totals.revenue_pipeline_usd} />
          <KpiTile label="Contracted Revenue" value={totals.contracted_revenue_usd} />
          <KpiTile label="Outstanding Receivables" value={totals.outstanding_receivables_usd} />
        </div>
      )}
    </section>
  );
}

function KpiTile({ label, value }: { label: string; value: string | null }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 font-serif text-3xl font-semibold tabular-nums text-foreground">
          {formatMoneyCompact(value)}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Project finance
// ---------------------------------------------------------------------------

const PROJECT_CSV_HEADERS = [
  "Project",
  "Budget (USD)",
  "Cost to Date (USD)",
  "Margin %",
  "Receivables (USD)",
  "As Of",
];

function ProjectFinancePanel({
  query,
  rows,
}: {
  query: ReturnType<typeof useQuery<ProjectFinanceRow[]>>;
  rows: ProjectFinanceRow[];
}) {
  // The CSV carries the same rendered strings the table shows. Amounts stay as
  // the exact decimals the API sent; nothing is re-derived here.
  const csvRows = rows.map((row) => [
    row.project_name ?? "Unnamed project",
    row.budget_usd ?? "",
    row.cost_to_date_usd ?? "",
    row.margin_pct === null ? "" : row.margin_pct.toFixed(1),
    row.receivables_usd ?? "",
    row.as_of_date ?? "",
  ]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-foreground">Project finance</h2>
        <CsvExportButton
          filename="project-finance"
          headers={PROJECT_CSV_HEADERS}
          rows={csvRows}
          disabled={query.isPending || Boolean(query.error)}
        />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {query.isPending && <TableSkeleton columns={6} />}

          {query.error && (
            <div className="p-4">
              <QueryError
                error={query.error}
                onRetry={() => void query.refetch()}
                resource="project finance"
              />
            </div>
          )}

          {!query.isPending && !query.error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Cost to Date</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead className="text-right">Receivables</TableHead>
                  <TableHead>As Of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-xs font-medium text-foreground">
                      {row.project_name ?? "Unnamed project"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.budget_usd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.cost_to_date_usd)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", marginClass(row.margin_pct))}>
                      {/* null is "no budget set". It is rendered as an em dash
                          and is deliberately NOT coloured — a red 0% against an
                          unbudgeted project is a false alarm. */}
                      {formatPercent(row.margin_pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.receivables_usd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.as_of_date)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No project finance records yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** Colour only when the margin is a real number. */
function marginClass(margin: number | null): string {
  if (margin === null) return "text-muted-foreground";
  if (margin < 0) return "font-medium text-status-red";
  if (margin < 20) return "font-medium text-status-amber";
  return "text-foreground";
}
