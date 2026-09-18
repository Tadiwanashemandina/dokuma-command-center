import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import type { RiskRow } from "@/lib/api/risks";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * The open critical risks, as rows a reader can act on.
 *
 * "Critical blockers: 6" tells the CEO a number; it does not tell them which
 * six, who owns them, or what is overdue. This panel is the difference between
 * a dashboard that reports and one that can be worked from.
 *
 * Severity is shown as a word, never as colour alone — green and amber are only
 * ΔE 5.7 apart under protanopia, so the text carries the meaning and the hue
 * merely reinforces it.
 */

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-status-red/10 text-status-red border-status-red/25",
  high: "bg-status-amber/10 text-[#8A6414] border-status-amber/30",
  medium: "bg-steel/10 text-steel border-steel/25",
  low: "bg-muted text-muted-foreground border-border",
};

export function CriticalRiskList({
  risks,
  isPending,
}: {
  risks: RiskRow[];
  isPending?: boolean;
}) {
  if (isPending) {
    return (
      <ul className="divide-y divide-border" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <div className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (risks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <ShieldAlert className="h-7 w-7 text-status-green/60" />
        <p className="text-sm font-medium text-navy">No open critical risks</p>
        <p className="text-xs text-muted-foreground">
          Nothing is currently flagged critical across the portfolio.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ul className="divide-y divide-border">
      {risks.map((r) => {
        // An overdue date is the single most actionable fact in the row, so it
        // is called out rather than left for the reader to compare against today.
        const overdue = r.due_date != null && r.due_date < today;

        return (
          <li key={r.id}>
            <Link
              to="/risks"
              className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  SEVERITY_STYLE[r.severity ?? "low"],
                )}
              >
                {r.severity ?? "low"}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-navy">
                  {r.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {r.project_name ?? "Company-wide"}
                  {r.owner_name && <> · {r.owner_name}</>}
                </span>
              </span>

              {r.due_date && (
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    overdue ? "font-semibold text-status-red" : "text-muted-foreground",
                  )}
                >
                  {overdue ? "Overdue " : ""}
                  {formatDate(r.due_date)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
