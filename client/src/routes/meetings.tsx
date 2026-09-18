import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, QueryError } from "@/components/query-states";
import { formatDate } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { listMeetings } from "@/lib/api/meetings";
import { PAGE_SIZE, Pagination } from "@/components/pagination";

/**
 * Ported from `app/(dashboard)/meetings/page.tsx`.
 *
 * Action items arrive nested under their meeting. The legacy page asked for
 * them with a `meeting_action_items(*)` joined select, which the Mongo shim
 * drops — so every meeting renders with no action items in the current
 * working tree.
 */
export function MeetingsPage() {
  useDocumentTitle("Meeting Intelligence");

  const [offset, setOffset] = useState(0);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["meetings", offset],
    queryFn: () => listMeetings({ limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  const meetings = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Meeting Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Action items extracted from recent meetings, with owner and due date.
        </p>
      </div>

      {isPending && (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading meetings…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="rounded-2xl">
              <CardHeader>
                <Skeleton className="h-5 w-64" />
                <Skeleton className="mt-2 h-4 w-80" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && <QueryError error={error} onRetry={() => void refetch()} resource="meetings" />}

      {!isPending && !error && meetings.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <EmptyState message="No meetings recorded" hint="Meetings and their action items appear here." />
          </CardContent>
        </Card>
      )}

      {!isPending && !error && meetings.length > 0 && (
        <div className="space-y-4">
          {meetings.map((meeting) => (
            <Card key={meeting.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="font-serif text-lg text-navy">{meeting.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(meeting.meeting_date)} · {meeting.attendees.join(", ")}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {meeting.source_notes && (
                  <p className="pb-2 text-sm text-muted-foreground">{meeting.source_notes}</p>
                )}
                {meeting.action_items.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">No action items from this meeting.</p>
                )}
                {meeting.action_items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
                  >
                    <span className="text-sm text-navy">{item.description}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{item.owner_name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(item.due_date)}</span>
                      <Badge
                        className={
                          item.status === "done"
                            ? "rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15"
                            : "rounded-full border-0 bg-gold/15 text-gold hover:bg-gold/15"
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        total={data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="meetings"
      />
    </div>
  );
}
