import { cn } from "@/lib/utils";

/**
 * Portfolio health as one stacked bar.
 *
 * Two rules from the dataviz work are load-bearing here:
 *
 * 1. A 2px surface-coloured gap separates adjacent fills. Without it two
 *    saturated segments touch and the eye invents a third colour at the seam,
 *    which makes the boundary — the thing being measured — the least legible
 *    part of the bar.
 * 2. Status colour NEVER carries meaning alone. Green and amber are only
 *    ΔE 5.7 apart under protanopia, so each row is labelled with its word and
 *    its count. A reader who cannot separate the hues reads the text and loses
 *    nothing.
 */
export function GarBar({
  green,
  amber,
  red,
}: {
  green: number;
  amber: number;
  red: number;
}) {
  const real = green + amber + red;
  const total = real || 1;

  const segments = [
    {
      key: "green",
      count: green,
      color: "bg-status-green",
      label: "Green",
      hint: "On track",
    },
    {
      key: "amber",
      count: amber,
      color: "bg-status-amber",
      label: "Amber",
      hint: "Needs attention",
    },
    {
      key: "red",
      count: red,
      color: "bg-status-red",
      label: "Red",
      hint: "At risk",
    },
  ];

  const pct = (n: number) => (n / total) * 100;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Portfolio health: ${green} green, ${amber} amber, ${red} red of ${real} projects`}
      >
        {segments.map(
          (s) =>
            s.count > 0 && (
              <div
                key={s.key}
                className={cn(s.color, "first:rounded-l-full last:rounded-r-full")}
                style={{ width: `${pct(s.count)}%` }}
                title={`${s.label}: ${s.count}`}
              />
            ),
        )}
      </div>

      {/* One row per status, so the breakdown fills the card's height with
          information rather than the card stretching around a lone bar. */}
      <div className="mt-5 space-y-3">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-3 text-sm">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.color)} />
            <span className="w-14 font-medium text-navy">{s.label}</span>
            <span className="flex-1 text-muted-foreground">{s.hint}</span>
            <span className="font-semibold tabular-nums text-navy">{s.count}</span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">
              {real ? `${Math.round(pct(s.count))}%` : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-border pt-4 text-sm text-muted-foreground">
        {real ? (
          <>
            <span className="font-semibold tabular-nums text-navy">
              {Math.round(pct(green))}%
            </span>{" "}
            of{" "}
            <span className="font-semibold tabular-nums text-navy">{real}</span>{" "}
            active projects are on track
          </>
        ) : (
          "No active projects"
        )}
      </div>
    </div>
  );
}
