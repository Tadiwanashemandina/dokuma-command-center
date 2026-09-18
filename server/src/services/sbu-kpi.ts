import { randomUUID } from "node:crypto";
import {
  EXCEPTION_MEASURES,
  SBU_KPI_MEASURES,
  findMeasure,
  isDecimalString,
  isValidPeriod,
  meetsTarget,
  periodFormatFor,
  type SbuKpiMeasure,
} from "@dokuma/shared";
import { SbuKpiReading, SbuKpiReadingHistory } from "../db/models/sbu-kpi.js";

/**
 * Capture and retrieval for the Group SBU register.
 *
 * The 41 manual measures of §9 are, in the specification's own words, "not an
 * integration" — they are typed in by Dokuma's finance and operations people as
 * part of the month-end routine. This service is what those screens call.
 */

export interface MeasureWithValue {
  measure: SbuKpiMeasure;
  value: string | null;
  currency: string | null;
  note: string | null;
  period: string;
  capturedAt: string | null;
  capturedBy: string | null;
  syncState: string;
  /** "seed" means a fabricated demo figure — never present it as measured. */
  source: "seed" | "qa" | "manual";
  /** null when there is no target or no value — see `meetsTarget`. */
  onTarget: boolean | null;
}

/**
 * The period a measure is captured against, given a reference month.
 *
 * DAILY measures are captured per date; everything else per month. A WEEKLY
 * measure is captured against its month for the same reason the Group platform
 * accepts `{ period, readings }` monthly in §9 — there is no weekly slot on the
 * receiving side, so inventing one here would produce figures with nowhere to go.
 */
export function periodFor(measure: SbuKpiMeasure, month: string, date: string): string {
  return periodFormatFor(measure) === "date" ? date : month;
}

/**
 * Reads every measure for a period, joined to the register.
 *
 * Returns ALL measures, including uncaptured ones with a null value, because
 * the register is the checklist: a month-end screen that showed only what had
 * already been entered would give no indication of what is still owed.
 */
export async function getRegisterForPeriod(options: {
  sbuCode: string;
  month: string;
  date: string;
  measures?: readonly SbuKpiMeasure[];
}): Promise<MeasureWithValue[]> {
  const measures = options.measures ?? SBU_KPI_MEASURES;
  const periods = [...new Set(measures.map((m) => periodFor(m, options.month, options.date)))];

  const rows = await SbuKpiReading.find({
    sbuCode: options.sbuCode,
    period: { $in: periods },
    measureCode: { $in: measures.map((m) => m.code) },
  }).lean();

  // Keyed on code+period, because a DAILY and a MONTHLY measure in the same
  // request are looked up against different periods.
  const byKey = new Map(rows.map((r) => [`${r.measureCode}|${r.period}`, r]));

  return measures.map((measure) => {
    const period = periodFor(measure, options.month, options.date);
    const row = byKey.get(`${measure.code}|${period}`);
    const value = row?.value ?? null;

    return {
      measure,
      value,
      currency: row?.currency ?? null,
      note: row?.note ?? null,
      period,
      capturedAt: row?.capturedAt?.toISOString() ?? null,
      capturedBy: row?.capturedBy ?? null,
      // The spine is derived upstream and never posted, so it is not "pending".
      syncState: row?.syncState ?? (measure.route === "derived" ? "not-applicable" : "pending"),
      source: (row?.source as "seed" | "qa" | "manual" | undefined) ?? "manual",
      onTarget: meetsTarget(measure, value),
    };
  });
}

/** The five board-level measures, for the exception tiles. */
export function getExceptionMeasures(options: {
  sbuCode: string;
  month: string;
  date: string;
}): Promise<MeasureWithValue[]> {
  return getRegisterForPeriod({ ...options, measures: EXCEPTION_MEASURES });
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface CaptureInput {
  measureCode: string;
  period: string;
  value: string | null;
  currency?: string | null;
  note?: string | null;
  restatementReason?: string | null;
}

export interface CaptureResult {
  measureCode: string;
  period: string;
  outcome: "saved" | "unchanged" | "cleared" | "rejected";
  error?: string;
}

/**
 * Saves figures, writing a history row for every value that changes.
 *
 * Rejections are per-document rather than all-or-nothing, matching the ingest
 * API's own behaviour in §8 (`atomic: false`): one mistyped figure should not
 * discard the other forty a user just entered.
 */
export async function captureReadings(options: {
  sbuCode: string;
  userId: string;
  readings: CaptureInput[];
}): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];

  for (const input of options.readings) {
    const measure = findMeasure(input.measureCode);

    if (!measure) {
      results.push({
        measureCode: input.measureCode,
        period: input.period,
        outcome: "rejected",
        // Matches the platform's own error name, so a message seen here reads
        // the same as one seen from the ingest API.
        error: "MEASURE_NOT_RECOGNISED",
      });
      continue;
    }

    /**
     * The spine is computed by the Group platform from source documents and is
     * never posted as a number (§1). Accepting a typed figure for it would
     * create a second, divergent source of truth for revenue and EBITDA —
     * precisely what that rule exists to prevent.
     */
    if (measure.route === "derived") {
      results.push({
        measureCode: measure.code,
        period: input.period,
        outcome: "rejected",
        error: "Spine measures are derived from documents upstream and cannot be captured here.",
      });
      continue;
    }

    if (!isValidPeriod(measure, input.period)) {
      results.push({
        measureCode: measure.code,
        period: input.period,
        outcome: "rejected",
        error:
          periodFormatFor(measure) === "date"
            ? "Expected a YYYY-MM-DD period for a DAILY measure."
            : "Expected a YYYY-MM period.",
      });
      continue;
    }

    if (input.value !== null && !isDecimalString(input.value)) {
      results.push({
        measureCode: measure.code,
        period: input.period,
        outcome: "rejected",
        error: "Value must be a decimal string of up to 4 places.",
      });
      continue;
    }

    const existing = await SbuKpiReading.findOne({
      sbuCode: options.sbuCode,
      measureCode: measure.code,
      period: input.period,
    });

    // An identical resend is a no-op, matching the ingest API's `duplicate`
    // outcome — and avoiding a history row that records no change.
    if (existing && existing.value === input.value) {
      results.push({ measureCode: measure.code, period: input.period, outcome: "unchanged" });
      continue;
    }

    const now = new Date();

    if (existing) {
      await SbuKpiReadingHistory.create({
        readingId: existing._id,
        sbuCode: options.sbuCode,
        measureCode: measure.code,
        period: input.period,
        previousValue: existing.value,
        newValue: input.value,
        restatementReason: input.restatementReason ?? null,
        changedBy: options.userId,
        changedAt: now,
      });

      existing.value = input.value;
      existing.currency = input.currency ?? existing.currency;
      existing.note = input.note ?? null;
      existing.capturedBy = options.userId;
      existing.capturedAt = now;
      // The value genuinely changed, so the source timestamp advances — this
      // is what makes a later resend win against the stored version upstream
      // rather than being refused as stale (§11).
      existing.sourceUpdatedAt = now;
      // A changed figure has not been reported yet, whatever it was before.
      existing.syncState = "pending";
      existing.source = "manual";
      await existing.save();
    } else {
      await SbuKpiReading.create({
        _id: randomUUID(),
        sbuCode: options.sbuCode,
        measureCode: measure.code,
        period: input.period,
        frequency: measure.frequency,
        value: input.value,
        currency: input.currency ?? null,
        note: input.note ?? null,
        capturedBy: options.userId,
        capturedAt: now,
        sourceUpdatedAt: now,
        syncState: "pending",
        source: "manual",
      });
    }

    results.push({
      measureCode: measure.code,
      period: input.period,
      outcome: input.value === null ? "cleared" : "saved",
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

export interface RegisterCompleteness {
  total: number;
  captured: number;
  outstanding: number;
  /** Captured figures that came from the demo seed, not from a measurement. */
  demo: number;
  /** Exception measures with no figure — the ones a board actually asks about. */
  exceptionsOutstanding: string[];
}

/**
 * How much of the month-end register is filled in.
 *
 * Counts only what Dokuma is responsible for: the spine is excluded because it
 * is derived upstream, and counting it as "outstanding" would make a complete
 * submission permanently read as 76% done.
 */
export async function getCompleteness(options: {
  sbuCode: string;
  month: string;
  date: string;
}): Promise<RegisterCompleteness> {
  const ours = SBU_KPI_MEASURES.filter((m) => m.route !== "derived");
  const rows = await getRegisterForPeriod({ ...options, measures: ours });

  const captured = rows.filter((r) => r.value !== null);

  return {
    total: ours.length,
    captured: captured.length,
    outstanding: ours.length - captured.length,
    demo: captured.filter((r) => r.source === "seed").length,
    exceptionsOutstanding: rows
      .filter((r) => r.measure.exception && r.value === null)
      .map((r) => r.measure.code),
  };
}
