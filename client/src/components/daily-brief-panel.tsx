import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function DailyBriefPanel({
  brief,
}: {
  // `brief_date` is nullable on the wire and the panel does not render it,
  // so it is accepted but not required to be present.
  brief: { headline: string; body: string; brief_date?: string | null } | null;
}) {
  return (
    <Card className="rounded-2xl border-teal/30 bg-gradient-to-br from-navy to-navy/90 text-white shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Sparkles className="h-4 w-4 text-teal" />
        <CardTitle className="font-serif text-base font-medium text-white">Today&apos;s Focus</CardTitle>
      </CardHeader>
      <CardContent>
        {brief ? (
          <>
            <p className="font-serif text-lg font-semibold text-teal">{brief.headline}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/80">{brief.body}</p>
          </>
        ) : (
          <p className="text-sm text-white/60">No daily brief available yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
