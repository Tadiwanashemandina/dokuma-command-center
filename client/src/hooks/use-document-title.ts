import { useEffect } from "react";

const BASE_TITLE = "Dokuma Command Centre";

/**
 * Per-route document titles — the runtime half of what Next's `metadata`
 * export did per segment (inventory §2.7).
 *
 * Next set titles during server rendering; a SPA sets them on navigation.
 * The base title stays in index.html so the first paint and a hard refresh
 * both show something correct before React mounts.
 *
 * Pass `null` to leave the base title alone.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;

    const previous = document.title;
    document.title = `${title} · ${BASE_TITLE}`;

    // Restore on unmount so an unmounting route cannot leave its title behind
    // if the next one has none of its own.
    return () => {
      document.title = previous;
    };
  }, [title]);
}
