import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A 30-day trend line, drawn by hand in SVG.
 *
 * Deliberately not a chart library. Recharts is ~150KB gzipped and brings a
 * ResizeObserver, a React reconciliation pass per point and an animation loop —
 * for a 40px-tall line with no axes, no legend, no tooltip and no interaction.
 * The maths below is two `map()` calls. The correct dependency count is zero.
 *
 * It renders nothing at all when given fewer than two points. A single snapshot
 * is not a trend, and a flat line drawn through one value is a claim about
 * history that the data does not support — the card shows "Collecting trend"
 * instead. See `getKpiHistory()`, which returns a null delta for the same
 * reason.
 */
export function Sparkline({
  points,
  className,
  colour = "var(--color-series-1)",
  ariaLabel,
}: {
  points: number[];
  className?: string;
  /** A --color-series-N token. Fixed per metric, never cycled by rank. */
  colour?: string;
  ariaLabel?: string;
}) {
  const gradientId = useId();

  if (points.length < 2) return null;

  // A viewBox of 100x32 with preserveAspectRatio="none" lets one path stretch
  // to any card width without recomputing on resize — the stroke is given
  // vector-effect so it does not stretch with it.
  const W = 100;
  const H = 32;
  const PAD = 2; // keeps the 2px stroke from being clipped at the extremes

  const min = Math.min(...points);
  const max = Math.max(...points);

  // A flat series has zero range; dividing by it yields NaN, so pin it to the
  // vertical centre instead — a true statement about a metric that has not moved.
  const range = max - min;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) =>
    range === 0 ? H / 2 : PAD + (1 - (v - min) / range) * (H - PAD * 2);

  const line = points.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L ");
  const path = `M ${line}`;
  // The fill closes down to the baseline; it carries no extra information, so
  // it is a faint wash rather than a solid — the line is the mark.
  const area = `${path} L ${W},${H} L 0,${H} Z`;

  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.18" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={colour}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The latest value gets a dot: it is the one point the reader is
          actually looking for, and it anchors the eye at the right edge. */}
      <circle
        cx={W}
        cy={y(last)}
        r="2.5"
        fill={colour}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
