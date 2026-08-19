import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Browser client — only for client components that need it directly (e.g.
// the login form's supabase.auth.signInWithPassword call). Never used to
// fetch sensitive tables; all page data comes from server components using
// lib/supabase/server.ts instead.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
