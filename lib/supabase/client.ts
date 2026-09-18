import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Browser client — only for client components that need it directly (e.g.
// the login form's supabase.auth.signInWithPassword call). Never used to
// fetch sensitive tables; all page data comes from server components using
// lib/supabase/server.ts instead.
export function createClient(): any {
  if (process.env.NEXT_PUBLIC_MONGODB_ONLY === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const localQuery: any = {
      update: () => localQuery,
      eq: () => localQuery,
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
    };
    return {
      auth: {
        signOut: async () => { await fetch("/api/auth/signout", { method: "POST" }); return { error: null }; },
      },
      from: () => localQuery,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => undefined,
    };
  }
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
