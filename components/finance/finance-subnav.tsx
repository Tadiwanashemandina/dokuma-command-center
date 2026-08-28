"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/transactions", label: "Transactions" },
  { href: "/finance/reports", label: "Reports" },
  { href: "/finance/creditors", label: "Creditors" },
  { href: "/finance/payment-notices", label: "Payment Notices" },
  { href: "/finance/import", label: "Import" },
];

export function FinanceSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border/60 pb-px">
      {TABS.map((tab) => {
        const active = tab.href === "/finance" ? pathname === "/finance" : pathname.startsWith(tab.href);
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
