import { api } from "@/lib/api-client";

/**
 * Typed client functions for /api/notifications (inventory §2.7, §3.2).
 *
 * In the legacy app the initial list came from the dashboard server layout and
 * the "mark read" write went straight from the browser to Postgres through the
 * Supabase client — the one user-initiated write that was not service-role
 * gated, allowed by the `notifications_update_own_read_at` RLS policy.
 *
 * With no browser database client, both halves become ordinary API calls.
 * That is a security improvement as well as a mechanical one: the RLS policy
 * restricted which ROWS a user could update but, despite its name, did NOT
 * restrict which COLUMNS — an owner could have written any field of their own
 * notification. The endpoint only accepts "mark this read".
 */

/** Wire shape. snake_case because it mirrors the columns the UI already reads. */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Scoped server-side to the caller's own rows (`notifications_select_own`). */
export function getRecentNotifications(limit = 20): Promise<NotificationRow[]> {
  return api.get<NotificationRow[]>(`/notifications?limit=${limit}`);
}

export function markNotificationRead(id: string): Promise<NotificationRow> {
  return api.patch<NotificationRow>(`/notifications/${id}/read`);
}
