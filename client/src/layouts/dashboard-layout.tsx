import { Outlet } from "react-router-dom";
import { NavSidebar } from "@/components/nav-sidebar";
import { TopHeader } from "@/components/top-header";
import { useAuth } from "@/lib/auth-context";

/**
 * Replaces `app/(dashboard)/layout.tsx` (inventory §2.7).
 *
 * The Next version was an async server component: it awaited `getProfile()`,
 * redirected to /login on a miss, then loaded notifications before rendering.
 * Here the redirect is `<RequireAuth>`, which wraps this layout in the route
 * tree, so by the time this renders a user is guaranteed — the non-null
 * assertion below is safe for exactly that reason, and is the only place the
 * guard's contract is relied on.
 *
 * Markup and classes are unchanged from the original.
 */
export function DashboardLayout() {
  const { user } = useAuth();

  // `<RequireAuth>` renders its loading state until the session resolves and
  // redirects when there is none, so this branch is unreachable in practice.
  // It exists so a future route-tree change cannot turn a mistake into a crash.
  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f8fb]">
      <NavSidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader user={user} />
        <main className="flex-1 overflow-y-auto px-5 py-7 sm:px-8 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
