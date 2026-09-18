import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";
import {
  CATEGORY_LABELS,
  KPI_CATEGORIES,
  formatMeasureValue,
  formatTarget,
  type SbuKpiCategory,
} from "@dokuma/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { ExceptionTile } from "@/components/exception-tile";
import { FeedStatusBanner } from "@/components/feed-status-banner";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";
import {
  getGroupKpiOverview,
  getGroupKpiReadings,
  type MeasureWithValue,
} from "@/lib/api/group-kpis";

/**
 * Group Reporting — what Dokuma owes the Office of the Chairman.
 *
 * Three surfaces now exist and are deliberately NOT merged:
 *
 *   /            CEO Home        — Dokuma's own operational view (projects,
 *                                  tasks, receivables, utilisation).
 *   /group       this page       — the Group's register of 59 measures, and
 *                                  the state of the feed that carries them.
 *   /api/kpi-feed                — the frozen twelve-metric machine contract.
 *
 * They answer different questions for different readers. CEO Home asks "how is
 * the business running this week"; this page asks "what has the board been
 * told, and is any of it overdue or breaching".
 *
 * ---------------------------------------------------------------------------
 * Why the exceptions come first and alone
 * ---------------------------------------------------------------------------
 * §4 of the specification says the five exception measures are the ones
 * "capable of changing a group decision" and that "everything else is
 * drill-down". A screen that showed all 59 at equal weight would be a
 * spreadsheet, and the five would be lost in it. So the five get the top of the
 * page at full size, and the other 54 are collapsed by category below.
 */

/** Categories in reading order, with the spine last — it is derived, not owed. */
const ORDERED_CATEGORIES: SbuKpiCategory[] = [...KPI_CATEGORIES];

export function GroupReportingPage() {
  useDocumentTitle("Group Reporting");

  const overview = useQuery({
    queryKey: ["group-kpis", "overview"],
    queryFn: () => getGroupKpiOverview(),
  });

  /**
   * The full register is a second query, not part of the overview.
   *
   * The five exception tiles and the feed banner are what a chairman opens this
   * page for, and they must not wait on 59 rows to render. This also means the
   * detail can fail without taking the headline with it.
   */
  const readings = useQuery({
    queryKey: ["group-kpis", "readings"],
    queryFn: () => getGroupKpiReadings(),
    staleTime: 60_000,
  });

  const byCategory = useMemo(() => {
    const map = new Map<SbuKpiCategory, MeasureWithValue[]>();
    for (const row of readings.data?.readings ?? []) {
      const list = map.get(row.measure.category) ?? [];
      list.push(row);
      map.set(row.measure.category, list);
    }
    return map;
  }, [readings.data]);

  const o = overview.data;

  return (
    <div className="mx-auto max-w-[1500px] space-y-8">
      <div className="flex flex-col justify-between gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-steel">
            <Building2 className="h-3.5 w-3.5" /> Office of the Chairman
          </div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-navy">
            Group Reporting
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Dokuma's position against the Group KPI register — 45 bespoke measures and the
            14-measure group spine, with the five board-level exceptions first.
          </p>
        </div>

        {o && (
          <div className="text-right text-sm">
            <p className="font-semibold text-navy">{o.sbuCode}</p>
            <p className="text-muted-foreground">
              {o.period.month} · daily {o.period.date}
            </p>
          </div>
        )}
      </div>

      {overview.error && (
        <QueryError
          error={overview.error}
          onRetry={() => void overview.refetch()}
          resource="group reporting"
        />
      )}

      {/* ---- Demo-data caveat, before anything else ---------------------- */}
      {o && <DemoDataBanner count={o.completeness.demo} total={o.completeness.captured} />}

      {/* ---- Feed delivery state, before any figure ---------------------- */}
      {overview.isPending ? (
        <Skeleton className="h-14 w-full rounded-xl" />
      ) : (
        o && <FeedStatusBanner feed={o.feed} />
      )}

      {/* ---- The board-level five --------------------------------------- */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-lg text-navy">Board-level exceptions</h2>
          <p className="text-xs text-muted-foreground">
            The measures capable of changing a group decision
          </p>
        </div>

        {overview.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {(o?.exceptions ?? []).map((row) => (
              <ExceptionTile key={row.measure.code} row={row} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Month-end completeness ------------------------------------- */}
      {o && <CompletenessCard completeness={o.completeness} />}

      {/* ---- The rest of the register ------------------------------------ */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-lg text-navy">Full register</h2>
          <p className="text-xs text-muted-foreground">
            {readings.data ? `${readings.data.readings.length} measures` : ""}
          </p>
        </div>

        {readings.error ? (
          <QueryError
            error={readings.error}
            onRetry={() => void readings.refetch()}
            resource="the measure register"
          />
        ) : readings.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {ORDERED_CATEGORIES.map((category) => (
              <CategorySection
                key={category}
                category={category}
                rows={byCategory.get(category) ?? []}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Month-end progress.
 *
 * Counts only what Dokuma is responsible for — the spine is excluded, because
 * it is derived by the Group platform from documents and would otherwise make a
 * complete submission read as permanently unfinished.
 */
function CompletenessCard({
  completeness,
}: {
  completeness: { total: number; captured: number; outstanding: number; exceptionsOutstanding: string[] };
}) {
  const pct = completeness.total === 0 ? 0 : Math.round((completeness.captured / completeness.total) * 100);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg text-navy">Month-end capture</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl font-semibold tabular-nums text-navy">
            {completeness.captured}
          </span>
          <span className="text-sm text-muted-foreground">
            of {completeness.total} measures captured
          </span>
          <span className="ml-auto text-sm font-medium tabular-nums text-muted-foreground">{pct}%</span>
        </div>

        {/* A single proportion, so a bar rather than a chart. Rounded data-end,
            anchored to the track, with a 2px surface gap at the join. */}
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Month-end capture progress"
        >
          <div
            className="h-full rounded-full bg-[var(--color-series-2)] transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>

        {completeness.exceptionsOutstanding.length > 0 ? (
          <p className="text-sm text-status-red">
            {completeness.exceptionsOutstanding.length} board-level measure
            {completeness.exceptionsOutstanding.length === 1 ? "" : "s"} still outstanding:{" "}
            <span className="font-medium">{completeness.exceptionsOutstanding.join(", ")}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            All board-level measures captured for this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * One collapsible category of the register.
 *
 * Collapsed by default except where something is outstanding — the page's job
 * is to surface what needs attention, so a category that is complete should not
 * cost a reader a scroll.
 */
function CategorySection({
  category,
  rows,
}: {
  category: SbuKpiCategory;
  rows: MeasureWithValue[];
}) {
  const outstanding = rows.filter((r) => r.value === null && r.measure.route !== "derived").length;
  const [open, setOpen] = useState(outstanding > 0);

  if (rows.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Card className="overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
      >
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-serif text-base text-navy">{CATEGORY_LABELS[category]}</span>
        <span className="text-xs text-muted-foreground">{rows.length}</span>

        {outstanding > 0 && (
          <span className="ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
            {outstanding} outstanding
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/70">
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Measure</th>
                <th>Value</th>
                <th>Target</th>
                <th>Frequency</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.measure.code} className="border-b border-border/40 last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="text-foreground">{row.measure.name}</span>
                    {row.measure.exception && (
                      <span className="ml-2 rounded-full bg-navy/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
                        Board
                      </span>
                    )}
                    <code className="ml-2 text-[11px] text-muted-foreground">{row.measure.code}</code>
                  </td>

                  <td
                    className={cn(
                      "px-3 py-2.5 text-right font-medium tabular-nums",
                      row.value === null ? "text-muted-foreground" : "text-navy",
                      row.onTarget === false && "text-status-red",
                    )}
                  >
                    {formatMeasureValue(row.measure, row.value)}
                  </td>

                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                    {formatTarget(row.measure.target) ?? "—"}
                  </td>

                  <td className="px-3 py-2.5 text-right text-xs lowercase text-muted-foreground">
                    {row.measure.frequency}
                  </td>

                  <td className="px-5 py-2.5 text-right text-xs text-muted-foreground">
                    {/* How the figure gets here, in the reader's terms rather
                        than the route enum's. */}
                    {row.measure.route === "derived"
                      ? "derived by Group"
                      : row.measure.route === "operational-readings"
                        ? "daily feed"
                        : "manual"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
