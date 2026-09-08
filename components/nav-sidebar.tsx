"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  const items = [...NAV_ITEMS, ADMIN_ITEM].filter((item) => !item.roles || item.roles.includes(role));

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-navy text-white">
      <div className="px-6 py-6">
        <div className="inline-block rounded-xl bg-white px-3 py-2">
          <Image src="/dokuma-logo.jpg" alt="Dokuma" width={601} height={280} className="h-6 w-auto" priority />
        </div>
        <p className="mt-2 font-serif text-sm font-medium text-white/80">Command Centre</p>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-white/10 text-teal font-medium"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-6 py-4 text-xs text-white/40">Dokuma (Private) Limited</div>
    </aside>
  );
}
