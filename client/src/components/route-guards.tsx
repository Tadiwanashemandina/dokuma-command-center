import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { UserRole } from "@dokuma/shared";
import { useAuth } from "@/lib/auth-context";

/**
 * Protected route boundaries — the client half of what `middleware.ts`,
 * `app/(dashboard)/layout.tsx`'s `getProfile()` redirect, and `requireRole()`
 * did (inventory §2.7, §4.4).
 *
 * These are a NAVIGATION concern, not an authorization one. Every rule here is
 * enforced again in Express before any query runs; a user who edits their way
 * past a guard reaches an endpoint that returns 403. What these do is keep the
 * browser from rendering a page that would only show errors — exactly the role
 * the Next redirects played.
 */

/** Shown while the session bootstrap is in flight. */
function AuthPending() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#f6f8fb]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-steel/25 border-t-steel"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Requires a session. Unauthenticated visitors go to /login carrying the path
 * they wanted, which preserves the `?next=` behavior the login page already
 * implements.
 */
export function RequireAuth() {
  const { isAuthenticated, isLoading, mfaNext } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthPending />;

  if (!isAuthenticated) {
    const next = `${location.pathname}${location.search}`;
    // `replace` so the protected URL does not sit in history behind /login —
    // otherwise Back lands on it again and bounces straight back.
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  /**
   * MFA gate (§4.4). Finance/HR roles hold a session that is authenticated but
   * not yet verified; they may reach only the MFA screens until they clear the
   * challenge. The server decides which step is outstanding — the client just
   * follows `mfaNext` rather than recomputing the rule.
   */
  if (mfaNext !== null && !location.pathname.startsWith("/account/mfa")) {
    return <Navigate to={`/account/mfa/${mfaNext}`} replace />;
  }

  return <Outlet />;
}

/**
 * Requires one of `roles`. Mirrors `requireRole()`, including its redirect
 * rather than a 403 page: the legacy behavior sent a non-permitted role to
 * their own home route, and that is what users are used to.
 */
export function RequireRole({ roles }: { roles: readonly UserRole[] }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthPending />;

  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (!roles.includes(user.role)) {
    // `homePath` comes from the server's `roleHomePath(role)`, so the client
    // never reimplements that mapping — including the deliberate quirk that
    // `viewer` falls through to /projects (inventory §10, D-14).
    return <Navigate to={user.homePath} replace />;
  }

  return <Outlet />;
}

/**
 * The inverse guard, for /login: an already-signed-in user who navigates to
 * the login page is sent to their home route instead of being shown a form
 * that would immediately redirect anyway.
 */
export function RedirectIfAuthenticated() {
  const { user, isLoading, mfaNext } = useAuth();

  if (isLoading) return <AuthPending />;

  if (user) {
    // An outstanding MFA step outranks the home route.
    return <Navigate to={mfaNext ? `/account/mfa/${mfaNext}` : user.homePath} replace />;
  }

  return <Outlet />;
}
