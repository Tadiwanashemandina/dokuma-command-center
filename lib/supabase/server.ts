import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import type { Database, UserRole } from "@/types/database.types";
import { hardenCookieOptions } from "./cookie-options";
import { MFA_REQUIRED_ROLES, getAssuranceLevel, hasVerifiedTotpFactor } from "./mfa";

// Cookie-session client — respects RLS, used by every server component/page.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, hardenCookieOptions(options))
            );
          } catch {
            // Called from a Server Component during a static render — the
            // middleware refreshes the session on the next request instead.
          }
        },
      },
    }
  );
}

// Service-role client — bypasses RLS. Server-only, never imported by client
// components. Used by every write path in the app (LazyBoss import,
// Finance, HR) after an app-level requireRole() check — confirmed via a
// repo-wide grep before this security pass that no "use client" file
// references this function or SUPABASE_SERVICE_ROLE_KEY, directly or
// transitively.
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );
}

export type Profile = { id: string; full_name: string | null; role: UserRole };

// Cached per-request so pages/layouts can call this repeatedly for free.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  return profile ? { ...profile, role: profile.role as UserRole } : null;
});

// Redirects home if the signed-in user's role isn't in the allowed list.
// Call at the top of any restricted page, before querying its data.
export async function requireRole(allowed: UserRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!allowed.includes(profile.role)) redirect("/");

  // Finance/HR sessions must reach AAL2 (MFA-verified) before proceeding —
  // admin/exec are intentionally excluded from this gate.
  if (MFA_REQUIRED_ROLES.includes(profile.role)) {
    const supabase = await createClient();
    if ((await getAssuranceLevel(supabase)) !== "aal2") {
      const verified = await hasVerifiedTotpFactor(supabase);
      redirect(verified ? "/account/mfa/verify" : "/account/mfa/enroll");
    }
  }

  return profile;
}
