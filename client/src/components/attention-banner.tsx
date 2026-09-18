import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The page's first line: what needs the CEO today.
 *
 * A dashboard that opens with nine equally-weighted numbers makes the reader do
 * the triage themselves — scan every tile, remember which thresholds matter,
 * decide what is wrong. That work is deterministic, so the page should do it.
 *
 * This states the conclusion and links to it. When nothing is wrong it says so
 * plainly rather than disappearing: an explicit "nothing needs attention" is
 * information, whereas an absent banner is indistinguishable from a page that
 * failed to load.
 */

export interface AttentionItem {
  label: string;
  count: number;
  href: string;
  /** `critical` is reserved for things that are actively going wrong. */
  tone: "critical" | "warning";
}

export function AttentionBanner({
  items,
  isPending,
}: {
  items: AttentionItem[];
  isPending?: boolean;
}) {
  if (isPending) {
    return <div className="h-[72px] animate-pulse rounded-[var(--radius)] bg-muted/60" />;
  }

  const live = items.filter((i) => i.count > 0);

  if (live.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-status-green/25 bg-status-green/5 px-5 py-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-status-green" />
        <p className="text-sm text-navy">
          <span className="font-semibold">Nothing needs your attention.</span>{" "}
          <span className="text-muted-foreground">
            No critical blockers, overdue tasks or high-risk projects.
          </span>
        </p>
      </div>
    );
  }

  const worst = live.some((i) => i.tone === "critical") ? "critical" : "warning";

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border px-5 py-4",
        worst === "critical"
          ? "border-status-red/25 bg-status-red/5"
          : "border-status-amber/30 bg-status-amber/5",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle
            className={cn(
              "h-5 w-5 shrink-0",
              worst === "critical" ? "text-status-red" : "text-status-amber",
            )}
          />
          <p className="text-sm font-semibold text-navy">
            {live.length === 1
              ? "One area needs your attention"
              : `${live.length} areas need your attention`}
          </p>
        </div>

        {/* Each item is its own link: the reader goes straight to the thing
            rather than to a page where they must find it again. */}
        <div className="flex flex-wrap items-center gap-2">
          {live.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className={cn(
                "group inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2",
                item.tone === "critical"
                  ? "border-status-red/30 text-status-red hover:bg-status-red/5"
                  : "border-status-amber/40 text-[#8A6414] hover:bg-status-amber/5",
              )}
            >
              <span className="tabular-nums">{item.count}</span>
              <span className="text-navy/70">{item.label}</span>
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
