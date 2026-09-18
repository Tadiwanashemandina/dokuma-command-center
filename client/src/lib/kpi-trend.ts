import type { KpiSeries } from "@/lib/api/dashboard";
import type { TrendDirection } from "@/components/trend-arrow";

/**
 * Turns a KPI series into the `history` / `trend` / `footnote` props a KpiCard
 * takes, keeping the "don't invent a trend" rule in ONE place rather than
 * repeating the null checks at every call site.
 *
 * The rule: a delta of null means the cron has not produced two snapshots yet.
 * That is a different state from "unchanged", and it renders as the words
 * "Collecting trend" — never as 0%, and never as a flat arrow, both of which
 * would assert a comparison that does not exist.
 */

export interface KpiTrendProps {
  history?: number[];
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  footnote?: string;
}

export function trendProps(
  series: KpiSeries | undefined,
  /** Which way is good for this metric — overdue tasks are better going down. */
  goodDirection: TrendDirection = "up",
): KpiTrendProps {
  if (!series) return {};

  // Gaps are dropped rather than zero-filled: a missing snapshot means the job
  // did not run that day, not that the metric fell to zero.
  const history = series.points
    .map((p) => p.value)
    .filter((v): v is number => v != null);

  if (series.delta == null) {
    return { history, footnote: "Collecting trend" };
  }

  const direction: TrendDirection =
    series.delta > 0 ? "up" : series.delta < 0 ? "down" : "flat";

  // Percent when we have a base to divide by, absolute when the previous value
  // was 0 (where a percentage is undefined, not infinite).
  const label =
    series.deltaPct == null
      ? `${series.delta > 0 ? "+" : ""}${series.delta} vs. prev.`
      : `${series.deltaPct > 0 ? "+" : ""}${series.deltaPct.toFixed(1)}% vs. prev.`;

  return { history, trend: { direction, label, goodDirection } };
}

/** Indexes a history response by metric name for O(1) lookup per card. */
export function seriesByMetric(data: { series: KpiSeries[] } | undefined) {
  return new Map((data?.series ?? []).map((s) => [s.metric_name, s]));
}
