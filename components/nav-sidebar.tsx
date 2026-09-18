"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  FolderKanban,
  Users,
  Wallet,
  ShieldAlert,
  Handshake,
  GitBranch,
  CalendarClock,
  UploadCloud,
  UserSquare2,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/types/database.types";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[]; // omit to show to everyone
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "CEO Home", icon: LayoutDashboard, roles: ["admin", "exec"] },
  { href: "/company", label: "Company Overview", icon: Building2, roles: ["admin", "exec"] },
  { href: "/projects", label: "Project Portfolio", icon: FolderKanban },
  { href: "/people", label: "People & Delivery", icon: Users, roles: ["admin", "exec"] },
  { href: "/finance", label: "Finance", icon: Wallet, roles: ["admin", "exec", "finance_officer", "finance_manager"] },
  {
    href: "/hr",
    label: "HR",
    icon: UserSquare2,
    roles: ["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"],
  },
  { href: "/risks", label: "Risks, Issues & Decisions", icon: ShieldAlert },
  { href: "/clients", label: "Client & Stakeholder", icon: Handshake },
  { href: "/delivery", label: "Software Delivery", icon: GitBranch },
  { href: "/meetings", label: "Meeting Intelligence", icon: CalendarClock },
];

const ADMIN_ITEM: NavItem = {
  href: "/admin/import/lazyboss-csv",
  label: "Import LazyBoss CSV",
  icon: UploadCloud,
  roles: ["admin"],
};

export function NavSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const items = [...NAV_ITEMS, ADMIN_ITEM].filter((item) => !item.roles || item.roles.includes(role));

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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
        className="absolute top-[30px] z-30 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white text-navy shadow-[0_2px_8px_rgba(13,27,62,0.18)] transition-colors hover:bg-slate-50"
        style={{ left: collapsed ? 72 : 264 }}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Brand — logo rendered white-on-navy, same technique as dokuma.co.zw's hero */}
      <div
        className={cn(
          "relative z-10 flex h-[72px] shrink-0 items-center",
          collapsed ? "justify-center px-0" : "justify-start px-6"
        )}
      >
        {collapsed ? (
          <Link href="/" className="flex h-9 w-9 shrink-0 items-center justify-center">
            <Image
              src="/dokuma-mark.png"
              alt="Dokuma"
              width={159}
              height={159}
              className="h-full w-full object-contain brightness-0 invert"
              priority
            />
          </Link>
        ) : (
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/dokuma-logo-crop.png"
              alt="Dokuma — Digital Consultancy"
              width={954}
              height={253}
              className="h-9 w-auto object-contain brightness-0 invert"
              priority
            />
          </Link>
        )}
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-all",
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
      </nav>

      {/* Footer */}
      <div className={cn("relative z-10 shrink-0 px-3 py-3", collapsed && "px-0")}>
        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl bg-status-red/15 px-3.5 py-2.5 text-[13.5px] font-medium text-status-red transition-colors hover:bg-status-red/25",
            collapsed && "justify-center px-0"
          )}
          title="Sign out"
        >
          <LogOut className="h-[17px] w-[17px] shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
        {!collapsed && (
          <p className="mt-3 truncate px-2 text-[11px] text-white/30">Dokuma (Private) Limited</p>
        )}
      </div>

      <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>You&apos;ll need to sign back in to access the command centre.</DialogDescription>
          </DialogHeader>
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
