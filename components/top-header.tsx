"use client";

import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Profile } from "@/lib/supabase/server";

const SECTION_LABELS: Record<string, string> = {
  "": "ceo-home",
  company: "company-overview",
  projects: "project-portfolio",
  people: "people-and-delivery",
  finance: "finance",
  risks: "risks-issues-decisions",
  clients: "clients",
  delivery: "software-delivery",
  meetings: "meeting-intelligence",
  admin: "admin",
};

export function TopHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  const section = SECTION_LABELS[segment] ?? segment;

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
      <span className="font-mono text-sm text-muted-foreground">
        command.dokuma.internal/<span className="text-navy">{section}</span>
      </span>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{profile.full_name ?? "Signed in"}</span>
        <Badge className="rounded-full bg-gold/15 text-gold hover:bg-gold/15">{profile.role}</Badge>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
