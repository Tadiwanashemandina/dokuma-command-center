import { useLocation } from "react-router-dom";
import type { CurrentUser } from "@dokuma/shared";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "@/components/notification-bell";

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

/**
 * The notification list is no longer a prop: `NotificationBell` fetches it
 * itself, because there is no server layout to pass it down from.
 */
export function TopHeader({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  const section = SECTION_LABELS[segment] ?? segment;

  return (
    <header className="sticky top-0 z-20 flex h-[72px] shrink-0 items-center justify-between border-b border-border/70 bg-white/95 px-6 backdrop-blur sm:px-8">
      <span className="font-mono text-[11px] tracking-wide text-muted-foreground/70">
        command.dokuma.internal/<span className="font-medium text-navy">{section}</span>
      </span>
      <div className="flex items-center gap-3 sm:gap-4">
        <NotificationBell />
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="hidden items-center gap-2.5 sm:flex">
          <span className="text-sm font-medium text-navy">{user.fullName ?? "Signed in"}</span>
          <Badge className="rounded-full bg-gold/15 text-[11px] font-medium text-gold hover:bg-gold/15">
            {user.role}
          </Badge>
        </div>
      </div>
    </header>
  );
}
