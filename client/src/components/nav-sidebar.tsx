import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Landmark,
  ClipboardList,
  FolderKanban,
  Users,
  Wallet,
  ShieldAlert,
  Handshake,
  GitBranch,
  CalendarClock,
  UploadCloud,
  UserSquare2,
  UserCog,
  ScrollText,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from "lucide-react";
import type { UserRole } from "@dokuma/shared";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import logoCrop from "@/assets/dokuma-logo-crop.png";
import logoMark from "@/assets/dokuma-mark.png";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[]; // omit to show to everyone
};

type NavSection = {
  /** Omit on the first section — it sits directly under the brand and needs no heading. */
  label?: string;
  items: NavItem[];
};

/**
 * The sidebar is grouped rather than flat: fourteen destinations is past the
 * point where a single list can be scanned. Sections follow who owns the work
 * (group finance, delivery, the back office) rather than the order the modules
 * were built in.
 *
 * Role filtering runs per item, then any section left empty is dropped — so a
 * finance officer never sees an "Administration" heading with nothing under it.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "exec"] },
      { href: "/company", label: "Company Overview", icon: Building2, roles: ["admin", "exec"] },
    ],
  },
  {
    label: "Group Reporting",
    items: [
      { href: "/group", label: "Group Board", icon: Landmark, roles: ["admin", "exec"] },
      {
        href: "/group/capture",
        label: "Monthly Capture",
        icon: ClipboardList,
        // Wider than the board view above: finance and ops staff enter these
        // figures at month-end (Group specification §9).
        roles: ["admin", "exec", "finance_officer", "finance_manager", "hr_officer", "hr_manager"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/projects", label: "Project Portfolio", icon: FolderKanban },
      { href: "/delivery", label: "Software Delivery", icon: GitBranch },
      { href: "/meetings", label: "Meeting Intelligence", icon: CalendarClock },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/finance", label: "Finance", icon: Wallet, roles: ["admin", "exec", "finance_officer", "finance_manager"] },
      { href: "/people", label: "People & Delivery", icon: Users, roles: ["admin", "exec"] },
      {
        href: "/hr",
        label: "HR",
        icon: UserSquare2,
        roles: ["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"],
      },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/risks", label: "Risks, Issues & Decisions", icon: ShieldAlert },
      { href: "/clients", label: "Client & Stakeholder", icon: Handshake },
    ],
  },
  {
    label: "Administration",
    /**
     * The audit trail is deliberately NOT admin-only: it is oversight rather
     * than administration, and migration 0013's policy granted it to admin,
     * exec and finance_manager. The Express route enforces the same three.
     */
    items: [
      { href: "/admin/users", label: "User Management", icon: UserCog, roles: ["admin"] },
      {
        href: "/admin/audit-log",
        label: "Audit Trail",
        icon: ScrollText,
        roles: ["admin", "exec", "finance_manager"],
      },
      {
        href: "/admin/import/lazyboss-csv",
        label: "Import LazyBoss CSV",
        icon: UploadCloud,
        roles: ["admin"],
      },
    ],
  },
];

export function NavSidebar({ role }: { role: UserRole }) {
  // usePathname() -> useLocation().pathname; useRouter() -> useNavigate().
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [collapsed, setCollapsed] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      // Replaces supabase.auth.signOut(): the session is a server-side record,
      // so signing out is an API call that revokes it and clears the cookie.
      await logout();
      // router.push + router.refresh become one navigation — there is no
      // server cache to invalidate, and logout() already cleared the query
      // cache so no stale data survives the redirect.
      navigate("/login", { replace: true });
    } catch (error) {
      setSigningOut(false);
      setSignOutError(error instanceof Error ? error.message : "Could not sign out. Please try again.");
    }
  }

  return (
    <aside
      className={cn(
        "relative sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden bg-navy transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-[264px]"
      )}
    >
      {/* Diamond mesh texture — same navy hue, just a subtle overlay pattern */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, white 0, white 1px, transparent 1px, transparent 22px), repeating-linear-gradient(-45deg, white 0, white 1px, transparent 1px, transparent 22px)",
        }}
      />
      {/* Collapse toggle — floats on the sidebar's edge */}
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="absolute top-[24px] z-30 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white text-navy shadow-[0_2px_8px_rgba(13,27,62,0.18)] transition-colors hover:bg-slate-50"
        style={{ left: collapsed ? 72 : 264 }}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Brand — logo rendered white-on-navy, same technique as dokuma.co.zw's hero.
          next/image becomes a plain <img>: these are two small local PNGs that
          Vite fingerprints at build time, so there is no layout shift to guard
          against as long as the intrinsic dimensions stay declared. */}
      <div
        className={cn(
          "relative z-10 flex h-[60px] shrink-0 items-center",
          collapsed ? "justify-center px-0" : "justify-start px-6"
        )}
      >
        {collapsed ? (
          <Link to="/" className="flex h-9 w-9 shrink-0 items-center justify-center">
            <img
              src={logoMark}
              alt="Dokuma"
              width={159}
              height={159}
              className="h-full w-full object-contain brightness-0 invert"
              decoding="async"
            />
          </Link>
        ) : (
          <Link to="/" className="flex shrink-0 items-center">
            <img
              src={logoCrop}
              alt="Dokuma — Digital Consultancy"
              width={954}
              height={253}
              className="h-9 w-auto object-contain brightness-0 invert"
              decoding="async"
            />
          </Link>
        )}
      </div>

      {/* Nav */}
      {/* Spacing here is deliberately tight. Measured for an admin (the worst
          case — 15 items, 5 headings): the sidebar is ~864px, which fits a
          1080p viewport (~945px) with nothing to spare and scrolls on shorter
          laptop screens. Rows are 36px and account for ~530px of that, so any
          loosening of row padding, heading size or section gaps puts a
          scrollbar on 1080p too. Measure before changing them. */}
      <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div key={section.label ?? "primary"} className={cn(index > 0 && (collapsed ? "mt-2.5" : "mt-3.5"))}>
            {/* Collapsed, a heading has nowhere to go — a hairline keeps the
                grouping visible on the icon rail without needing the words. */}
            {section.label &&
              (collapsed ? (
                <div className="mx-auto mb-2.5 h-px w-8 bg-white/10" role="presentation" />
              ) : (
                <p className="mb-1 px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                  {section.label}
                </p>
              ))}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-teal text-navy shadow-sm shadow-teal/30"
                        : "text-white/60 hover:bg-white/[0.08] hover:text-white"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="h-[17px] w-[17px] shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {collapsed && (
                      <span className="pointer-events-none absolute left-[calc(100%+10px)] z-20 hidden whitespace-nowrap rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 group-hover:block">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      {/* The company tagline used to sit below this button; it cost ~25px that
          the nav needs more than the footer does. */}
      <div className={cn("relative z-10 shrink-0 px-3 py-2.5", collapsed && "px-0")}>
        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg bg-status-red/15 px-3.5 py-2 text-[13px] font-medium text-status-red transition-colors hover:bg-status-red/25",
            collapsed && "justify-center px-0"
          )}
          title="Sign out"
        >
          <LogOut className="h-[17px] w-[17px] shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>

      <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>You&apos;ll need to sign back in to access the command centre.</DialogDescription>
          </DialogHeader>
          {signOutError && (
            <p role="alert" className="text-sm text-status-red">
              {signOutError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSignOut(false)} disabled={signingOut}>
              Cancel
            </Button>
            <Button
              onClick={handleSignOut}
              disabled={signingOut}
              className="bg-status-red text-white hover:bg-status-red/90"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
