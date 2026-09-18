import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api-client";

/**
 * The three states a server-rendered page never had to show.
 *
 * In Next these pages were async server components: data was already there
 * when the markup rendered, so there was no loading state, no error state and
 * no retry. A SPA has all three, and Prompt 6 requires each one — so they live
 * here rather than being reinvented per page.
 */

/** A table-shaped loading placeholder. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className="h-5 flex-1"
              // Vary the widths a little so it reads as content rather than a
              // block of identical bars.
              style={{ maxWidth: column === 0 ? "28%" : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * An error with a retry.
 *
 * A 403 is phrased as an access problem rather than a failure, because
 * retrying will not help — the role is simply not permitted, and offering a
 * retry button there is misleading.
 */
export function QueryError({
  error,
  onRetry,
  resource = "this data",
}: {
  error: unknown;
  onRetry?: () => void;
  resource?: string;
}) {
  const isForbidden = error instanceof ApiRequestError && error.isForbidden;

  const message = isForbidden
    ? `You do not have access to ${resource}.`
    : error instanceof Error
      ? error.message
      : `Could not load ${resource}.`;

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-white/60 px-6 py-10 text-center"
    >
      <AlertTriangle className="h-7 w-7 text-status-amber" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-navy">
          {isForbidden ? "Access denied" : `Could not load ${resource}`}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && !isForbidden && (
        <Button variant="outline" size="sm" className="rounded-xl" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Nothing to show — distinct from "still loading" and from "failed". */
export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-navy">{message}</p>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * A KPI-card-shaped placeholder.
 *
 * Matches the real card's geometry — dot, eyebrow, figure, footer row — so the
 * layout does not reflow when data lands. A generic grey rectangle makes the
 * page jump the moment it is replaced, which is the thing that reads as cheap.
 */
export function KpiCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius)] bg-card p-5 shadow-[var(--shadow-card)]"
          aria-hidden="true"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-1.5 w-1.5 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          {/* The figure's real height, so the card does not grow on load. */}
          <Skeleton className="mt-3 h-[30px] w-20" />
          <div className="mt-4 flex items-end justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </>
  );
}
