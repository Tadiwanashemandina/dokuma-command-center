import { AlertTriangle, Check, Minus } from "lucide-react";
import { Link } from "react-router-dom";
import { formatMeasureValue, formatTarget } from "@dokuma/shared";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MeasureWithValue } from "@/lib/api/group-kpis";

/**
 * One board-level exception measure.
 *
 * These are the five measures §4 of the specification says are "capable of
 * changing a group decision"; everything else on the register is drill-down.
 * So the tile's job is to answer one question at a glance — is this figure on
 * target, off target, or not yet reported — and it must answer the third case
 * as clearly as the other two.
 *
 * ---------------------------------------------------------------------------
 * Why "not captured" is grey and not red
 * ---------------------------------------------------------------------------
 * A missing figure is UNKNOWN, not failing. Painting it red would tell a
 * chairman that a measure has breached when in fact nobody has entered it, and
 * that misreading runs in the dangerous direction: it manufactures alarm from
 * absence, and — worse — it makes a genuinely breached measure indistinguishable
 * from an unfilled one. `onTarget: null` is a distinct state with distinct
 * treatment, which is the whole reason the server returns three values here
 * rather than a boolean.
 *
 * Status is never carried by color alone: each state ships an icon and a word.
 */

/** The three states a tile can be in, with icon + label so color is never alone. */
const STATES = {
  ok: {
    icon: Check,
    label: "On target",
    ring: "border-status-green/40",
    chip: "bg-status-green/15 text-status-green",
    dot: "bg-status-green",
  },
  breach: {
    icon: AlertTriangle,
    label: "Off target",
    ring: "border-status-red/50",
    chip: "bg-status-red/15 text-status-red",
    dot: "bg-status-red",
  },
  /**
   * A figure with no target: reported, but not judged.
   *
   * This state exists because the alternative is worse in a specific and
   * dangerous way. TOP_CLIENT_REVENUE_PCT has no target in the register, and
   * Dokuma's value is ~71% — that is the concentration risk the measure exists
   * to put in front of a board. Rendering it "On target" in green because no
   * threshold happened to be set would actively reassure a reader about the
   * single largest commercial risk in the business.
   *
   * So: no target means no verdict, stated plainly and in neutral ink.
   */
  reported: {
    icon: Minus,
    label: "No target set",
    ring: "border-border",
    chip: "bg-muted text-muted-foreground",
    dot: "bg-steel",
  },
  unknown: {
    icon: Minus,
    label: "Not captured",
    ring: "border-border",
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
} as const;

function stateFor(row: MeasureWithValue): keyof typeof STATES {
  if (row.value === null) return "unknown";
  if (row.onTarget === null) return "reported";
  return row.onTarget ? "ok" : "breach";
}

export function ExceptionTile({ row, href }: { row: MeasureWithValue; href?: string }) {
  const state = STATES[stateFor(row)];
  const Icon = state.icon;
  const target = formatTarget(row.measure.target);

  const body = (
    <Card
      className={cn(
        "h-full rounded-2xl border transition-shadow",
        state.ring,
        href && "hover:shadow-md",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase leading-4 tracking-[0.14em] text-muted-foreground">
            {row.measure.name}
          </p>
          <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", state.dot)} aria-hidden />
        </div>

        <div className="flex items-baseline gap-2">
          {/* Tabular figures so a column of tiles aligns on the decimal. */}
          <span className="font-serif text-3xl font-semibold tabular-nums text-navy">
            {formatMeasureValue(row.measure, row.value)}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              state.chip,
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {state.label}
          </span>

          {target && (
            <span className="text-[11px] text-muted-foreground">Target {target}</span>
          )}

          {/* The frequency tells a reader how fresh the figure can possibly be —
              a MONTHLY measure showing yesterday's date would be a lie. */}
          <span className="text-[11px] text-muted-foreground">
            {row.measure.frequency.toLowerCase()}
          </span>
        </div>

        {row.source === "seed" && row.value !== null && (
          /* Repeated per tile, not just in the page banner: a screenshot of a
             single tile is exactly how a demo number escapes into a slide. */
          <p className="text-[11px] font-medium leading-4 text-gold">Sample figure — not measured</p>
        )}

        {row.measure.dimensioned && (
          /* §12: these measures are defined "by type" but stored as one scalar.
             Saying so on the tile stops a total being read as a breakdown. */
          <p className="text-[11px] leading-4 text-muted-foreground">
            Captured as a total; not split by {row.measure.dimensioned}.
          </p>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link to={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal">
      {body}
    </Link>
  ) : (
    body
  );
}
