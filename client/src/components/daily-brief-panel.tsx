import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

/**
 * The AI daily brief.
 *
 * Previously a navy box holding one unbroken block of ~90 words, which is the
 * densest thing on the page and the hardest to read: no entry point, no
 * structure, and a second dark region competing with the command deck.
 *
 * Two changes fix that without losing content:
 *
 *  - It is a LIGHT card now. The deck is the page's only dark surface, so the
 *    brief stops fighting it for attention.
 *  - The body is split on sentence boundaries into paragraphs. The text is
 *    generated prose with no markup, so paragraphing is the only structure
 *    available — and short paragraphs are what make a wall of text scannable.
 *
 * The headline stays visually distinct because it is the brief's conclusion;
 * the body is the supporting argument.
 */

/**
 * Splits generated prose into readable paragraphs.
 *
 * Groups sentences in pairs rather than one-per-line: single-sentence
 * paragraphs read as bullet points and lose the connective logic between a
 * claim and its evidence.
 */
function toParagraphs(body: string): string[] {
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return [body];

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2).join(" "));
  }
  return paragraphs;
}

export function DailyBriefPanel({
  brief,
}: {
  // `brief_date` is nullable on the wire and the panel does not render it,
  // so it is accepted but not required to be present.
  brief: { headline: string; body: string; brief_date?: string | null } | null;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-teal" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Today&apos;s Focus
          </p>
        </div>

        {brief ? (
          <>
            {/* The conclusion, set as the panel's own headline. */}
            <p className="mt-4 font-serif text-[19px] font-semibold leading-snug text-navy">
              {brief.headline}
            </p>

            {/* A short teal rule instead of a full-width border: it marks the
                break between conclusion and evidence without drawing a line
                across the card. */}
            <span className="mt-4 h-0.5 w-10 rounded-full bg-teal" />

            <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
              {toParagraphs(brief.body).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No daily brief available yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
