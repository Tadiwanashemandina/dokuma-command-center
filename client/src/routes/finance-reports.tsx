import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FilePlus2, Zap } from "lucide-react";
import { FINANCE_WRITE, type ReportType } from "@dokuma/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError, TableSkeleton } from "@/components/query-states";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { generateDailyReport, listReports } from "@/lib/api/finance";

/**
 * The finance report register.
 *
 * Three report types share one list because they share one lifecycle question:
 * "has this been published yet". Weekly and monthly reports are drafted, read,
 * and then published by someone with approval authority. Daily reports are not
 * — they are generated and published in the same call, deliberately, because a
 * daily snapshot has no narrative to review and a draft step would only ensure
 * that yesterday's snapshot was still sitting unpublished tomorrow. The UI says
 * so rather than leaving a reader to infer it from a missing button.
 */

type TypeFilter = ReportType | "all";

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/**
 * Draft is amber, not grey.
 *
 * A draft is not a neutral state — it is work that someone still owes an
 * approval on, and it reads differently from a published report that is simply
 * finished.
 */
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  published: "bg-status-green/15 text-status-green hover:bg-status-green/15",
};

export function FinanceReportsPage() {
  useDocumentTitle("Finance Reports");

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWrite = user !== null && FINANCE_WRITE.includes(user.role);

  const [type, setType] = useState<TypeFilter>("all");
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: queryError, isPending, refetch } = useQuery({
    queryKey: ["finance", "reports", type, offset],
    queryFn: () =>
      listReports({
        type: type === "all" ? undefined : type,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });

  const generateDaily = useMutation({
    mutationFn: () => generateDailyReport(),
    async onSuccess(result) {
      setError(null);
      setNotice(
        result.regenerated
          ? "Daily report regenerated — it replaced the existing report for that date."
          : "Daily report generated and published.",
      );
      await queryClient.invalidateQueries({ queryKey: ["finance", "reports"] });
    },
    onError(caught) {
      setNotice(null);
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "Could not generate the daily report. Try again.",
      );
    },
  });

  const items = data?.items ?? [];

  /** Changing the filter has to reset the page, or an empty page 3 appears. */
  const changeType = (next: TypeFilter) => {
    setType(next);
    setOffset(0);
  };

  return (
    <div className="space-y-6">
      <FinanceSubnav />

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Finance Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily snapshots, and the weekly and monthly reports drafted from them. Each report
            stores the figures as they stood when it was generated, so a published report stays
            citable.
          </p>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={generateDaily.isPending}
              onClick={() => generateDaily.mutate()}
            >
              <Zap className="mr-2 h-4 w-4" aria-hidden="true" />
              {generateDaily.isPending ? "Generating…" : "Generate daily report"}
            </Button>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/finance/reports/weekly/new">
                <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" /> New weekly report
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/finance/reports/monthly/new">
                <CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" /> New monthly report
              </Link>
            </Button>
          </div>
        )}
      </div>

      {canWrite && (
        <p className="text-xs text-muted-foreground">
          Daily reports are published immediately — there is no draft step. Weekly and monthly
          reports are saved as drafts and published separately by a finance manager.
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-lg bg-status-green/10 px-3 py-2 text-sm text-status-green"
        >
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
        {TYPE_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={type === filter.value ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            aria-pressed={type === filter.value}
            onClick={() => changeType(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isPending && <TableSkeleton columns={6} />}

          {queryError && (
            <div className="p-4">
              <QueryError
                error={queryError}
                onRetry={() => void refetch()}
                resource="finance reports"
              />
            </div>
          )}

          {!isPending && !queryError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated by</TableHead>
                  <TableHead>Generated at</TableHead>
                  <TableHead>Published at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium capitalize">
                      <Link
                        to={`/finance/reports/${report.id}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {report.type}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {report.type === "daily"
                        ? formatDate(report.period_end ?? report.period_start)
                        : `${formatDate(report.period_start)} – ${formatDate(report.period_end)}`}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "rounded-full border-0 capitalize",
                          STATUS_STYLES[report.status] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {report.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {report.generated_by_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(report.generated_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {report.published_at ? formatDateTime(report.published_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}

                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No {type === "all" ? "" : `${type} `}reports on record.
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
        label="reports"
      />
    </div>
  );
}
