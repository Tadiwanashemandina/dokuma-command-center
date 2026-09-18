import { randomUUID } from "node:crypto";
import { MANUAL_MEASURES, DAILY_MEASURES, findMeasure } from "@dokuma/shared";
import { SbuKpiReading } from "../db/models/sbu-kpi.js";
import { currentDate, formatDateOnly } from "../db/types.js";

/**
 * Seeds the Group SBU register with plausible figures.
 *
 * Kept in its own module rather than added to `seed-data.ts` so the Group
 * reporting surface can be reseeded on its own, and so this work does not
 * collide with the portfolio seed.
 *
 * The daily measures get 30 days of history, because the four of them are the
 * ones with a real time series — the specification allows backfill from
 * 2020-01-01 and the dashboard's trend only means anything with several points.
 * The monthly measures get a single current figure each.
 *
 * Every value here is a decimal STRING, matching how they are stored, sent and
 * displayed. Nothing in this path becomes a float.
 */

/** Figures for the 41 manually captured measures, by code. */
const MANUAL_FIGURES: Record<string, string> = {
  // Contract delivery
  BACKLOG_REMAINING: "486200",
  COMPLETION_DATE_VARIANCE: "12",
  MILESTONES_ON_TIME: "88.5",
  REWORK_RATE: "1.8",
  QA_COVERAGE: "96.4",
  EXCEPTION_DOC_RATE: "2.3",
  RECORDS_INDEXED_PCT: "94.1",

  // Platform and service performance
  SLA_COMPLIANCE: "98.7",
  INCIDENTS_BY_SEVERITY: "7",
  TRANSACTIONS_PROCESSED: "41280",
  ACTIVE_GOV_USERS: "312",
  QUERY_RESPONSE_TIME: "4.2",

  // Platform revenue after digitisation
  PLATFORM_TXNS_BY_TYPE: "41280",
  AVG_FEE_PER_TXN: "3.45",
  PLATFORM_REVENUE_PCT: "28.6",
  MRR_ARR: "142000.00",
  CONVEYANCING_SHARE: "34.2",
  DIGITAL_LODGEMENT_PCT: "61.8",
  ACTIVE_TRANSACTING_USERS: "1840",
  STRAIGHT_THROUGH_RATE: "72.5",
  TRANSFER_CYCLE_TIME: "18.5",
  COST_TO_SERVE_PER_TXN: "1.12",
  FEE_COLLECTION_RATE: "91.3",
  FEE_SPLIT_AND_TARIFF: "40.0",
  CONCESSION_REMAINING: "78",
  FAILED_REVERSED_TXNS: "143",
  TXN_SEASONALITY: "12.4",

  // Commercial and concentration — TOP_CLIENT_REVENUE_PCT is deliberately high.
  // Dokuma's revenue is overwhelmingly one government client, which is exactly
  // the concentration risk this exception measure exists to put on the board's
  // screen rather than leave in a footnote.
  TOP_CLIENT_REVENUE_PCT: "71.4",
  CONTRACT_RENEWAL: "19",
  CONTRACTED_BACKLOG_USD: "2100000.00",
  GOVT_COLLECTION_DAYS: "87",
  LICENCE_REVENUE: "38000.00",
  NEW_OPPORTUNITIES: "3",
  PROJECT_VS_PLATFORM_SPLIT: "71.4",

  // Engineering, security and governance
  SECURITY_INCIDENTS: "0",
  DATA_RESIDENCY_STATUS: "4",
  DR_TEST_RESULTS: "100.0",
  PRIVILEGED_ACCESS_REVIEW: "100.0",
  RELEASE_DEFECT_RATE: "3.1",
  CASH_RUNWAY: "14",
  CBZ_REPORTING: "100.0",
};

/**
 * A daily figure for a given day offset.
 *
 * Deterministic rather than random, so a reseed reproduces the same series —
 * a chart that changed shape on every seed would make it impossible to tell a
 * real regression from noise.
 */
function dailyValue(code: string, dayOffset: number): string {
  // A small repeating wobble, in [0, 1), from the day index alone.
  const wobble = ((dayOffset * 37) % 11) / 10;

  switch (code) {
    case "DEEDS_DIGITISED":
      // Cumulative against the contract target, climbing steadily.
      return String(142380 - dayOffset * 1120 + Math.round(wobble * 40));
    case "DIGITISATION_RATE":
      return String(1120 + Math.round(wobble * 180) - 60);
    case "DATA_ACCURACY": {
      // Sits just above the 99.95 target, and dips BELOW it on two days so the
      // exception tile has a genuine breach to show rather than a permanent
      // green that proves nothing.
      const breach = dayOffset === 4 || dayOffset === 17;
      return breach ? (99.93 + wobble / 100).toFixed(4) : (99.96 + wobble / 200).toFixed(4);
    }
    case "SYSTEM_UPTIME":
      return (99.5 + wobble / 2.5).toFixed(4);
    default:
      return "0";
  }
}

/**
 * Writes the register.
 *
 * Deletes Dokuma's rows first so a reseed replaces rather than accumulates —
 * the same idempotence rule the portfolio seed follows.
 */
export async function seedGroupKpis(options: { days?: number } = {}): Promise<{
  dailyRows: number;
  monthlyRows: number;
}> {
  const days = options.days ?? 30;
  const today = currentDate();
  const month = (formatDateOnly(today) ?? "").slice(0, 7);

  await SbuKpiReading.deleteMany({ sbuCode: "DOKUMA" });

  const docs: Record<string, unknown>[] = [];

  // ---- The four daily measures, with history -----------------------------
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const period = formatDateOnly(date);
    if (!period) continue;

    for (const measure of DAILY_MEASURES) {
      docs.push({
        _id: randomUUID(),
        sbuCode: "DOKUMA",
        measureCode: measure.code,
        period,
        frequency: measure.frequency,
        value: dailyValue(measure.code, offset),
        capturedAt: date,
        sourceUpdatedAt: date,
        // Seeded history represents figures already reported upstream; only
        // today's is still pending, which is what the feed will pick up.
        syncState: offset === 0 ? "pending" : "sent",
        source: "seed",
      });
    }
  }

  const dailyRows = docs.length;

  // ---- The monthly and other manual measures -----------------------------
  for (const measure of MANUAL_MEASURES) {
    const value = MANUAL_FIGURES[measure.code];
    // A measure with no seeded figure is left UNCAPTURED rather than given a
    // zero — the dashboard's "outstanding" count is only meaningful if an
    // absent figure is genuinely absent.
    if (value === undefined) continue;

    docs.push({
      _id: randomUUID(),
      sbuCode: "DOKUMA",
      measureCode: measure.code,
      period: month,
      frequency: measure.frequency,
      value,
      currency: measure.unit === "CURRENCY" ? "USD" : null,
      capturedAt: new Date(),
      sourceUpdatedAt: new Date(),
      syncState: "pending",
      source: "seed",
    });
  }

  await SbuKpiReading.insertMany(docs);

  return { dailyRows, monthlyRows: docs.length - dailyRows };
}

/** Guards the seed table against a typo'd or removed measure code. */
export function unknownSeedCodes(): string[] {
  return Object.keys(MANUAL_FIGURES).filter((code) => !findMeasure(code));
}
