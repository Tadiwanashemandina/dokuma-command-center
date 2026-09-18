import { Link } from "react-router-dom";
import { Sparkline } from "@/components/sparkline";
import { TrendArrow, type TrendDirection } from "@/components/trend-arrow";
import { cn } from "@/lib/utils";

/**
 * Secondary metrics as one continuous band rather than a grid of cards.
 *
 * Nine separate cards give nine numbers the same visual weight as the headline
 * figure, which flattens the page — everything is emphasised, so nothing is.
 * Grouping the supporting figures into a single divided strip makes them read
 * as one instrument panel, and lets the hero above them actually lead.
 *
 * It is one card with internal dividers, not N cards with gaps: a shared
 * surface is what makes the group read as a group.
 */

export interface StripMetric {
  label: string;
  value: string | number;
  unit?: string;
  href?: string;
  history?: number[];
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  footnote?: string;
  /** Paints the figure when the metric is in a bad state. */
  tone?: "default" | "critical";
}

export function MetricStrip({ metrics }: { metrics: StripMetric[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] bg-card shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
        {metrics.map((m) => {
          const body = (
            <div className="flex h-full flex-col justify-between gap-3 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {m.label}
              </p>

              <div className="flex items-end justify-between gap-2">
                <p
                  className={cn(
                    "text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]",
                    m.tone === "critical" ? "text-status-red" : "text-navy",
                  )}
                >
                  {m.value}
                  {m.unit && (
                    <span className="ml-0.5 text-base font-normal tracking-normal text-muted-foreground">
                      {m.unit}
                    </span>
                  )}
                </p>

                {m.history && m.history.length >= 2 && (
                  <span className="w-16 shrink-0">
                    <Sparkline
                      points={m.history}
                      colour={
                        m.tone === "critical"
                          ? "var(--color-status-red)"
                          : "var(--color-series-1)"
                      }
                      ariaLabel={`${m.label}: 30-day trend`}
                    />
                  </span>
                )}
              </div>

              {m.trend ? (
                <TrendArrow
                  direction={m.trend.direction}
                  label={m.trend.label}
                  goodDirection={m.trend.goodDirection}
                />
              ) : (
                <span className="text-[11px] text-muted-foreground/70">
                  {m.footnote ?? " "}
                </span>
              )}
            </div>
          );

          return m.href ? (
            <Link
              key={m.label}
              to={m.href}
              className="block transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal"
            >
              {body}
            </Link>
          ) : (
            <div key={m.label}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
