import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { kpiFeedRateLimit } from "@/lib/rate-limit";

// Session-authenticated (respects RLS) — for the Group platform to poll if
// it isn't reading the Supabase `kpi_feed` table directly. See README for the
// "Group platform contract" caveat: the actual auth model this endpoint
// should use for cross-company polling has not been confirmed yet.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await kpiFeedRateLimit.limit(`kpi-feed:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kpi_feed")
    .select("company, metric_name, value, unit, as_of_date, updated_at")
    .order("metric_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
