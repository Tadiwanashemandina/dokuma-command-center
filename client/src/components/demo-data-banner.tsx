import { FlaskConical } from "lucide-react";

/**
 * Says plainly that figures on this page are fabricated.
 *
 * This exists because the failure it prevents is specific and serious: the
 * seeded register contains a plausible-looking 142,380 deeds and a 99.96% data
 * accuracy rate. Rendered in the same type as a measured figure, those numbers
 * are indistinguishable from fact — and this page is designed to be read by the
 * Office of the Chairman. A demo value quoted in a board pack, or signed and
 * posted upstream by the nightly feed, is a far worse outcome than a page that
 * looks unfinished.
 *
 * Amber rather than red: nothing is broken, but nothing here should be relied
 * on either. It carries an icon and the word "Demo" so the meaning does not
 * depend on colour alone.
 *
 * It disappears on its own. `count` comes from the number of readings whose
 * `source` is `"seed"`, so the banner vanishes the moment real figures replace
 * them — there is no flag to remember to turn off.
 */
export function DemoDataBanner({ count, total }: { count: number; total: number }) {
  if (count === 0) return null;

  const all = count >= total;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gold/50 bg-gold/10 px-4 py-3"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-2.5 py-1 text-xs font-semibold text-gold">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        Demo data
      </span>

      <p className="text-sm text-foreground">
        {all ? "Every figure on this page is" : `${count} of ${total} figures are`} generated
        sample data, not a measurement.{" "}
        <span className="text-muted-foreground">
          Do not quote these in a board pack. They are replaced as soon as Dokuma's QA system
          starts posting to <code className="text-xs">/api/qa-ingest/daily-readings</code>.
        </span>
      </p>
    </div>
  );
}
