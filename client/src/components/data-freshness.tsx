import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Data as of 10:42" with a manual refresh.
 *
 * A dashboard that never says when it was last read forces the reader to guess
 * whether they are looking at live figures or at a tab they left open on
 * Friday. That guess is the difference between acting on a number and going to
 * ask someone to confirm it — so the timestamp is not decoration, it is what
 * makes the figures usable.
 *
 * The dot is green only while the data is actually current. It is driven by
 * `isFetching`, so it reports what the app is doing rather than animating on a
 * timer, which would be theatre.
 */
export function DataFreshness({
  updatedAt,
  isFetching = false,
  onRefresh,
  tone = "light",
  className,
}: {
  /** React Query's `dataUpdatedAt` — 0 before the first successful load. */
  updatedAt: number | undefined;
  isFetching?: boolean;
  onRefresh?: () => void;
  /** `dark` inverts the text for use on the navy command deck. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const label = updatedAt
    ? new Date(updatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs",
        tone === "dark" ? "text-white/50" : "text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isFetching ? "bg-gold" : "bg-status-green",
        )}
      />
      <span className="tabular-nums">
        {isFetching ? "Refreshing…" : label ? `Data as of ${label}` : "Loading…"}
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className={cn(
            "rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:opacity-40",
            tone === "dark"
              ? "text-white/50 hover:bg-white/10 hover:text-white"
              : "text-muted-foreground hover:bg-muted hover:text-navy",
          )}
          aria-label="Refresh dashboard data"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </button>
      )}
    </div>
  );
}
