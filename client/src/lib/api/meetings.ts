import { api } from "@/lib/api-client";
import type { Page } from "@/lib/api/types";

/** Typed client functions for /api/meetings. */

export interface ActionItemRow {
  id: string;
  description: string;
  owner_name: string | null;
  due_date: string | null;
  status: "open" | "done";
}

export interface MeetingRow {
  id: string;
  title: string;
  meeting_date: string | null;
  attendees: string[];
  source_notes: string | null;
  /** Nested by the server, matching the page's card layout. */
  action_items: ActionItemRow[];
}

export function listMeetings(
  params: { limit?: number; offset?: number } = {},
): Promise<Page<MeetingRow>> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 25));
  if (params.offset) query.set("offset", String(params.offset));
  return api.get<Page<MeetingRow>>(`/meetings?${query.toString()}`);
}
