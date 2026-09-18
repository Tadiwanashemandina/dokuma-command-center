import { useId, useMemo, useRef, useState } from "react";
import { formatUsdCompact } from "@/lib/utils";

/**
 * Pipeline vs contracted revenue over the last 30 days.
 *
 * Hand-drawn SVG, like `Sparkline` — and for the same reason. The comment there
 * argues the case against Recharts for a 40px line; it holds just as well for
 * this one. What a chart library would add over the maths below is a
 * ResizeObserver, a reconciliation pass per point and an animation loop. What it
 * would cost is ~150KB gzipped on an executive dashboard's first paint.
 *
 * Two dataviz rules shape the design:
 *
 * 1. **One axis, never two.** Pipeline and contracted revenue are both USD, so
 *    they legitimately share a scale — and because they do, their gap is real
 *    and readable. Had they been different units the answer would be two charts,
 *    not a second y-axis: the alignment of two scales is arbitrary and invents a
 *    correlation the data does not contain.
 * 2. **The crosshair finds the X.** A reader aims at a date, not at a 2px line,
 *    so the pointer snaps to the nearest day and one tooltip reports every
 *    series at that day. Keyboard arrows drive the same readout.
 */

export interface RevenueSeries {
  label: string;
  colour: string;
  /** Oldest first, aligned to `dates`. */
  values: (number | null)[];
}

export function RevenueTrendChart({
  dates,
  series,
  height = 220,
}: {
  dates: string[];
  series: RevenueSeries[];
  height?: number;
}) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  // Geometry. The plot is inset on the left for y-tick labels and at the bottom
  // for the date band — sizing the viewBox to the plot alone would push the
  // x-axis labels outside the card and give it a nested scrollbar.
  const W = 600;
  const H = 200;
  const PAD = { top: 12, right: 12, bottom: 24, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { min, max, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    if (all.length === 0) return { min: 0, max: 1, ticks: [] as number[] };

    // Revenue is a magnitude, so the scale starts at zero — a truncated axis
    // exaggerates movement, which on a revenue chart is a claim, not a style.
    //
    // The tick STEP is what gets rounded, not the maximum. Rounding the max to
    // a nice number and dividing by 3 produces ticks like $1.7m and $3.3m, and
    // leaves the lines crushed into the bottom of the plot when the data tops
    // out just above a power of ten. Choosing a round step and taking only as
    // many as the data needs keeps every label clean AND the plot filled.
    const hi = Math.max(...all);
    const step = niceStep(hi / 3);
    const count = Math.max(1, Math.ceil(hi / step));
    const top = step * count;
    return {
      min: 0,
      max: top,
      ticks: Array.from({ length: count + 1 }, (_, i) => i * step),
    };
  }, [series]);

  const n = dates.length;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) =>
    PAD.top + (max === min ? plotH / 2 : (1 - (v - min) / (max - min)) * plotH);

  if (n < 2) return null;

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Map client px → viewBox units, then invert the x() scale.
    const vbX = ((clientX - rect.left) / rect.width) * W;
    const ratio = (vbX - PAD.left) / plotW;
    const idx = Math.round(ratio * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, idx)));
  };

  const activeDate = active != null ? dates[active] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Revenue trend over ${n} days. ${series
          .map((s) => `${s.label}: ${formatUsdCompact(lastValue(s.values))}`)
          .join(". ")}`}
        tabIndex={0}
        onPointerMove={(e) => handleMove(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setActive((cur) => {
              const base = cur ?? n - 1;
              return Math.max(0, Math.min(n - 1, base + (e.key === "ArrowRight" ? 1 : -1)));
            });
          }
        }}
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${gradientId}-${si}`} x1="0" y1="0" x2="0" y2="1">
              {/* An area fill is a wash at ~10%, never a saturated block — the
                  line is the mark, the fill only ties it to the baseline. */}
              <stop offset="0%" stopColor={s.colour} stopOpacity="0.14" />
              <stop offset="100%" stopColor={s.colour} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Gridlines: solid hairlines one step off the surface. Never dashed —
            dashing reads as "threshold" when it is only a grid. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              y1={y(t)}
              x2={W - PAD.right}
              y2={y(t)}
              stroke="var(--color-border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9, fontVariantNumeric: "tabular-nums" }}
            >
              {formatUsdCompact(t)}
            </text>
          </g>
        ))}

        {/* Date band. Only first / middle / last are labelled — a tick per day
            would collide and go unread; the tooltip carries the rest. */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
          <text
            key={k}
            x={x(i)}
            y={H - 6}
            textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {shortDate(dates[i])}
          </text>
        ))}

        {series.map((s, si) => {
          const pts = s.values
            .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
            .filter((p): p is string => p !== null);
          if (pts.length < 2) return null;

          const line = `M ${pts.join(" L ")}`;
          const area = `${line} L ${x(n - 1).toFixed(1)},${y(min)} L ${x(0).toFixed(1)},${y(min)} Z`;

          return (
            <g key={s.label}>
              <path d={area} fill={`url(#${gradientId}-${si})`} />
              <path
                d={line}
                fill="none"
                stroke={s.colour}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* Crosshair + per-series dots at the snapped day. Each dot carries a
            2px ring in the surface colour so it stays legible where it crosses
            the other line. */}
        {active != null && (
          <g pointerEvents="none">
            <line
              x1={x(active)}
              y1={PAD.top}
              x2={x(active)}
              y2={PAD.top + plotH}
              stroke="var(--color-muted-foreground)"
              strokeWidth="1"
              strokeOpacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
            {series.map((s) => {
              const v = s.values[active];
              if (v == null) return null;
              return (
                <circle
                  key={s.label}
                  cx={x(active)}
                  cy={y(v)}
                  r="4"
                  fill={s.colour}
                  stroke="var(--color-card)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* One tooltip listing every series — the pointer never has to land on a
          line to get a value. The value leads and the label follows: the reader
          already knows which series they want, they came for the number. */}
      {active != null && activeDate && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-0 z-10 min-w-[136px] rounded-lg border border-border bg-popover p-2.5 shadow-[var(--shadow-overlay)]"
          style={{
            left: `${(x(active) / W) * 100}%`,
            transform:
              active > n / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {shortDate(activeDate)}
          </p>
          {series.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: s.colour }}
                />
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {s.values[active] == null ? "—" : formatUsdCompact(s.values[active])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}

/** Rounds a tick interval up to a clean 1/2/2.5/5×10^n so labels read as round numbers. */
function niceStep(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  // 2.5 is included because it is what turns a $2.4m maximum into $1m/$2m/$3m
  // ticks rather than thirds of a rounded-up $5m.
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
