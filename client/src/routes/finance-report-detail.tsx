import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import {
  FINANCE_APPROVE,
  type CreditorSummary,
  type DailySnapshot,
  type DlapSummary,
  type PeriodReportData,
  type TrendPoint,
  type UnusualTransaction,
} from "@dokuma/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-states";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { CsvExportButton } from "@/components/finance/csv-export-button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatDate, formatDateTime, formatMoney } from "@/lib/utils";
import { getReport, publishReport, type ReportDetail } from "@/lib/api/finance";

/**
 * One stored report.
 *
 * `content` is a snapshot, not a live computation: opening a published report
 * months later shows the figures as they were when it was generated. That is
 * what makes a report citable, and it is why nothing on this page recomputes
 * anything — every figure is rendered exactly as stored.
 *
 * Money arrives as an exact decimal string and stays one. Nothing here sums,
 * subtracts or parses an amount; the server supplies every total the page needs.
 */

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  published: "bg-status-green/15 text-status-green hover:bg-status-green/15",
};

/** The narrative fields, in the order a reader expects them. */
const NARRATIVE_FIELDS: { key: string; label: string }[] = [
  { key: "executive_summary", label: "Executive summary" },
  { key: "key_advancements", label: "Key advancements" },
  { key: "challenges", label: "Challenges" },
  { key: "next_week_plan", label: "Plan for next week" },
  { key: "next_month_plan", label: "Plan for next month" },
];

export function FinanceReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canApprove = user !== null && FINANCE_APPROVE.includes(user.role);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["finance", "reports", "detail", id],
    queryFn: () => getReport(id!),
    enabled: Boolean(id),
    // A 404 is a definitive answer, not a transient failure worth retrying.
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 1,
  });

  useDocumentTitle(data ? `${titleCase(data.type)} report` : "Finance Report");

  const publish = useMutation({
    mutationFn: () => publishReport(id!),
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finance", "reports", "detail", id] }),
        queryClient.invalidateQueries({ queryKey: ["finance", "reports"] }),
      ]);
    },
  });

  /**
   * A missing report gets its own state rather than the generic error card:
   * "not found" is an answer about this URL, and a retry button would only
   * repeat it.
   */
  if (error instanceof ApiRequestError && error.status === 404) {
    return (
      <div className="space-y-6">
        <FinanceSubnav />
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-8 text-center">
            <h1 className="font-serif text-2xl font-semibold text-foreground">Report not found</h1>
            <p className="text-sm text-muted-foreground">
              No finance report exists with this identifier. It may have been deleted, or the link
              may be mistyped.
            </p>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/finance/reports">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to reports
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <FinanceSubnav />
        <span className="sr-only">Loading report…</span>
        <Skeleton className="h-9 w-80" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <FinanceSubnav />
        <QueryError error={error} onRetry={() => void refetch()} resource="this report" />
      </div>
    );
  }

  const report: ReportDetail = data;
  const isDaily = report.type === "daily";

  return (
    <div className="space-y-6">
      <FinanceSubnav />

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <Link
            to="/finance/reports"
            className="inline-flex items-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> All reports
          </Link>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground">
            {titleCase(report.type)} report
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isDaily
              ? formatDate(report.period_end ?? report.period_start)
              : `${formatDate(report.period_start)} – ${formatDate(report.period_end)}`}{" "}
            · Generated {formatDateTime(report.generated_at)}
            {report.published_at ? ` · Published ${formatDateTime(report.published_at)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge
            className={cn(
              "rounded-full border-0 capitalize",
              STATUS_STYLES[report.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {report.status}
          </Badge>

          {/*
            Publish is offered only to FINANCE_APPROVE. The legacy app showed it
            to every finance role and let the server's 403 explain itself after
            the click — a button that exists only to fail.
          */}
          {report.status === "draft" && canApprove && (
            <Button
              className="rounded-xl"
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {publish.isPending ? "Publishing…" : "Publish report"}
            </Button>
          )}
        </div>
      </div>

      {report.status === "draft" && !canApprove && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          This report is still a draft. Publishing requires finance manager approval.
        </p>
      )}

      {publish.error && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {publish.error instanceof ApiRequestError
            ? publish.error.message
            : "Could not publish this report."}
        </p>
      )}

      {isDaily ? (
        <DailyReportBody snapshot={report.content as DailySnapshot} />
      ) : (
        <PeriodReportBody
          type={report.type}
          content={report.content as PeriodReportData & Record<string, string>}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

function DailyReportBody({ snapshot }: { snapshot: DailySnapshot }) {
  const unusual: UnusualTransaction[] = snapshot.unusual_transactions ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Opening balance" value={formatMoney(snapshot.opening_balance)} />
        <Tile label="Closing balance" value={formatMoney(snapshot.closing_balance)} />
        <Tile label="Money in" value={formatMoney(snapshot.transactions_in)} />
        <Tile label="Money out" value={formatMoney(snapshot.transactions_out)} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle className="font-serif text-lg text-foreground">
            Unusual transactions
          </CardTitle>
          <CsvExportButton
            filename={`unusual-transactions-${snapshot.date}`}
            headers={["Date", "Account", "Type", "Amount", "Counterparty", "Description"]}
            rows={unusual.map((t) => [
              t.date,
              t.account_name ?? "",
              t.type,
              // The raw exact string, not a formatted one — a spreadsheet
              // should receive the figure, not its presentation.
              t.amount,
              t.counterparty ?? "",
              t.description ?? "",
            ])}
          />
        </CardHeader>
        <CardContent className="p-0">
          {unusual.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unusual.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.account_name ?? "—"}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{t.type}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">
                      {formatMoney(t.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.counterparty ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{t.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            /*
              An empty list is a finding, not an absence of data: the check ran
              and flagged nothing. Phrased as a result so a reader does not
              mistake it for a report that failed to load its detail.
            */
            <p className="p-4 text-sm text-muted-foreground">
              No unusual transactions flagged for {formatDate(snapshot.date)}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly / monthly
// ---------------------------------------------------------------------------

export function PeriodReportFigures({ data }: { data: PeriodReportData }) {
  const trend: TrendPoint[] = data.trend ?? [];
  const creditors: CreditorSummary[] = data.creditors ?? [];
  const dlap: DlapSummary | undefined = data.dlap;

  return (
    <div className="space-y-6">
      {/*
        Three balances, never two.

        `closing_balance` is the balance AT period end; `current_balance` is
        live at the moment the report was generated. For a report drafted
        promptly they usually match, and the gap when they do not is the
        signal — it says how much has moved since the period closed. Merging
        them is the most likely "simplification" here, so both are labelled
        with what they actually mean.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tile label="Opening (at period start)" value={formatMoney(data.opening_balance)} />
        <Tile label="Closing (at period end)" value={formatMoney(data.closing_balance)} />
        <Tile label="Current (at generation)" value={formatMoney(data.current_balance)} />
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground">Closing</span> is the balance as at{" "}
          {formatDate(data.period_end)}, the end of the reporting period.{" "}
          <span className="font-medium text-foreground">Current</span> is the live balance at the
          moment this report was generated. A difference between them is movement that happened
          after the period closed — it is expected, and its size is the point.
        </span>
      </p>

      {dlap && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg text-foreground">DLAP</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure label="Total amount" value={formatMoney(dlap.total_amount)} />
            <Figure label="Dokuma share" value={formatMoney(dlap.dokuma_share)} />
            <Figure label="Transactions" value={String(dlap.transaction_count)} />
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg text-foreground">Trend</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {trend.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Closing balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trend.map((point) => (
                  <TableRow key={`${point.period_start}-${point.period_end}`}>
                    <TableCell className="font-medium text-foreground">{point.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(point.period_start)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(point.period_end)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">
                      {formatMoney(point.closing_balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No prior periods to compare against.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle className="font-serif text-lg text-foreground">Creditors</CardTitle>
          <CsvExportButton
            filename={`creditors-${data.period_start}-to-${data.period_end}`}
            headers={["Name", "Amount owed", "Due date", "Status", "Notes"]}
            rows={creditors.map((c) => [
              c.name,
              c.amount_owed,
              c.due_date ?? "",
              c.status,
              c.notes ?? "",
            ])}
          />
        </CardHeader>
        <CardContent className="p-0">
          {creditors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creditor</TableHead>
                  <TableHead className="text-right">Amount owed</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditors.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">
                      {formatMoney(c.amount_owed)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(c.due_date)}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {c.status.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No outstanding creditors recorded for this period.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PeriodReportBody({
  type,
  content,
}: {
  type: string;
  content: PeriodReportData & Record<string, string>;
}) {
  const planKey = type === "monthly" ? "next_month_plan" : "next_week_plan";

  const narrative = NARRATIVE_FIELDS.filter(
    (field) =>
      // Only the plan field belonging to this report type is relevant; the
      // other one is simply absent on the stored body.
      (field.key !== "next_week_plan" && field.key !== "next_month_plan") ||
      field.key === planKey,
  );

  return (
    <div className="space-y-6">
      <PeriodReportFigures data={content} />

      <div className="space-y-4">
        {narrative.map((field) => {
          const value = content[field.key];
          return (
            <Card key={field.key} className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-lg text-foreground">{field.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {value ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{value}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not recorded.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
