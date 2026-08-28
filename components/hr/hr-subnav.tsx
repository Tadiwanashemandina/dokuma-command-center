"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/hr", label: "Overview" },
  { href: "/hr/employees", label: "Employees" },
  { href: "/hr/leave", label: "Leave" },
  { href: "/hr/recruitment", label: "Recruitment", hrTierOnly: true },
  { href: "/hr/performance", label: "Performance" },
  { href: "/hr/training", label: "Training" },
];

/** `isHrTier` hides tabs an employee/supervisor would just get redirected
 * away from (recruitment has candidate PII, HR/admin/exec only) — the
 * underlying requireRole() on each page is the real security boundary. */
export function HrSubNav({ isHrTier = false }: { isHrTier?: boolean }) {
  const pathname = usePathname();
  const visibleTabs = TABS.filter((tab) => isHrTier || !tab.hrTierOnly);

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border/60 pb-px">
      {visibleTabs.map((tab) => {
        const active = tab.href === "/hr" ? pathname === "/hr" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "shrink-0 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
              active ? "border-b-2 border-teal text-navy" : "text-muted-foreground hover:text-navy"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
