import { JiraIssueLink } from "../../db/models/jira.js";

/**
 * Delivery measures derived from real Jira issues.
 *
 * This is the point of the whole integration for Group reporting. Today
 * `RELEASE_DEFECT_RATE` and friends are suggested from `delivery_metrics`,
 * every row of which carries `source: "illustrative"` — so the suggestion is
 * flagged LOW confidence and nobody should act on it. Issues synced from Jira
 * are real work, so the same measures become defensible.
 *
 * Nothing here writes a reading. These are SUGGESTIONS, surfaced on the capture
 * screen with their basis, and a person accepts or overrides them — the same
 * rule as `sbu-kpi-derive.ts`, for the same reason: a derived figure and a
 * verified one look identical once stored.
 */

export interface JiraDeliveryMetrics {
  /** Issues whose type names a defect — Bug, Defect, Incident. */
  defectsOpen: number;
  defectsClosedInPeriod: number;
  defectRatePct: string | null;

  /** Everything not yet in the `done` bucket. */
  backlogRemaining: number;

  /** Resolved on or before their due date, as a percentage. */
  onTimePct: string | null;
  onTimeSample: number;

  /** Median days from created to resolved, for issues closed in the period. */
  cycleTimeDays: string | null;

  totalIssues: number;
  issuesResolvedInPeriod: number;
}

/**
 * Jira has no canonical "is a bug" flag — it depends on each site's issue
 * types. Matching on name covers the defaults and the common variants; a site
 * with a bespoke type name needs this list extended, which is why it is here
 * rather than buried in a query.
 */
const DEFECT_TYPES = /bug|defect|incident|fault/i;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function pct(part: number, whole: number): string | null {
  // A percentage of nothing is not zero — it is unknown. Returning "0.0" here
  // would put a fabricated on-time rate of zero on a board tile.
  if (whole === 0) return null;
  return ((part / whole) * 100).toFixed(1);
}

export async function computeJiraDeliveryMetrics(options: {
  from: Date;
  to: Date;
  projectKeys?: string[];
}): Promise<JiraDeliveryMetrics> {
  const scope = options.projectKeys?.length
    ? { jiraProjectKey: { $in: options.projectKeys.map((k) => k.toUpperCase()) } }
    : {};

  const issues = await JiraIssueLink.find(scope)
    .select("issueType statusCategory dueDate resolvedAt jiraCreatedAt")
    .lean();

  const inPeriod = (date: Date | null | undefined): boolean =>
    !!date && date >= options.from && date <= options.to;

  let defectsOpen = 0;
  let defectsClosedInPeriod = 0;
  let backlogRemaining = 0;
  let resolvedInPeriod = 0;
  let onTimeCount = 0;
  let onTimeSample = 0;
  const cycleTimes: number[] = [];

  for (const issue of issues) {
    const isDefect = DEFECT_TYPES.test(issue.issueType ?? "");
    const isDone = issue.statusCategory === "done";

    if (!isDone) {
      backlogRemaining += 1;
      if (isDefect) defectsOpen += 1;
    }

    if (inPeriod(issue.resolvedAt)) {
      resolvedInPeriod += 1;
      if (isDefect) defectsClosedInPeriod += 1;

      /**
       * On-time is measured only where BOTH a due date and a resolution exist.
       * Counting undated issues as on-time would inflate the figure, and
       * counting them as late would deflate it — neither is a measurement, so
       * they are excluded and `onTimeSample` reports how many actually counted.
       */
      if (issue.dueDate && issue.resolvedAt) {
        onTimeSample += 1;
        if (issue.resolvedAt <= endOfDay(issue.dueDate)) onTimeCount += 1;
      }

      if (issue.jiraCreatedAt && issue.resolvedAt) {
        const days = (issue.resolvedAt.getTime() - issue.jiraCreatedAt.getTime()) / 86_400_000;
        if (days >= 0) cycleTimes.push(days);
      }
    }
  }

  const defectTotal = defectsOpen + defectsClosedInPeriod;
  const medianCycle = median(cycleTimes);

  return {
    defectsOpen,
    defectsClosedInPeriod,
    defectRatePct: pct(defectsOpen, defectTotal),
    backlogRemaining,
    onTimePct: pct(onTimeCount, onTimeSample),
    onTimeSample,
    cycleTimeDays: medianCycle === null ? null : medianCycle.toFixed(1),
    totalIssues: issues.length,
    issuesResolvedInPeriod: resolvedInPeriod,
  };
}

/**
 * A due date is a DAY, not an instant.
 *
 * An issue due the 15th and resolved at 16:00 on the 15th is on time. Comparing
 * against midnight would mark almost everything late, which is the kind of
 * quietly wrong metric that gets noticed only after it reaches a board pack.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Shapes the metrics as register suggestions.
 *
 * Confidence is HIGH here, unlike the `delivery_metrics` derivations these
 * replace: the underlying issues are real work items synced from Jira, not
 * rows flagged `illustrative`.
 */
export async function jiraDeliverySuggestions(options: {
  from: Date;
  to: Date;
}): Promise<{ measureCode: string; value: string; basis: string; confidence: "high" | "medium" }[]> {
  const m = await computeJiraDeliveryMetrics(options);

  if (m.totalIssues === 0) return [];

  const out: { measureCode: string; value: string; basis: string; confidence: "high" | "medium" }[] = [];

  if (m.defectRatePct !== null) {
    out.push({
      measureCode: "RELEASE_DEFECT_RATE",
      value: m.defectRatePct,
      basis: `${m.defectsOpen} open of ${m.defectsOpen + m.defectsClosedInPeriod} defects in Jira`,
      confidence: "high",
    });
  }

  out.push({
    measureCode: "BACKLOG_REMAINING",
    value: String(m.backlogRemaining),
    basis: `${m.backlogRemaining} Jira issues not in a Done status`,
    confidence: "high",
  });

  if (m.onTimePct !== null) {
    out.push({
      measureCode: "MILESTONES_ON_TIME",
      value: m.onTimePct,
      // The sample size is stated because an on-time rate from 3 issues and one
      // from 300 are very different claims wearing the same number.
      basis: `${m.onTimeSample} resolved issues had a due date; ${m.onTimePct}% met it`,
      confidence: m.onTimeSample >= 10 ? "high" : "medium",
    });
  }

  if (m.cycleTimeDays !== null) {
    out.push({
      measureCode: "TRANSFER_CYCLE_TIME",
      value: m.cycleTimeDays,
      basis: `Median Jira cycle time across ${m.issuesResolvedInPeriod} resolved issues — a proxy for transfer time`,
      confidence: "medium",
    });
  }

  return out;
}
