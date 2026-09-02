"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/utils";
import type { NotificationRow } from "@/lib/notifications/get";

/** Initial list comes entirely from the server (see (dashboard)/layout.tsx)
 * — the only client-side call this component makes is marking a
 * notification read on click, scoped to the caller's own rows by RLS
 * (notifications_update_own_read_at). Same narrow exception pattern as the
 * Finance Cash Position panel: no client-side fetch of the initial data. */
export function NotificationBell({ initialNotifications }: { initialNotifications: NotificationRow[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-status-red text-[10px] font-medium text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="font-serif text-navy">Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No notifications yet.</div>}
        {notifications.map((n) => (
          <DropdownMenuItem key={n.id} asChild onClick={() => !n.read_at && markRead(n.id)}>
            <Link
              href={n.link ?? "#"}
              className={`flex flex-col items-start gap-0.5 whitespace-normal py-2 ${n.read_at ? "opacity-60" : ""}`}
            >
              <span className="text-sm font-medium text-navy">{n.title}</span>
              {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[10px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
