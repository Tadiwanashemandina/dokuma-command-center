import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { TrendArrow, type TrendDirection } from "@/components/trend-arrow";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/components/attention-banner";

/**
 * The executive header: title, headline money figures and today's alerts, all
 * on one dark slab.
 *
 * These were three stacked white blocks — a title bar, a row of cards and a
 * banner — which cost three horizontal rules of vertical space and gave the
 * page no focal point. Fusing them means the first screen states who this is
 * for, what the business is worth, and what is wrong, in one glance.
 *
 * Dark carries it because the surrounding page is light: the deck is the only
 * dark region above the fold, so it takes the eye without needing size. The
 * texture and bloom live in `.dokuma-deck` (see globals.css).
 */

export interface DeckFigure {
  label: string;
  value: string;
  href: string;
  history?: number[];
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  footnote?: string;
  /** The lead figure is set larger; the others support it. */
  primary?: boolean;
}

export function CommandDeck({
  eyebrow,
  title,
  hideTitle,
  subtitle,
  figures,
  attention,
  isPending,
  right,
}: {
  eyebrow: React.ReactNode;
  title: string;
  /**
   * Renders the heading for assistive tech only. The `<h1>` is always present
   * — a page needs one — but a deck whose figures already announce the section
   * can drop the visible line rather than repeat itself.
   */
  hideTitle?: boolean;
  subtitle?: string;
  figures: DeckFigure[];
  attention: AttentionItem[];
  isPending?: boolean;
  /** Freshness / refresh controls. */
  right?: React.ReactNode;
}) {
  const live = attention.filter((a) => a.count > 0);
  const worst = live.some((a) => a.tone === "critical") ? "critical" : "warning";

  return (
    <section className="dokuma-deck rounded-[calc(var(--radius)+4px)] px-6 py-7 text-white shadow-[var(--shadow-overlay)] sm:px-8 sm:py-8">
      {/* Title row -------------------------------------------------------- */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div
            className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal ${
              hideTitle ? "" : "mb-3"
            }`}
          >
            {eyebrow}
          </div>
          <h1
            className={
              hideTitle
                ? "sr-only"
                : "font-serif text-[32px] font-semibold leading-tight tracking-tight text-white sm:text-[38px]"
            }
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{subtitle}</p>
          )}
        </div>
        {right}
      </div>

      {/* Figures ---------------------------------------------------------- */}
      <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius)] bg-white/10 sm:grid-cols-3">
        {figures.map((f) => (
          <Link
            key={f.label}
            to={f.href}
            className={cn(
              "group bg-[#0D1B3E]/60 p-5 backdrop-blur-sm transition-colors hover:bg-white/[0.06]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/45">
              {f.label}
            </p>

            <div className="mt-3 flex items-end justify-between gap-3">
              <p
                className={cn(
                  "dokuma-figure font-semibold text-white",
                  f.primary ? "text-[40px] sm:text-[46px]" : "text-[30px]",
                )}
              >
                {isPending ? <span className="text-white/30">…</span> : f.value}
              </p>

              {f.history && f.history.length >= 2 && (
                <span className="w-20 shrink-0 pb-1">
                  <Sparkline
                    points={f.history}
                    colour="var(--color-teal)"
                    ariaLabel={`${f.label}: 30-day trend`}
                  />
                </span>
              )}
            </div>

            <div className="mt-3">
              {f.trend ? (
                <TrendArrow
                  direction={f.trend.direction}
                  label={f.trend.label}
                  goodDirection={f.trend.goodDirection}
                />
              ) : (
                <span className="text-[11px] text-white/35">{f.footnote ?? " "}</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Attention -------------------------------------------------------- */}
      <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        {live.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-white/70">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-green" />
            <span className="font-medium text-white">Nothing needs your attention.</span>
            <span className="hidden text-white/45 sm:inline">
              No critical blockers, overdue tasks or high-risk projects.
            </span>
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm">
              <AlertTriangle
                className={cn(
                  "h-4 w-4 shrink-0",
                  worst === "critical" ? "text-status-red" : "text-status-amber",
                )}
              />
              <span className="font-medium text-white">
                {live.length === 1
                  ? "One area needs your attention"
                  : `${live.length} areas need your attention`}
              </span>
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {live.map((a) => (
                <Link
                  key={a.label}
                  to={a.href}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-navy",
                    a.tone === "critical"
                      ? "border-status-red/40 bg-status-red/10 text-[#FF9E9E] hover:bg-status-red/20"
                      : "border-status-amber/40 bg-status-amber/10 text-[#F0C979] hover:bg-status-amber/20",
                  )}
                >
                  <span className="tabular-nums">{a.count}</span>
                  <span className="text-white/70">{a.label}</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
