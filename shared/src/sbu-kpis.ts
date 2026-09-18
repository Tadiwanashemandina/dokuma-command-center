/**
 * The Dokuma SBU measure register — 45 bespoke + 14 group spine.
 *
 * This mirrors the Group platform's own `packages/shared/src/sbu-kpis.ts`, which
 * the KPI & Ingestion Specification names as its source of truth. It is
 * transcribed from that specification's §3 and §5 rather than invented here.
 *
 * ONE declaration drives four things, which is the whole point of putting it in
 * `shared/` rather than in the server or the client:
 *
 *   - the capture screen decides which measures to show, and what input each
 *     one needs, from `unit` and `frequency`;
 *   - the daily-feed builder selects exactly the DAILY measures, so a measure
 *     can never be posted to an endpoint that would reject it;
 *   - the server validates a submitted reading against `unit` and `frequency`;
 *   - the dashboard groups by `category` and highlights `exception`.
 *
 * If the Group register changes, change it here and let the four consumers
 * follow. Do not hand-maintain a second list anywhere.
 *
 * IMPORTANT — `route` is not a suggestion. The specification's §1 is explicit
 * that the path a measure takes is decided by its registered frequency, not by
 * the sender. A DAILY measure posted to the manual endpoint, or a MONTHLY one
 * posted to `/operational-readings`, is rejected by the platform with
 * `MEASURE_NOT_RECOGNISED`.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The SBU code this platform reports under. Must equal the signing key's SBU. */
export const SBU_CODE = "DOKUMA";

/**
 * Units, as the specification writes them. `unit` decides how a figure is
 * captured, validated and rendered — not merely how it is labelled.
 */
export const KPI_UNITS_SBU = [
  "COUNT",
  "PERCENT",
  "CURRENCY",
  "DAYS",
  "MONTHS",
  "HOURS",
  "RATIO",
  "RATE",
  "INDEX",
] as const;

export type SbuKpiUnit = (typeof KPI_UNITS_SBU)[number];

/**
 * Reporting cadence. This is the field that decides `route`, so the two are
 * derived together in `measure()` below rather than typed twice.
 */
export const KPI_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;

export type SbuKpiFrequency = (typeof KPI_FREQUENCIES)[number];

/**
 * How a figure reaches the Group platform (specification §1).
 *
 *   - `operational-readings` — signed HMAC feed, one value per measure per day.
 *   - `manual`              — typed in here, then pushed on the session-auth
 *                             month-end route.
 *   - `derived`             — the spine. NEVER posted as a number; the platform
 *                             computes it from source documents. Read-only to
 *                             us, which is why these carry no capture input.
 */
export type SbuKpiRoute = "operational-readings" | "manual" | "derived";

/** Grouping for the dashboard, matching the specification's §5 headings. */
export const KPI_CATEGORIES = [
  "contract-delivery",
  "platform-performance",
  "platform-revenue",
  "commercial",
  "engineering-governance",
  "group-spine",
] as const;

export type SbuKpiCategory = (typeof KPI_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SbuKpiCategory, string> = {
  "contract-delivery": "Contract delivery",
  "platform-performance": "Platform and service performance",
  "platform-revenue": "Platform revenue after digitisation",
  commercial: "Commercial and concentration",
  "engineering-governance": "Engineering, security and governance",
  "group-spine": "Group spine",
};

/**
 * A target, when the specification states one.
 *
 * `direction` is what makes a figure good or bad, and it is not inferable from
 * the unit — a high uptime is good, a high collection-days is not. The
 * dashboard colours a tile from this, so an unstated direction must stay
 * `null` rather than defaulting to "higher is better" and quietly showing a
 * deteriorating measure in green.
 */
export interface SbuKpiTarget {
  /** Inclusive lower bound, as a decimal string. */
  min?: string;
  /** Inclusive upper bound, as a decimal string. */
  max?: string;
}

export interface SbuKpiMeasure {
  code: string;
  name: string;
  unit: SbuKpiUnit;
  frequency: SbuKpiFrequency;
  category: SbuKpiCategory;
  route: SbuKpiRoute;
  /** `true` for the five board-level measures of specification §4. */
  exception: boolean;
  /** Higher is better, lower is better, or not stated. */
  direction: "up" | "down" | null;
  target: SbuKpiTarget | null;
  /**
   * Set where the specification's §12 flags a measure as defined "by type" or
   * "by severity" while a reading stores one scalar. Surfaced in the UI so the
   * captured total is not mistaken for a breakdown.
   */
  dimensioned?: string;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/**
 * Builds a measure, deriving `route` from `frequency` so the two cannot drift.
 *
 * DAILY measures go over the signed operational-readings feed; everything else
 * bespoke is captured by hand. The spine overrides this with `derived`, since
 * it is computed by the platform from documents and never posted as a figure.
 */
function measure(
  code: string,
  name: string,
  unit: SbuKpiUnit,
  frequency: SbuKpiFrequency,
  category: SbuKpiCategory,
  extra: Partial<Pick<SbuKpiMeasure, "exception" | "direction" | "target" | "route" | "dimensioned">> = {},
): SbuKpiMeasure {
  return {
    code,
    name,
    unit,
    frequency,
    category,
    route: extra.route ?? (frequency === "DAILY" ? "operational-readings" : "manual"),
    exception: extra.exception ?? false,
    direction: extra.direction ?? null,
    target: extra.target ?? null,
    ...(extra.dimensioned ? { dimensioned: extra.dimensioned } : {}),
  };
}

/** §5 — Contract delivery (10). */
const CONTRACT_DELIVERY: SbuKpiMeasure[] = [
  measure("DEEDS_DIGITISED", "Deeds digitised vs contract target", "COUNT", "DAILY", "contract-delivery", {
    direction: "up",
  }),
  measure("DIGITISATION_RATE", "Digitisation speed", "COUNT", "DAILY", "contract-delivery", {
    direction: "up",
  }),
  measure("BACKLOG_REMAINING", "Backlog remaining", "COUNT", "WEEKLY", "contract-delivery", {
    direction: "down",
  }),
  measure(
    "COMPLETION_DATE_VARIANCE",
    "Projected vs contracted completion date",
    "DAYS",
    "MONTHLY",
    "contract-delivery",
    { direction: "down" },
  ),
  measure("MILESTONES_ON_TIME", "Milestones delivered on time %", "PERCENT", "MONTHLY", "contract-delivery", {
    direction: "up",
  }),
  // The group's highest-stakes measure: an error here is an error in someone's
  // legal land title (specification §12).
  measure("DATA_ACCURACY", "Data accuracy rate %", "PERCENT", "DAILY", "contract-delivery", {
    exception: true,
    direction: "up",
    target: { min: "99.95" },
  }),
  measure("REWORK_RATE", "Rework / re-scan rate %", "PERCENT", "WEEKLY", "contract-delivery", {
    direction: "down",
  }),
  measure("QA_COVERAGE", "Quality-check coverage %", "PERCENT", "WEEKLY", "contract-delivery", {
    direction: "up",
  }),
  measure(
    "EXCEPTION_DOC_RATE",
    "Unreadable or exception document rate",
    "PERCENT",
    "WEEKLY",
    "contract-delivery",
    { direction: "down" },
  ),
  measure(
    "RECORDS_INDEXED_PCT",
    "Records indexed and searchable %",
    "PERCENT",
    "MONTHLY",
    "contract-delivery",
    { direction: "up" },
  ),
];

/** §5 — Platform and service performance (6). */
const PLATFORM_PERFORMANCE: SbuKpiMeasure[] = [
  measure("SYSTEM_UPTIME", "System uptime %", "PERCENT", "DAILY", "platform-performance", {
    direction: "up",
    target: { min: "99.5", max: "99.9" },
  }),
  measure("SLA_COMPLIANCE", "Service-agreement compliance %", "PERCENT", "MONTHLY", "platform-performance", {
    direction: "up",
  }),
  measure("INCIDENTS_BY_SEVERITY", "Incidents by severity", "COUNT", "MONTHLY", "platform-performance", {
    direction: "down",
    dimensioned: "severity",
  }),
  measure("TRANSACTIONS_PROCESSED", "Transactions processed", "COUNT", "MONTHLY", "platform-performance", {
    direction: "up",
  }),
  measure(
    "ACTIVE_GOV_USERS",
    "Active government users / agencies",
    "COUNT",
    "MONTHLY",
    "platform-performance",
    { direction: "up" },
  ),
  measure(
    "QUERY_RESPONSE_TIME",
    "Average time to respond to a query",
    "HOURS",
    "MONTHLY",
    "platform-performance",
    { direction: "down" },
  ),
];

/** §5 — Platform revenue after digitisation (15). */
const PLATFORM_REVENUE: SbuKpiMeasure[] = [
  measure("PLATFORM_TXNS_BY_TYPE", "Transactions per month, by type", "COUNT", "MONTHLY", "platform-revenue", {
    direction: "up",
    dimensioned: "transaction type",
  }),
  measure(
    "AVG_FEE_PER_TXN",
    "Average fee earned per transaction, by type",
    "CURRENCY",
    "MONTHLY",
    "platform-revenue",
    { direction: "up", dimensioned: "transaction type" },
  ),
  measure(
    "PLATFORM_REVENUE_PCT",
    "Platform revenue as % of total revenue",
    "PERCENT",
    "MONTHLY",
    "platform-revenue",
    { direction: "up" },
  ),
  measure("MRR_ARR", "Recurring revenue (MRR / ARR)", "CURRENCY", "MONTHLY", "platform-revenue", {
    direction: "up",
  }),
  measure(
    "CONVEYANCING_SHARE",
    "Share of national conveyancing volume on the platform",
    "PERCENT",
    "QUARTERLY",
    "platform-revenue",
    { direction: "up" },
  ),
  measure("DIGITAL_LODGEMENT_PCT", "Transfers lodged digitally %", "PERCENT", "MONTHLY", "platform-revenue", {
    direction: "up",
  }),
  measure(
    "ACTIVE_TRANSACTING_USERS",
    "Registered vs actively transacting users",
    "COUNT",
    "MONTHLY",
    "platform-revenue",
    { direction: "up", dimensioned: "registered vs transacting" },
  ),
  measure(
    "STRAIGHT_THROUGH_RATE",
    "Straight-through processing rate %",
    "PERCENT",
    "MONTHLY",
    "platform-revenue",
    { direction: "up" },
  ),
  measure(
    "TRANSFER_CYCLE_TIME",
    "Average time to complete a transfer end to end",
    "DAYS",
    "MONTHLY",
    "platform-revenue",
    { direction: "down" },
  ),
  measure(
    "COST_TO_SERVE_PER_TXN",
    "Cost to serve per transaction, and platform gross margin",
    "CURRENCY",
    "MONTHLY",
    "platform-revenue",
    { direction: "down" },
  ),
  measure(
    "FEE_COLLECTION_RATE",
    "Fee collection rate and days to collect",
    "PERCENT",
    "MONTHLY",
    "platform-revenue",
    { direction: "up" },
  ),
  measure(
    "FEE_SPLIT_AND_TARIFF",
    "Fee split with government, and who sets the tariff",
    "PERCENT",
    "ANNUAL",
    "platform-revenue",
  ),
  measure(
    "CONCESSION_REMAINING",
    "Platform concession remaining, and exclusivity terms",
    "MONTHS",
    "QUARTERLY",
    "platform-revenue",
    { direction: "up" },
  ),
  measure(
    "FAILED_REVERSED_TXNS",
    "Failed, reversed and disputed transactions",
    "COUNT",
    "MONTHLY",
    "platform-revenue",
    { direction: "down" },
  ),
  measure("TXN_SEASONALITY", "Seasonality of transaction volumes", "PERCENT", "MONTHLY", "platform-revenue"),
];

/** §5 — Commercial and concentration (7). */
const COMMERCIAL: SbuKpiMeasure[] = [
  // Concentration risk: a HIGH share of revenue from one client is bad, which
  // is why direction is "down" on a measure whose name sounds like revenue.
  measure("TOP_CLIENT_REVENUE_PCT", "Revenue from the largest client %", "PERCENT", "MONTHLY", "commercial", {
    exception: true,
    direction: "down",
  }),
  measure("CONTRACT_RENEWAL", "Contract renewal date and likelihood", "MONTHS", "QUARTERLY", "commercial"),
  measure(
    "CONTRACTED_BACKLOG_USD",
    "Confirmed future work under contract",
    "CURRENCY",
    "MONTHLY",
    "commercial",
    { direction: "up" },
  ),
  measure(
    "GOVT_COLLECTION_DAYS",
    "Days to collect payment from government",
    "DAYS",
    "MONTHLY",
    "commercial",
    { exception: true, direction: "down" },
  ),
  measure("LICENCE_REVENUE", "Predictable licence revenue", "CURRENCY", "MONTHLY", "commercial", {
    direction: "up",
  }),
  measure("NEW_OPPORTUNITIES", "New agency and country opportunities", "COUNT", "QUARTERLY", "commercial", {
    direction: "up",
  }),
  measure(
    "PROJECT_VS_PLATFORM_SPLIT",
    "Revenue split: digitisation vs platform fees",
    "PERCENT",
    "MONTHLY",
    "commercial",
    { exception: true },
  ),
];

/** §5 — Engineering, security and governance (7). */
const ENGINEERING_GOVERNANCE: SbuKpiMeasure[] = [
  measure(
    "SECURITY_INCIDENTS",
    "Security incidents / attempted break-ins",
    "COUNT",
    "MONTHLY",
    "engineering-governance",
    { exception: true, direction: "down", target: { max: "0" } },
  ),
  measure(
    "DATA_RESIDENCY_STATUS",
    "Data protection and residency compliance status",
    "INDEX",
    "QUARTERLY",
    "engineering-governance",
    { direction: "up" },
  ),
  measure(
    "DR_TEST_RESULTS",
    "Backup and disaster-recovery test results",
    "PERCENT",
    "QUARTERLY",
    "engineering-governance",
    { direction: "up" },
  ),
  measure(
    "PRIVILEGED_ACCESS_REVIEW",
    "Access review for high-level system access",
    "PERCENT",
    "QUARTERLY",
    "engineering-governance",
    { direction: "up" },
  ),
  measure(
    "RELEASE_DEFECT_RATE",
    "Release frequency and escaped defect rate",
    "PERCENT",
    "MONTHLY",
    "engineering-governance",
    { direction: "down" },
  ),
  measure("CASH_RUNWAY", "Cash burn and runway", "MONTHS", "MONTHLY", "engineering-governance", {
    direction: "up",
  }),
  measure(
    "CBZ_REPORTING",
    "Reporting obligations to CBZ as 17.5% shareholder",
    "PERCENT",
    "QUARTERLY",
    "engineering-governance",
    { direction: "up" },
  ),
];

/**
 * §3 — the 14 group spine measures.
 *
 * All `derived`: the platform computes these from the finance documents it
 * already holds. The specification's §1 is emphatic that "the spine is never
 * posted as a number", so that a figure on the chairman's screen and the
 * transaction behind it are the same number aggregated. They appear here only
 * so the dashboard can show them read-only, and they carry no capture input.
 */
const GROUP_SPINE: SbuKpiMeasure[] = [
  measure("REVENUE", "Revenue", "CURRENCY", "MONTHLY", "group-spine", { route: "derived", direction: "up" }),
  measure("GROSS_MARGIN_PCT", "Gross margin %", "PERCENT", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "up",
  }),
  measure("EBITDA", "EBITDA", "CURRENCY", "MONTHLY", "group-spine", { route: "derived", direction: "up" }),
  measure("EBITDA_MARGIN_PCT", "EBITDA margin %", "PERCENT", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "up",
  }),
  measure("OPERATING_CASH_FLOW", "Operating cash flow", "CURRENCY", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "up",
  }),
  measure("CASH_CONVERSION_PCT", "Cash conversion %", "PERCENT", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "up",
  }),
  measure("DSO_DAYS", "Debtor days (DSO)", "DAYS", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "down",
  }),
  measure("DPO_DAYS", "Creditor days (DPO)", "DAYS", "MONTHLY", "group-spine", { route: "derived" }),
  measure("NET_DEBT_EBITDA", "Net debt / EBITDA", "RATIO", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "down",
  }),
  measure("CAPEX_VS_BUDGET_PCT", "Capex vs budget %", "PERCENT", "MONTHLY", "group-spine", {
    route: "derived",
  }),
  measure("STAFF_FTE", "Staff (FTE)", "COUNT", "MONTHLY", "group-spine", { route: "derived" }),
  measure("REVENUE_PER_FTE", "Revenue per employee", "CURRENCY", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "up",
  }),
  measure("LTIFR", "LTIFR", "RATE", "MONTHLY", "group-spine", { route: "derived", direction: "down" }),
  measure("RECORDABLE_INCIDENTS", "Recordable incidents", "COUNT", "MONTHLY", "group-spine", {
    route: "derived",
    direction: "down",
  }),
];

/** Every measure Dokuma reports, bespoke then spine. */
export const SBU_KPI_MEASURES: readonly SbuKpiMeasure[] = [
  ...CONTRACT_DELIVERY,
  ...PLATFORM_PERFORMANCE,
  ...PLATFORM_REVENUE,
  ...COMMERCIAL,
  ...ENGINEERING_GOVERNANCE,
  ...GROUP_SPINE,
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_CODE = new Map(SBU_KPI_MEASURES.map((m) => [m.code, m]));

export function findMeasure(code: string): SbuKpiMeasure | undefined {
  // Codes are upper-cased on receipt by the Group platform; match that here so
  // a lower-case code from a form field resolves rather than silently missing.
  return BY_CODE.get(code.toUpperCase());
}

export function isMeasureCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value.toUpperCase());
}

/**
 * The four measures the signed daily feed carries (specification §2).
 *
 * Derived from the register rather than written out, so a measure whose
 * frequency changes cannot be left behind in a hand-maintained list — it would
 * be posted to an endpoint that rejects it.
 */
export const DAILY_MEASURES: readonly SbuKpiMeasure[] = SBU_KPI_MEASURES.filter(
  (m) => m.route === "operational-readings",
);

export const DAILY_MEASURE_CODES: readonly string[] = DAILY_MEASURES.map((m) => m.code);

/** The five board-level measures of §4, in specification order. */
export const EXCEPTION_MEASURES: readonly SbuKpiMeasure[] = SBU_KPI_MEASURES.filter((m) => m.exception);

/** Bespoke measures typed in by Dokuma staff at month end (§9). */
export const MANUAL_MEASURES: readonly SbuKpiMeasure[] = SBU_KPI_MEASURES.filter(
  (m) => m.route === "manual",
);

export const SPINE_MEASURES: readonly SbuKpiMeasure[] = SBU_KPI_MEASURES.filter(
  (m) => m.route === "derived",
);

export function measuresByCategory(category: SbuKpiCategory): SbuKpiMeasure[] {
  return SBU_KPI_MEASURES.filter((m) => m.category === category);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A captured figure, as it crosses every boundary in this system.
 *
 * `value` is a decimal STRING, never a JSON number — the same rule the
 * specification states for the ingest payload, and the same rule D-12 applies
 * to money in this codebase. A percentage like 99.95 is exactly representable
 * as a string and not as a float64, and this particular percentage decides
 * whether a land title is correct.
 */
export interface SbuKpiReading {
  measureCode: string;
  /** `YYYY-MM-DD` for DAILY, `YYYY-MM` for every other frequency. */
  period: string;
  value: string | null;
  currency?: string | null;
  note?: string | null;
}

/** Up to 4 decimal places, optionally negative. Mirrors the ingest rule. */
const DECIMAL_RE = /^-?\d{1,15}(\.\d{1,4})?$/;

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_RE.test(value);
}

/** `YYYY-MM-DD`, used by DAILY measures. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM`, used by every other frequency. */
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function isMonthPeriod(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/**
 * The period format a measure expects, which follows from its frequency.
 *
 * A DAILY measure is reported for a business DATE; everything else is reported
 * for a MONTH. Weekly, quarterly and annual measures are all captured against
 * the month they fall in, because that is the granularity the Group platform's
 * `/readings` route accepts (`{ period, readings }` in §9).
 */
export function periodFormatFor(measure: SbuKpiMeasure): "date" | "month" {
  return measure.frequency === "DAILY" ? "date" : "month";
}

export function isValidPeriod(measure: SbuKpiMeasure, period: string): boolean {
  return periodFormatFor(measure) === "date" ? isDateOnly(period) : isMonthPeriod(period);
}

/**
 * Whether a figure meets its stated target.
 *
 * Returns `null` when there is no target or no value — "unknown" is a distinct
 * answer from "failing", and a tile must not show a measure red merely because
 * nobody has captured it yet.
 *
 * Compared as numbers rather than strings: the targets in the register are
 * small, fixed-precision bounds where float64 comparison is exact enough, and
 * a lexical comparison would rank "9.5" above "10".
 */
export function meetsTarget(measure: SbuKpiMeasure, value: string | null): boolean | null {
  if (!measure.target || value === null) return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  if (measure.target.min !== undefined && n < Number(measure.target.min)) return false;
  if (measure.target.max !== undefined && n > Number(measure.target.max)) return false;
  return true;
}

/** Renders a target the way the specification's tables do, e.g. "≥ 99.95". */
export function formatTarget(target: SbuKpiTarget | null): string | null {
  if (!target) return null;
  if (target.min !== undefined && target.max !== undefined) return `${target.min}–${target.max}`;
  if (target.min !== undefined) return `≥ ${target.min}`;
  if (target.max !== undefined) return `≤ ${target.max}`;
  return null;
}

/**
 * Trims trailing zeros from a stored decimal, for DISPLAY only.
 *
 * Values are stored and transmitted at up to 4 decimal places because the
 * ingest contract requires that precision, but "99.9600%" on a tile reads as
 * false precision — it implies the measurement resolves to a ten-thousandth
 * when it does not. The stored string is never altered; this is purely the
 * rendering step.
 *
 * Only trailing zeros AFTER a decimal point are removed, so "1120" is
 * untouched and "99.9500" becomes "99.95" rather than "99.95" losing a
 * significant digit.
 */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Appends the unit symbol for display. Currency is left to the caller. */
export function formatMeasureValue(measure: SbuKpiMeasure, raw: string | null): string {
  if (raw === null) return "—";

  const value = trimDecimal(raw);

  switch (measure.unit) {
    case "PERCENT":
      return `${value}%`;
    case "DAYS":
      return `${value} d`;
    case "MONTHS":
      return `${value} mo`;
    case "HOURS":
      return `${value} h`;
    case "RATIO":
      return `${value}×`;
    default:
      return value;
  }
}
