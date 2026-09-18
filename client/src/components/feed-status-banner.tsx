import { AlertTriangle, CheckCircle2, PauseCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedConfig } from "@/lib/api/group-kpis";

/**
 * Whether today's figures actually reached the Group platform.
 *
 * This banner exists because of one sentence in §11 of the specification:
 * "alert on a day with no accepted batch — a silent feed and a genuine zero
 * look the same from the outside, and this feed carries the group's
 * highest-stakes measure."
 *
 * A dashboard that showed the figures without showing the state of the feed
 * would be showing half the truth: a stale DATA_ACCURACY of 99.97 looks exactly
 * like a current one. So the delivery state is given equal billing with the
 * figures, and it is stated in words rather than implied by a green dot.
 */

function relativeTime(iso: string | null): string {
  if (!iso) return "never";

  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

type Tone = "live" | "stale" | "paused";

const TONES: Record<Tone, { icon: typeof Radio; wrap: string; chip: string; label: string }> = {
  live: {
    icon: CheckCircle2,
    wrap: "border-status-green/40 bg-status-green/5",
    chip: "bg-status-green/15 text-status-green",
    label: "Feed healthy",
  },
  stale: {
    icon: AlertTriangle,
    wrap: "border-status-red/50 bg-status-red/5",
    chip: "bg-status-red/15 text-status-red",
    label: "No batch today",
  },
  paused: {
    icon: PauseCircle,
    wrap: "border-border bg-muted/40",
    chip: "bg-muted text-muted-foreground",
    label: "Feed not configured",
  },
};

export function FeedStatusBanner({ feed }: { feed: FeedConfig }) {
  /**
   * An unconfigured feed is `paused`, never `stale`.
   *
   * The distinction is the entire point: "nobody has issued a signing key yet"
   * is a project status, while "the key works but nothing arrived today" is an
   * incident. Collapsing them into one red banner would train people to ignore
   * the one that matters.
   */
  const tone: Tone =
    feed.mode !== "live" ? "paused" : feed.health.staleToday ? "stale" : "live";

  const t = TONES[tone];
  const Icon = t.icon;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3", t.wrap)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          t.chip,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {t.label}
      </span>

      <p className="text-sm text-muted-foreground">
        {tone === "paused" ? (
          <>
            {feed.reason ?? "The daily feed is not enabled."}{" "}
            <span className="text-foreground">
              Figures are captured here but are not being sent to the Group platform.
            </span>
          </>
        ) : tone === "stale" ? (
          <>
            No accepted batch for today.{" "}
            <span className="text-foreground">
              The figures below may not have reached the Office of the Chairman.
            </span>{" "}
            Last accepted {relativeTime(feed.health.lastAcceptedAt)}.
            {feed.health.consecutiveFailures > 0 &&
              ` ${feed.health.consecutiveFailures} consecutive failure${feed.health.consecutiveFailures === 1 ? "" : "s"}.`}
          </>
        ) : (
          <>
            Last batch accepted {relativeTime(feed.health.lastAcceptedAt)}
            {feed.baseUrl && <> · {new URL(feed.baseUrl).host}</>}
          </>
        )}
      </p>

      {feed.keyId && (
        /* The key ID is an identifier, not a secret — it is how an administrator
           confirms which key is live after a rotation. */
        <code className="ml-auto rounded bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
          {feed.keyId}
        </code>
      )}
    </div>
  );
}
