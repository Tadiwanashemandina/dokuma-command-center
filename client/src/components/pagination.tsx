import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The pager every list page shares.
 *
 * The API has returned `{ items, total, limit, offset }` from the start — the
 * pages simply asked for `limit=200` and rendered everything, which works
 * until a table has more rows than that and then silently truncates. This
 * makes the bound visible and navigable.
 *
 * Renders nothing when everything already fits on one page, so a short list
 * does not carry dead controls.
 */
export function Pagination({
  total,
  limit,
  offset,
  onChange,
  label = "rows",
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  /** Plural noun for the count, e.g. "projects". */
  label?: string;
}) {
  if (total <= limit) return null;

  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 px-1"
      aria-label={`${label} pagination`}
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-navy">{from}–{to}</span> of{" "}
        <span className="font-medium text-navy">{total}</span> {label}
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** The page size every list uses, unless it has a reason not to. */
export const PAGE_SIZE = 25;
