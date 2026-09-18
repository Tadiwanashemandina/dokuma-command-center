import { Construction } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Stands in for a route whose Express endpoints do not exist yet.
 *
 * The shell, the navigation, the role gate and the URL are all real — only the
 * data layer is missing. Saying so plainly is better than an empty page or a
 * spinner that never resolves, and it keeps the route tree honest about what
 * is actually migrated.
 *
 * Each of these is replaced by the real page as its domain's API lands.
 */
export function PlaceholderPage({ title }: { title: string }) {
  useDocumentTitle(title);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-navy">{title}</h1>

      <div className="mt-6 rounded-2xl border border-dashed border-border bg-white/60 px-6 py-10 text-center">
        <Construction className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-navy">Not migrated yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          This screen&apos;s layout, navigation and access rules are in place. Its data still comes
          from the legacy Next.js app and moves across once the matching API endpoints are built.
        </p>
      </div>
    </div>
  );
}
