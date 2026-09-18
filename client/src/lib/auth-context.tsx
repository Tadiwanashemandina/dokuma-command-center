import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "@dokuma/shared";
import { setUnauthenticatedHandler } from "@/lib/api-client";
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  type LoginResult,
  type SessionUser,
} from "@/lib/api/auth";

/**
 * The current-user provider — the client-side replacement for the server-side
 * `getProfile()` call that gated `app/(dashboard)/layout.tsx`.
 *
 * In Next, every dashboard page was a server component that could read the
 * session directly before rendering. A SPA has no such moment, so the session
 * is fetched once here and shared through context; `<RequireAuth>` is what
 * turns it into a route gate.
 *
 * The user is cached by React Query under a single key, which means a
 * mutation that changes the session (completing MFA, for instance) invalidates
 * it the same way any other resource is invalidated (inventory §10, D-3).
 */

export const CURRENT_USER_KEY = ["auth", "me"] as const;

interface AuthContextValue {
  user: SessionUser | null;
  /** True only while the very first session check is in flight. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Non-null when this role still owes an MFA step (§4.4). */
  mfaNext: "enroll" | "verify" | null;
  login: (input: { email: string; password: string; next?: string }) => Promise<LoginResult>;
  logout: () => Promise<void>;
  /** Re-reads /auth/me. Called after any action that changes the session. */
  refresh: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: getCurrentUser,
    // A 401 here is a definitive "not signed in", not a transient failure.
    retry: false,
    // The session outlives a tab switch; refetching on focus would put a
    // request on every window change for data that rarely differs.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const user = data ?? null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
  }, [queryClient]);

  const login = useCallback(
    async (input: { email: string; password: string; next?: string }) => {
      const result = await loginRequest(input);
      // Seed the cache from the login response so the very next render already
      // has a user and `<RequireAuth>` does not flash its loading state.
      await queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
      return result;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Clear the cache even if the request failed: the user asked to sign
      // out, so the UI must not keep showing their data. The cookie is
      // cleared server-side either way.
      queryClient.setQueryData(CURRENT_USER_KEY, null);
      await queryClient.clear();
    }
  }, [queryClient]);

  /**
   * Any request that comes back 401 means the session expired mid-session.
   * Dropping the cached user flips `<RequireAuth>` to its redirect, which
   * sends the browser to /login with the current path as `?next=`.
   */
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.setQueryData(CURRENT_USER_KEY, null);
    });
    return () => setUnauthenticatedHandler(null);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      isAuthenticated: user !== null,
      mfaNext: user?.mfaNext ?? null,
      login,
      logout,
      refresh,
      hasRole: (...roles: UserRole[]) => (user ? roles.includes(user.role) : false),
    }),
    [user, isPending, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}
