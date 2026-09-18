import { useId, useState, type ReactNode } from "react";
import { Table2, LineChart as LineChartIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shared chrome every chart on this page sits in.
 *
 * Three rules from the dataviz work are enforced here rather than repeated in
 * each chart:
 *
 * 1. **Every chart has a table-view twin.** A tooltip may enhance a value but
 *    must never be the only way to read it. The toggle is part of the frame, so
 *    no chart can ship without one.
 * 2. **A legend is always present for two or more series**, and it mirrors the
 *    mark — a line-key for lines, a rect swatch for fills. Identity is never
 *    colour alone.
 * 3. **Text never wears the series colour.** The swatch beside the label is the
 *    coloured element; the label itself stays in an ink token. A 2px line of
 *    --color-series-3 is legible; 11px of text in it is not.
 */

export interface ChartSeriesKey {
  label: string;
  colour: string;
  /** Lines get a stroke key, fills get a rounded rect — mirror the mark. */
  mark?: "line" | "rect";
}

export function ChartFrame({
  title,
  subtitle,
  series,
  table,
  children,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Two or more entries render a legend. One renders none — the title names it. */
  series?: ChartSeriesKey[];
  /** The WCAG-clean equivalent of the plot. Omit only for a bare stat tile. */
  table?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <section
      className={cn(
        "flex flex-col rounded-[var(--radius)] bg-card p-5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-lg leading-tight text-foreground">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              aria-controls={panelId}
              title={showTable ? "Show chart" : "Show data table"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {showTable ? (
                <LineChartIcon className="h-3.5 w-3.5" />
              ) : (
                <Table2 className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">
                {showTable ? "Show chart" : "Show data table"}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* The legend sits directly under the title so it is read before the
          plot, not hunted for after it. */}
      {series && series.length >= 2 && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
            >
              {s.mark === "rect" ? (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: s.colour }}
                />
              ) : (
                <span
                  aria-hidden
                  className="h-0.5 w-4 shrink-0 rounded-full"
                  style={{ background: s.colour }}
                />
              )}
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div id={panelId} className="mt-4 flex-1">
        {showTable && table ? table : children}
      </div>
    </section>
  );
}

/**
 * The table twin of a plot. Kept visually quiet — it is an equivalent, not a
 * second design — and scrolls inside the card so the card never changes height
 * when the reader toggles.
 */
export function ChartTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: (string | number)[][];
  caption?: string;
}) {
  return (
    <div className="max-h-[220px] overflow-auto">
      <table className="w-full text-xs">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "px-2 py-1.5 font-medium text-muted-foreground",
                  i === 0 ? "text-left" : "text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50 last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-2 py-1.5",
                    ci === 0
                      ? "text-left text-muted-foreground"
                      : "text-right font-medium tabular-nums text-foreground",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown in place of a plot when the series has nothing to draw yet. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
