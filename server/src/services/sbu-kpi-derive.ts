import {
  RiskIssueDecision,
  DeliveryMetric,
  ProjectFinance,
  Project,
  Client,
} from "../db/models/index.js";
import { decimalToNumber } from "../db/types.js";
import { jiraDeliverySuggestions } from "./jira/delivery-metrics.js";

/**
 * Measures this platform can compute from data it already holds.
 *
 * A derived figure is offered as a SUGGESTION on the capture screen, never
 * saved automatically. The person capturing sees where the number came from and
 * either accepts it or types the real one over the top.
 *
 * That distinction is the whole design. An auto-saved derivation looks
 * identical on the board to a figure someone verified, and this platform's data
 * is demonstrably partial — `delivery_metrics` is flagged `illustrative`, and
 * the finance ledger holds ~$26k against a contract worth millions. Deriving
 * `REVENUE` from that would tell the chairman Dokuma earned six thousand
 * dollars. A suggestion a human must accept keeps a person between a thin table
 * and a board figure.
 *
 * Every suggestion therefore carries `confidence` and `basis`, and the UI shows
 * both. Nothing here writes to `sbu_kpi_readings`.
 */

export interface DerivedSuggestion {
  measureCode: string;
  /** Decimal string, in the measure's own unit. */
  value: string;
  /** What it was computed from, in the reader's terms. */
  basis: string;
  /**
   * `high`   — the underlying table is authoritative for this measure.
   * `medium` — real data, but a proxy rather than the true definition.
   * `low`    — the source is demo/illustrative or too thin to trust.
   */
  confidence: "high" | "medium" | "low";
}

/** Rounds to a fixed number of places and returns a decimal STRING (never a float). */
function dec(value: number, places = 2): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(places);
}

export async function deriveSuggestions(): Promise<DerivedSuggestion[]> {
  const out: DerivedSuggestion[] = [];

  // -------------------------------------------------------------------------
  // Security and governance — from the risk register
  // -------------------------------------------------------------------------

  /**
   * SECURITY_INCIDENTS — open security-tagged items.
   *
   * High confidence: the risk register is where Dokuma actually records these,
   * so counting it is the definition rather than a proxy. A zero here is a real
   * zero, which matters because the target is <= 0.
   */
  const securityCount = await RiskIssueDecision.countDocuments({
    status: "open",
    $or: [
      { category: { $regex: /security|breach|intrusion|cyber/i } },
      { title: { $regex: /security|breach|intrusion|unauthoris|hack/i } },
    ],
  });
  out.push({
    measureCode: "SECURITY_INCIDENTS",
    value: String(securityCount),
    basis: `${securityCount} open security-tagged item(s) in the risk register`,
    confidence: "high",
  });

  /**
   * INCIDENTS_BY_SEVERITY — §12 notes this is defined "by severity" but stored
   * as one scalar. The total of open critical+high is the closest honest
   * reading, and the UI labels it as a total rather than a breakdown.
   */
  const incidents = await RiskIssueDecision.countDocuments({
    type: "issue",
    status: "open",
    severity: { $in: ["critical", "high"] },
  });
  out.push({
    measureCode: "INCIDENTS_BY_SEVERITY",
    value: String(incidents),
    basis: `${incidents} open critical/high issue(s) — a total, not a breakdown by severity`,
    confidence: "medium",
  });

  // -------------------------------------------------------------------------
  // Engineering — from delivery metrics
  // -------------------------------------------------------------------------

  const delivery = await DeliveryMetric.aggregate<{
    open: number;
    closed: number;
    deploys: number;
  }>([
    {
      $group: {
        _id: null,
        open: { $sum: { $ifNull: ["$openDefectsCount", 0] } },
        closed: { $sum: { $ifNull: ["$closedDefectsCount", 0] } },
        deploys: { $sum: { $ifNull: ["$deploysCount", 0] } },
      },
    },
  ]);

  if (delivery[0]) {
    const { open, closed, deploys } = delivery[0];
    const total = open + closed;

    /**
     * Low confidence, deliberately: every row in `delivery_metrics` carries
     * `source: "illustrative"`. The arithmetic is right and the figure is still
     * wrong, because the input is demonstration data. Saying so is the only
     * honest way to offer it at all.
     */
    if (total > 0) {
      out.push({
        measureCode: "RELEASE_DEFECT_RATE",
        value: dec((open / total) * 100, 1),
        basis: `${open} open of ${total} defects — NOTE: delivery_metrics is flagged "illustrative"`,
        confidence: "low",
      });
    }

    if (deploys > 0) {
      out.push({
        measureCode: "TRANSACTIONS_PROCESSED",
        value: String(deploys),
        basis: `${deploys} deploys recorded — a weak proxy; replace with the real transaction count`,
        confidence: "low",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Commercial — from project finance
  // -------------------------------------------------------------------------

  /**
   * Latest snapshot per project, then summed. `project_finance` holds a row per
   * project per as-of date, so summing without narrowing to the latest date
   * would multiply the backlog by however many snapshots exist.
   */
  const latestByProject = await ProjectFinance.aggregate<{
    _id: string;
    // Typed as the Decimal128-or-null that `decimalToNumber` accepts. `unknown`
    // would compile at the aggregate but fail at every use site.
    contracted: Parameters<typeof decimalToNumber>[0];
    receivables: Parameters<typeof decimalToNumber>[0];
    pipeline: Parameters<typeof decimalToNumber>[0];
  }>([
    { $sort: { asOfDate: -1 } },
    {
      $group: {
        _id: "$projectId",
        contracted: { $first: "$contractedRevenueUsd" },
        receivables: { $first: "$receivablesUsd" },
        pipeline: { $first: "$revenuePipelineUsd" },
      },
    },
  ]);

  const contractedTotal = latestByProject.reduce(
    (sum, row) => sum + (decimalToNumber(row.contracted) ?? 0),
    0,
  );

  if (contractedTotal > 0) {
    out.push({
      measureCode: "CONTRACTED_BACKLOG_USD",
      value: dec(contractedTotal),
      basis: `Sum of contracted revenue across ${latestByProject.length} project(s), latest snapshot each`,
      confidence: "medium",
    });
  }

  /**
   * TOP_CLIENT_REVENUE_PCT — the concentration measure.
   *
   * Computed by attributing each project's contracted revenue to its client and
   * taking the largest share. Medium confidence: the arithmetic is sound but it
   * measures CONTRACTED value, not recognised revenue, which is the strict
   * definition. Worth offering because Dokuma's concentration is the single
   * largest commercial risk and an approximate figure beats an empty tile.
   */
  if (contractedTotal > 0) {
    const projects = await Project.find({}).select("_id clientId").lean();
    const clientOfProject = new Map(projects.map((p) => [p._id, p.clientId ?? null]));

    const byClient = new Map<string, number>();
    for (const row of latestByProject) {
      const clientId = clientOfProject.get(row._id);
      if (!clientId) continue;
      byClient.set(clientId, (byClient.get(clientId) ?? 0) + (decimalToNumber(row.contracted) ?? 0));
    }

    if (byClient.size > 0) {
      const [topClientId, topValue] = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0]!;
      const client = await Client.findById(topClientId).select("name").lean();
      out.push({
        measureCode: "TOP_CLIENT_REVENUE_PCT",
        value: dec((topValue / contractedTotal) * 100, 1),
        basis: `${client?.name ?? "largest client"} holds ${dec(topValue)} of ${dec(contractedTotal)} contracted`,
        confidence: "medium",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Delivery — from the project portfolio
  // -------------------------------------------------------------------------

  const [totalProjects, greenProjects] = await Promise.all([
    Project.countDocuments({}),
    Project.countDocuments({ status: "green" }),
  ]);

  if (totalProjects > 0) {
    /**
     * MILESTONES_ON_TIME approximated by project RAG status. A green project is
     * one delivering to plan, so the green share tracks on-time delivery
     * closely enough to be a useful starting point — but it is a proxy, and the
     * basis string says so plainly.
     */
    out.push({
      measureCode: "MILESTONES_ON_TIME",
      value: dec((greenProjects / totalProjects) * 100, 1),
      basis: `${greenProjects} of ${totalProjects} projects are Green — a proxy for on-time delivery`,
      confidence: "medium",
    });
  }

  /**
   * Jira-derived delivery measures, appended LAST so they override the
   * `delivery_metrics` versions above.
   *
   * Those rows are flagged `illustrative`; Jira issues are real work. Where
   * both produce a suggestion for the same code, the later entry wins in the
   * client's Map, so a real figure replaces a demonstration one automatically
   * once Jira is connected — no flag to remember to flip.
   */
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    out.push(...(await jiraDeliverySuggestions({ from, to })));
  } catch {
    // Jira being unconfigured or unreachable must not break the capture screen:
    // the other suggestions are still useful, and the screen works without any.
  }

  return out;
}
