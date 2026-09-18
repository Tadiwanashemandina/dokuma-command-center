import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Task load as horizontal bars, one row per measure.
 *
 * Horizontal rather than vertical because the categories have long names
 * ("Tasks due this week"); columns would force the labels to rotate, and
 * rotated axis text is read slowly or not at all.
 *
 * The bars share one scale — the largest value sets the track — so their
 * lengths are honestly comparable. Utilisation is deliberately NOT one of these
 * rows: it is a percentage against a 100% limit, not a count, and putting it on
 * a count scale would make "78%" and "78 tasks" the same length. It gets its own
 * meter below, which is the correct form for a ratio against a limit.
 */

export interface LoadRow {
  label: string;
  value: number;
  /** Status tokens only where the colour genuinely means good/bad. */
  tone?: "neutral" | "warning" | "critical";
  href?: string;
}

export function DeliveryLoadChart({ rows }: { rows: LoadRow[] }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));

  const colourFor = (tone: LoadRow["tone"]) =>
    tone === "critical"
      ? "var(--color-status-red)"
      : tone === "warning"
        ? "var(--color-status-amber)"
        : "var(--color-series-1)";

  return (
    <div className="space-y-3.5">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        const colour = colourFor(r.tone);

        return (
          <div
            key={r.label}
            className="group"
            onPointerEnter={() => setActive(r.label)}
            onPointerLeave={() => setActive(null)}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-foreground">{r.label}</span>
              {/* The value rides at the tip conceptually, but on a short bar it
                  would be clipped — so it is pinned to the row's right edge
                  where it always fits, and never inside the fill. */}
              <span className="text-sm font-semibold tabular-nums text-foreground">{r.value}</span>
            </div>

            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${r.label}: ${r.value}`}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width,opacity] duration-500",
                  active && active !== r.label && "opacity-40",
                )}
                style={{
                  width: `${Math.max(pct, r.value > 0 ? 2 : 0)}%`,
                  background: colour,
                  transitionTimingFunction: "var(--ease-out-quart)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A single ratio against a limit — the form the guidance calls a meter, and the
 * reason utilisation is not a bar in the chart above.
 *
 * The unfilled track is a lighter step of the fill's own ramp rather than a
 * neutral grey, so the state reads across the whole bar. The fill carries
 * severity: under-utilised and over-committed are both problems, and the colour
 * says which.
 */
export function UtilisationMeter({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <p className="text-xs text-muted-foreground">
        No tracked minutes yet — utilisation appears once time is logged.
      </p>
    );
  }

  const clamped = Math.max(0, Math.min(100, pct));
  // Below 60% is idle capacity; above 90% is a team with no slack left. Both
  // are exceptions an executive should see, so both leave the neutral band.
  const tone = clamped > 90 ? "critical" : clamped < 60 ? "warning" : "good";
  const colour =
    tone === "critical"
      ? "var(--color-status-red)"
      : tone === "warning"
        ? "var(--color-status-amber)"
        : "var(--color-status-green)";

  const note =
    tone === "critical"
      ? "Over-committed — no slack for slippage"
      : tone === "warning"
        ? "Idle capacity available"
        : "Healthy range";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground">Team utilisation</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {pct}
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">%</span>
        </span>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: "color-mix(in oklab, var(--color-muted) 100%, transparent)" }}
        role="img"
        aria-label={`Team utilisation ${pct}%. ${note}.`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${clamped}%`,
            background: colour,
            transitionTimingFunction: "var(--ease-out-quart)",
          }}
        />
      </div>

      {/* Severity is stated in words as well as colour — the status palette
          never ships as colour alone. */}
      <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
