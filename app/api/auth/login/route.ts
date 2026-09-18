import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { email, password, next = "/" } = await request.json();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await loginRateLimit.limit(`login:${ip}`);

  if (!success) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const client = await createClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email ?? ""),
    password: String(password ?? ""),
  });

  if (error || !data.session?.access_token) {
    return NextResponse.json({ error: error?.message ?? "Invalid login credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ next });
  response.cookies.set("dokuma_local_session", data.session.access_token, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "strict",
  });

  return response;
}
