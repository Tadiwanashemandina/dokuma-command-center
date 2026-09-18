import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Portfolio health as a donut with the active-project count in the hole.
 *
 * A donut is only defensible under narrow conditions, and this data meets them:
 * three segments (the guidance caps part-to-whole at six), a genuine
 * part-to-whole relationship, and a reader who wants the gist — "mostly green"
 * — rather than a precise comparison of two close values. The precise reading is
 * not sacrificed to get it: every count and percentage is printed in the legend
 * rows beside the ring, so nobody has to estimate an angle.
 *
 * Status colour never carries meaning alone. Green and amber sit only ΔE 5.7
 * apart under protanopia — the same finding recorded in `GarBar` — so each
 * segment is named and counted in text. A reader who cannot separate the hues
 * loses nothing.
 */

interface Segment {
  key: string;
  label: string;
  hint: string;
  count: number;
  colour: string;
}

export function PortfolioDonut({
  green,
  amber,
  red,
}: {
  green: number;
  amber: number;
  red: number;
}) {
  const [active, setActive] = useState<string | null>(null);

  const segments: Segment[] = [
    { key: "green", label: "Green", hint: "On track", count: green, colour: "var(--color-status-green)" },
    { key: "amber", label: "Amber", hint: "Needs attention", count: amber, colour: "var(--color-status-amber)" },
    { key: "red", label: "Red", hint: "At risk", count: red, colour: "var(--color-status-red)" },
  ];

  const total = green + amber + red;

  // Ring geometry. A stroked circle with a dash pattern draws each arc without
  // any path maths: the dash length is the segment's share of the
  // circumference, and the offset accumulates as we walk the segments.
  const SIZE = 132;
  const STROKE = 16;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  // A 2px gap in the surface colour separates touching fills — without it the
  // eye invents a third colour at the seam, making the boundary the least
  // legible part of the ring.
  const GAP = total > 1 ? 2 : 0;

  let offset = 0;
  const arcs = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const len = (s.count / (total || 1)) * circumference;
      const arc = { ...s, len: Math.max(0, len - GAP), offset };
      offset += len;
      return arc;
    });

  return (
    // `h-full` + centring lets the donut sit in the middle of a card that is
    // stretched taller by whatever sits beside it in the grid, rather than
    // pinning to the top and leaving a block of dead space underneath.
    <div className="flex h-full flex-col items-center justify-center gap-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`Portfolio health: ${green} green, ${amber} amber, ${red} red of ${total} active projects`}
        >
          {/* Track. Present even when empty so the card never renders a hole. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth={STROKE}
          />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                fill="none"
                stroke={a.colour}
                strokeWidth={STROKE}
                strokeDasharray={`${a.len} ${circumference - a.len}`}
                strokeDashoffset={-a.offset}
                className="cursor-default transition-opacity duration-150"
                // Dimming the others is the "hovered mark responds" cue; the
                // hovered arc keeps full opacity rather than growing, so the
                // geometry — the thing being read — never moves.
                opacity={active && active !== a.key ? 0.3 : 1}
                onPointerEnter={() => setActive(a.key)}
                onPointerLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>

        {/* The hole carries the total. A donut's centre is free real estate and
            the count of active projects is the number this card is about. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-semibold leading-none text-foreground">{total}</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Projects
          </span>
        </div>
      </div>

      {/* The precise read. Every segment names itself, counts itself and states
          its share, so the ring never has to be measured by eye. */}
      <ul className="w-full min-w-0 space-y-2.5">
        {segments.map((s) => (
          <li
            key={s.key}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-colors",
              active === s.key && "bg-muted",
            )}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.colour }}
            />
            <span className="w-14 shrink-0 font-medium text-foreground">{s.label}</span>
            <span className="hidden flex-1 truncate text-xs text-muted-foreground sm:block">
              {s.hint}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{s.count}</span>
            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {total ? `${Math.round((s.count / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
