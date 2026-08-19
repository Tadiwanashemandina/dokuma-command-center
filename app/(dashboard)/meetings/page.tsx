import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function MeetingIntelligencePage() {
  const supabase = await createClient();
  const { data: meetings } = await supabase
    .from("meetings")
    .select("*, meeting_action_items(*)")
    .order("meeting_date", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Meeting Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Action items extracted from recent meetings, with owner and due date.
        </p>
      </div>

      <div className="space-y-4">
        {meetings?.map((meeting) => {
          const items = (meeting.meeting_action_items as unknown as Array<{
            id: string;
            description: string;
            owner_name: string | null;
            due_date: string | null;
            status: string;
          }>) ?? [];

          return (
            <Card key={meeting.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="font-serif text-lg text-navy">{meeting.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(meeting.meeting_date)} · {(meeting.attendees ?? []).join(", ")}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {meeting.source_notes && (
                  <p className="pb-2 text-sm text-muted-foreground">{meeting.source_notes}</p>
                )}
                {items.map((item) => (
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
          );
        })}
      </div>
    </div>
  );
}
