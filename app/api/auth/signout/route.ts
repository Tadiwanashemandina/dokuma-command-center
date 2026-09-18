import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const client = await createClient();
  await client.auth.signOut();
  return NextResponse.json({ ok: true });
}