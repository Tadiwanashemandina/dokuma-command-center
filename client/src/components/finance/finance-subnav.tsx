import { NavLink } from "react-router-dom";
import { FINANCE_WRITE, FINANCE_APPROVE } from "@dokuma/shared";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

/**
 * The finance section's sub-navigation.
 *
 * "Import" is gated on FINANCE_WRITE rather than shown to everyone, because the
 * import routes are `requireRole(FINANCE_WRITE)` server-side. The legacy app
 * rendered every link for every finance-reader and let the 403 explain itself
 * on arrival; a link that exists only to fail is worse than no link, so the
 * membership test here is the same array the server checks.
 *
 * Read access itself is enforced by the route guard, not here — this component
 * assumes it is only mounted for a role that may see the section at all.
 */

interface SubnavLink {
  to: string;
  label: string;
  /** The tier that may see this link. Omitted means every finance reader. */
  tier?: "write" | "approve";
}

const LINKS: SubnavLink[] = [
  { to: "/finance", label: "Overview" },
  { to: "/finance/transactions", label: "Transactions" },
  { to: "/finance/creditors", label: "Creditors" },
  { to: "/finance/payment-notices", label: "Payment Notices" },
  { to: "/finance/reports", label: "Reports" },
  { to: "/finance/import", label: "Import", tier: "write" },
  /**
   * Xero is approve-tier, not read-tier, even though `/api/xero/status` is
   * readable by anyone in FINANCE_READ. Every control on that page — connect,
   * sync, push, disconnect — is `requireRole(FINANCE_APPROVE)`, so for a
   * finance_officer the page is a status display whose every button is
   * inert. Showing them the tab would be an invitation to a dead end.
   */
  { to: "/finance/xero", label: "Xero", tier: "approve" },
];

export function FinanceSubnav() {
  const { user } = useAuth();
  const canWrite = user !== null && FINANCE_WRITE.includes(user.role);
  const canApprove = user !== null && FINANCE_APPROVE.includes(user.role);

  const visible = LINKS.filter((link) => {
    if (link.tier === "write") return canWrite;
    if (link.tier === "approve") return canApprove;
    return true;
  });

  return (
    <nav
      aria-label="Finance sections"
      className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
    >
      {visible.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          // `end` on the overview only: without it, "/finance" would stay
          // highlighted on every child route and two tabs would read active.
          end={link.to === "/finance"}
          className={({ isActive }) =>
            cn(
              "-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
