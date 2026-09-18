"use server";

import { headers } from "next/headers";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginRateLimit } from "@/lib/rate-limit";
import { hardenCookieOptions } from "@/lib/supabase/cookie-options";

export type LoginResult = { error?: string; success?: boolean; next?: string };

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await loginRateLimit.limit(`login:${ip}`);
  if (!success) {
    return { error: "Too many sign-in attempts. Please wait a minute and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  if (process.env.MONGODB_ONLY === "true" && data.session?.access_token) {
    (await cookies()).set(
      "dokuma_local_session",
      data.session.access_token,
      hardenCookieOptions({ httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 7 })
    );
  }

  return { success: true, next };
}
