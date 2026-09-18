import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";
import { TrendArrow, type TrendDirection } from "@/components/trend-arrow";
import { cn } from "@/lib/utils";

/**
 * A single KPI figure.
 *
 * Previously every card was navy. Nine navy blocks in a grid is nine things
 * shouting at equal volume, which is the same as none of them shouting — the
 * eye has no entry point and the grid reads as wallpaper. So the default is now
 * a white card on the tinted page, and `variant="hero"` paints exactly ONE card
 * navy per screen. That card is the page's answer; the rest are context.
 *
 * Restraint is the rule to hold here: if a second card ever becomes a hero, the
 * first stops working. The emphasis comes from being the only one.
 */

/**
 * The accent hue.
 *
 * Only `status-red` and `status-green` actually paint a dot. The decorative
 * hues are deliberately mapped to "no dot": a colour that varies per card
 * without encoding anything trains the reader to ignore colour, so that when a
 * genuinely red metric appears it reads as one more decoration instead of a
 * warning. Colour is spent only where it means something.
 *
 * The prop itself is kept so every call site reads unchanged.
 */
const ACCENT_DOT_CLASS = {
  teal: null,
  steel: null,
  gold: null,
  "status-red": "bg-status-red",
  "status-green": "bg-status-green",
} as const;

/** Sparkline stroke per accent — the validated series tokens, not the brand hues. */
const ACCENT_SERIES = {
  teal: "var(--color-series-1)",
  steel: "var(--color-series-1)",
  gold: "var(--color-series-1)",
  "status-red": "var(--color-status-red)",
  "status-green": "var(--color-series-2)",
} as const;

export type KpiAccent = keyof typeof ACCENT_DOT_CLASS;

export function KpiCard({
  label,
  value,
  unit,
  trend,
  href,
  accent = "teal",
  variant = "default",
  history,
  footnote,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  href?: string;
  accent?: KpiAccent;
  /** `hero` paints the card navy. Use on at most one card per screen. */
  variant?: "default" | "hero";
  /** 30-day history. Fewer than two points renders no line — see Sparkline. */
  history?: number[];
  /** Shown when there is no trend yet, e.g. "Collecting trend". */
  footnote?: string;
  /**
   * Grid-placement classes (col-span / row-span).
   *
   * These must land on the OUTERMOST element, because that is what the parent
   * grid treats as its item. When the card is a link the outer element is the
   * <a>, so putting a span class on the inner <Card> silently does nothing —
   * the span is read off a child the grid never positions.
   */
  className?: string;
}) {
  const isHero = variant === "hero";

  const content = (
    <Card
      className={cn(
        "group relative h-full gap-0 overflow-hidden py-0 ring-0 transition-[box-shadow,transform] duration-200 ease-[var(--ease-out-quart)]",
        // Both variants lift on hover by 1px. Enough to say "this is a target",
        // small enough that a grid of them does not jitter as the cursor crosses.
        href && "hover:-translate-y-px",
        isHero
          ? "bg-navy text-white shadow-[var(--shadow-card-hover)]"
          : "bg-card shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]",
        // Only applied here when there is no link wrapper to carry it.
        !href && className,
      )}
    >
      <CardContent className="flex h-full flex-col p-5">
        {/* Eyebrow. 11px uppercase with wide tracking reads as a label rather
            than as competing content, which lets the figure own the card. */}
        <div className="flex items-center gap-2">
          {(isHero || ACCENT_DOT_CLASS[accent]) && (
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                isHero ? "bg-teal" : ACCENT_DOT_CLASS[accent],
              )}
            />
          )}
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.06em]",
              isHero ? "text-white/60" : "text-muted-foreground",
            )}
          >
            {label}
          </p>
        </div>

        {/* tabular-nums keeps digits on a fixed pitch, so a figure updating from
            88 to 91 does not shift the card's width. -0.02em tracking is what
            stops large numerals looking loose. */}
        <p
          className={cn(
            "mt-3 font-semibold tabular-nums tracking-[-0.02em]",
            // The hero occupies four cells, so its figure scales to match. A
            // 34px number in a 2x2 card leaves a void that reads as a mistake —
            // the space has to be filled by the thing that earned it.
            isHero ? "text-[34px] leading-none text-white" : "text-[30px] leading-none text-navy",
          )}
        >
          {value}
          {unit && (
            <span
              className={cn(
                "ml-1 text-lg font-normal tracking-normal",
                isHero ? "text-white/50" : "text-muted-foreground",
              )}
            >
              {unit}
            </span>
          )}
        </p>

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          {trend ? (
            <TrendArrow
              direction={trend.direction}
              label={trend.label}
              goodDirection={trend.goodDirection}
            />
          ) : footnote ? (
            <span
              className={cn(
                "text-[11px]",
                isHero ? "text-white/40" : "text-muted-foreground/70",
              )}
            >
              {footnote}
            </span>
          ) : (
            <span />
          )}

          {history && history.length >= 2 && (
            <span className="w-20 shrink-0">
              <Sparkline
                points={history}
                colour={isHero ? "var(--color-teal)" : ACCENT_SERIES[accent]}
                ariaLabel={`${label}: 30-day trend`}
              />
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      to={href}
      className={cn(
        "block h-full rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2",
        className,
      )}
    >
      {content}
    </Link>
  ) : (
    content
  );
}
