import type { CookieOptions } from "@supabase/ssr";

/**
 * Layered on top of (never replacing) @supabase/ssr's own cookie options.
 * The library defaults to `sameSite: 'lax', httpOnly: false`, no `secure`
 * flag at all — see SECURITY.md for why `httpOnly` deliberately stays
 * `false` (the browser client needs to read the session cookie for
 * signInWithPassword, sign-out, and the Finance realtime subscription).
 * `secure` and `sameSite` have no such trade-off, so they're hardened here.
 */
export function hardenCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  };
}
