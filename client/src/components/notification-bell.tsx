import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  getRecentNotifications,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/api/notifications";

export const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * The initial list was passed down from the dashboard server layout in Next.
 * Here it is a query, because there is no server render to hand it over — the
 * shell fetches it once and React Query keeps it fresh.
 *
 * Marking read is an optimistic mutation: the badge and the dimming update
 * immediately, and roll back if the request fails. The legacy component did
 * the same thing with a local `setState`, but had no rollback — a failed write
 * left the UI claiming a notification was read when the database disagreed.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => getRecentNotifications(),
    staleTime: 60_000,
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,

    async onMutate(id: string) {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<NotificationRow[]>(NOTIFICATIONS_KEY);

      queryClient.setQueryData<NotificationRow[]>(NOTIFICATIONS_KEY, (rows) =>
        (rows ?? []).map((row) =>
          row.id === id ? { ...row, read_at: new Date().toISOString() } : row,
        ),
      );

      return { previous };
    },

    onError(_error, _id, context) {
      // Put the real state back rather than leaving the badge lying.
      if (context?.previous) {
        queryClient.setQueryData(NOTIFICATIONS_KEY, context.previous);
      }
    },

    onSettled() {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
        >
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
        {notifications.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">No notifications yet.</div>
        )}
        {notifications.map((n) => (
          <DropdownMenuItem
            key={n.id}
            asChild
            onClick={() => {
              if (!n.read_at) markRead.mutate(n.id);
            }}
          >
            <Link
              to={n.link ?? "#"}
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
