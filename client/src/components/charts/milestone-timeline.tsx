import { Link } from "react-router-dom";
import { cn, formatDate } from "@/lib/utils";
import type { UpcomingMilestone } from "@/lib/api/dashboard";

/**
 * Upcoming milestones positioned on a shared time axis.
 *
 * Not a gantt: `UpcomingMilestone` carries a `due_date` and no start date, so
 * every bar's left edge would be invented. Drawing one anyway would state a
 * duration the data does not contain. What the data does support is *when* each
 * milestone lands relative to today and to the others — so each milestone is a
 * point on a common axis, with a connector back to today's line that encodes
 * lead time rather than a fabricated duration.
 *
 * The axis is shared by every row, which is the whole point: clustering is
 * visible (three milestones landing the same week is the thing an executive
 * needs to see) in a way a sorted list cannot show.
 */

const DAY_MS = 86_400_000;

export function MilestoneTimeline({ milestones }: { milestones: UpcomingMilestone[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = milestones
    .map((m) => {
      if (!m.due_date) return null;
      const due = new Date(m.due_date);
      if (Number.isNaN(due.getTime())) return null;
      due.setHours(0, 0, 0, 0);
      return { m, due, days: Math.round((due.getTime() - today.getTime()) / DAY_MS) };
    })
    .filter((r): r is { m: UpcomingMilestone; due: Date; days: number } => r !== null)
    .sort((a, b) => a.days - b.days);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No dated milestones upcoming.</p>;
  }

  // The axis spans today → the furthest milestone, with a minimum of two weeks
  // so a single near-term milestone does not stretch to fill the full width and
  // read as "far away".
  const maxDays = Math.max(14, ...rows.map((r) => r.days));
  const minDays = Math.min(0, ...rows.map((r) => r.days));
  const span = maxDays - minDays || 1;
  const pos = (days: number) => ((days - minDays) / span) * 100;

  const todayPos = pos(0);

  const toneFor = (r: (typeof rows)[number]) => {
    if (r.m.status === "done") return "done";
    if (r.days < 0) return "overdue";
    if (r.m.status === "at_risk") return "at_risk";
    if (r.days <= 7) return "soon";
    return "normal";
  };

  const colourFor = (tone: string) =>
    tone === "overdue" || tone === "at_risk"
      ? "var(--color-status-red)"
      : tone === "soon"
        ? "var(--color-status-amber)"
        : tone === "done"
          ? "var(--color-status-green)"
          : "var(--color-series-1)";

  return (
    <div>
      {/* Axis header. The "Today" label is pinned to the same position as the
          dotted rule below it — anchoring it to the left edge instead would
          label the axis start "Today" even when overdue milestones push the
          axis to begin days earlier. */}
      <div className="relative mb-2 ml-[calc(40%+0.75rem)] mr-[86px] h-4 text-[10px] text-muted-foreground">
        {minDays < 0 && (
          <span className="absolute left-0 -translate-x-1/2">
            {Math.abs(minDays)}d ago
          </span>
        )}
        <span
          className="absolute -translate-x-1/2 font-medium"
          style={{ left: `${todayPos}%` }}
        >
          Today
        </span>
        <span className="absolute right-0 translate-x-1/2">in {maxDays}d</span>
      </div>

      <ul className="space-y-1">
        {rows.map((r) => {
          const tone = toneFor(r);
          const colour = colourFor(tone);
          const left = pos(r.days);

          return (
            <li key={r.m.id}>
              <Link
                to="/projects"
                className="group flex items-center gap-3 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="w-[40%] shrink-0 truncate">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {r.m.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {r.m.project_name ?? "Company-wide"}
                  </span>
                </span>

                <span className="relative h-5 flex-1">
                  {/* Today's rule, drawn on every row so it reads as one
                      continuous line down the chart. */}
                  <span
                    aria-hidden
                    className="absolute top-0 h-full border-l border-dotted border-border"
                    style={{ left: `${todayPos}%` }}
                  />

                  {/* The connector encodes lead time from today to the due
                      date — a real quantity — rather than a duration we do not
                      have. */}
                  <span
                    aria-hidden
                    className="absolute top-1/2 h-px -translate-y-1/2 opacity-40"
                    style={{
                      left: `${Math.min(todayPos, left)}%`,
                      width: `${Math.abs(left - todayPos)}%`,
                      background: colour,
                    }}
                  />

                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-transform group-hover:scale-125"
                    style={{ left: `${left}%`, background: colour }}
                    title={`${r.m.name} — ${formatDate(r.m.due_date)}`}
                  />
                </span>

                <span
                  className={cn(
                    "w-[74px] shrink-0 text-right text-[11px] tabular-nums",
                    tone === "overdue" || tone === "at_risk"
                      ? "font-medium text-status-red"
                      : "text-muted-foreground",
                  )}
                >
                  {r.days < 0
                    ? `${Math.abs(r.days)}d over`
                    : r.days === 0
                      ? "Today"
                      : `in ${r.days}d`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
