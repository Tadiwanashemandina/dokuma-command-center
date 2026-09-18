"use client";

import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "@/components/notification-bell";
import type { Profile } from "@/lib/supabase/server";
import type { NotificationRow } from "@/lib/notifications/get";

const SECTION_LABELS: Record<string, string> = {
  "": "ceo-home",
  company: "company-overview",
  projects: "project-portfolio",
  people: "people-and-delivery",
  hr: "hr",
  finance: "finance",
  risks: "risks-issues-decisions",
  clients: "clients",
  delivery: "software-delivery",
  meetings: "meeting-intelligence",
  admin: "admin",
};

export function TopHeader({ profile, notifications }: { profile: Profile; notifications: NotificationRow[] }) {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  const section = SECTION_LABELS[segment] ?? segment;

  return (
    <header className="sticky top-0 z-20 flex h-[72px] shrink-0 items-center justify-between border-b border-border/70 bg-white/95 px-6 backdrop-blur sm:px-8">
      <span className="font-mono text-[11px] tracking-wide text-muted-foreground/70">
        command.dokuma.internal/<span className="font-medium text-navy">{section}</span>
      </span>
      <div className="flex items-center gap-3 sm:gap-4">
        <NotificationBell initialNotifications={notifications} />
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="hidden items-center gap-2.5 sm:flex">
          <span className="text-sm font-medium text-navy">{profile.full_name ?? "Signed in"}</span>
          <Badge className="rounded-full bg-gold/15 text-[11px] font-medium text-gold hover:bg-gold/15">
            {profile.role}
          </Badge>
        </div>
      </div>
    </header>
  );
}
