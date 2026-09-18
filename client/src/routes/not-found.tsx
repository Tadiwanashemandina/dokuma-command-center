import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Replaces Next's `notFound()` / not-found.tsx for unmatched dashboard paths.
 *
 * Rendered inside the dashboard shell, so the sidebar stays available and a
 * mistyped URL does not strand the user on a bare page.
 */
export function NotFoundPage() {
  useDocumentTitle("Page not found");
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 font-serif text-2xl font-semibold text-navy">Page not found</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Button asChild className="mt-6 rounded-xl bg-navy hover:bg-navy/90">
        {/* `homePath` is the server's roleHomePath(role), so this lands
            somewhere this particular role can actually go. */}
        <Link to={user?.homePath ?? "/"}>Back to your dashboard</Link>
      </Button>
    </div>
  );
}
