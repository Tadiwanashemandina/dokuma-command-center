import { randomUUID } from "node:crypto";
import {
  DAILY_MEASURES,
  findMeasure,
  isDecimalString,
  type SbuKpiMeasure,
} from "@dokuma/shared";
import { SbuKpiReading, SbuKpiDispatch } from "../../db/models/sbu-kpi.js";
import { formatDateOnly, currentDate } from "../../db/types.js";
import { resolveConfig, operationalReadingsPath, type OnePlatformConfig } from "./config.js";
import { signRequest } from "./signing.js";

/**
 * The nightly feed — the ONE thing §0 of the specification says Dokuma's
 * engineers build: four numbers posted to one endpoint.
 *
 * The four measures are taken from the shared register by `route`, never from a
 * list written out here. §2 rejects any code that is not registered DAILY for
 * DOKUMA with `MEASURE_NOT_RECOGNISED`, so a hand-maintained list that drifted
 * from the register would fail per-document at the far end, at night, on the
 * group's highest-stakes measure.
 */

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface OperationalReadingDocument {
  measureCode: string;
  readingDate: string;
  value: string;
  status: "POSTED" | "VOIDED";
  sourceUpdatedAt: string;
  restatementReason?: string;
}

export interface OperationalReadingsBatch {
  sbuCode: string;
  clientBatchRef: string;
  atomic: boolean;
  documents: OperationalReadingDocument[];
}

export interface BuiltBatch {
  batch: OperationalReadingsBatch;
  /** Measures with no captured figure for the date. Reported, never sent as 0. */
  missing: { code: string; name: string }[];
  /** Measures whose stored value failed validation before sending. */
  invalid: { code: string; value: string; problem: string }[];
  /**
   * Measures excluded because their value came from the demo seed.
   *
   * These are withheld, not sent. A fabricated figure that reaches the Office
   * of the Chairman is indistinguishable from a measured one and carries the
   * platform's signature vouching for it — so the feed refuses to sign it. A
   * visible gap is recoverable; a signed invention is not.
   */
  demo: { code: string; name: string }[];
}

/**
 * ISO-8601 WITH an offset, which §2 requires of `sourceUpdatedAt`.
 *
 * `Date.prototype.toISOString()` returns a `Z` suffix, which is a valid
 * offset — so this is a deliberate, checked choice rather than an accident of
 * the default formatter.
 */
function isoWithOffset(date: Date): string {
  return date.toISOString();
}

/**
 * Builds the batch for one business date.
 *
 * A measure with no figure is OMITTED and reported as missing — never sent as
 * zero. §11 is explicit that "a silent feed and a genuine zero look the same
 * from the outside"; inventing a zero to fill a gap would put a fabricated
 * figure on the chairman's screen, which is worse than a visible gap.
 */
export async function buildDailyBatch(readingDate: Date, sbuCode: string): Promise<BuiltBatch> {
  const period = formatDateOnly(readingDate);
  if (!period) throw new Error("readingDate is not a valid date.");

  const rows = await SbuKpiReading.find({
    sbuCode,
    period,
    measureCode: { $in: DAILY_MEASURES.map((m) => m.code) },
  }).lean();

  const byCode = new Map(rows.map((r) => [r.measureCode, r]));

  const documents: OperationalReadingDocument[] = [];
  const missing: BuiltBatch["missing"] = [];
  const invalid: BuiltBatch["invalid"] = [];
  const demo: BuiltBatch["demo"] = [];

  for (const measure of DAILY_MEASURES) {
    const row = byCode.get(measure.code);
    // `== null` catches both null and undefined: a lean() document omits an
    // unset field entirely, so checking only for null would let `undefined`
    // through and post it as a value.
    const stored = row?.value ?? null;

    if (!row || stored === null) {
      missing.push({ code: measure.code, name: measure.name });
      continue;
    }

    // Re-validated on the way out even though it was validated on the way in.
    // The value may have been written by a seed, an import or an older build,
    // and a malformed decimal rejected locally costs nothing while the same
    // value rejected upstream costs a day of the feed.
    if (!isDecimalString(stored)) {
      invalid.push({ code: measure.code, value: stored, problem: "not a decimal string" });
      continue;
    }

    /**
     * Seeded figures are never sent.
     *
     * This is the last line of defence between the demo generator and the
     * board. Everything upstream of here — the banner, the per-tile label — is
     * advisory to a human reader; this is the check that holds when nobody is
     * looking, which is precisely when the 04:30 cron runs.
     */
    if (row.source === "seed") {
      demo.push({ code: measure.code, name: measure.name });
      continue;
    }

    documents.push({
      measureCode: measure.code,
      readingDate: period,
      value: stored,
      status: "POSTED",
      sourceUpdatedAt: isoWithOffset(row.sourceUpdatedAt ?? row.capturedAt ?? new Date()),
    });
  }

  return {
    batch: {
      sbuCode,
      // §8: our own reference, and the means of recovering a receipt after a
      // timeout. Date-scoped plus a random suffix so a retry is a genuinely
      // new batch while remaining traceable to the day it reports on.
      clientBatchRef: `dokuma-daily-${period}-${randomUUID().slice(0, 8)}`,
      // §2 sends `atomic: false`: each document is validated independently, so
      // one malformed figure does not suppress the other three.
      atomic: false,
      documents,
    },
    missing,
    invalid,
    demo,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type DispatchOutcome = "accepted" | "partial" | "rejected" | "error" | "skipped" | "validated";

export interface DispatchResult {
  outcome: DispatchOutcome;
  clientBatchRef: string;
  documentsSent: number;
  documentsAccepted: number;
  documentsRejected: number;
  httpStatus: number | null;
  batchId: string | null;
  detail: unknown;
  durationMs: number;
  missing: BuiltBatch["missing"];
  invalid: BuiltBatch["invalid"];
  demo: BuiltBatch["demo"];
}

/**
 * Builds and, when configured, sends the daily batch.
 *
 * Every attempt is logged to `sbu_kpi_dispatches` regardless of outcome —
 * including `skipped`, which is what an unconfigured feed records. That row is
 * what lets the dashboard distinguish "nothing was sent because the feed is
 * off" from "nothing was sent because the job never ran", which §11 identifies
 * as the failure that looks identical to success.
 */
export async function dispatchDailyFeed(options: {
  readingDate?: Date;
  /** Forces a build-and-log without sending, whatever the configured mode. */
  dryRun?: boolean;
  config?: OnePlatformConfig;
} = {}): Promise<DispatchResult> {
  const startedAt = Date.now();
  const config = options.config ?? resolveConfig();
  const readingDate = options.readingDate ?? currentDate();

  const built = await buildDailyBatch(readingDate, config.sbuCode);
  const { batch, missing, invalid, demo } = built;

  const finish = async (
    outcome: DispatchOutcome,
    extra: Partial<Pick<DispatchResult, "httpStatus" | "batchId" | "detail" | "documentsAccepted" | "documentsRejected">> = {},
  ): Promise<DispatchResult> => {
    const result: DispatchResult = {
      outcome,
      clientBatchRef: batch.clientBatchRef,
      documentsSent: batch.documents.length,
      documentsAccepted: extra.documentsAccepted ?? 0,
      documentsRejected: extra.documentsRejected ?? 0,
      httpStatus: extra.httpStatus ?? null,
      batchId: extra.batchId ?? null,
      detail: extra.detail ?? null,
      durationMs: Date.now() - startedAt,
      missing,
      invalid,
      demo,
    };

    await SbuKpiDispatch.create({
      sbuCode: config.sbuCode,
      clientBatchRef: result.clientBatchRef,
      readingDate,
      mode: outcome === "validated" || outcome === "skipped" ? "dry-run" : "send",
      outcome,
      batchId: result.batchId,
      httpStatus: result.httpStatus,
      documentsSent: result.documentsSent,
      documentsAccepted: result.documentsAccepted,
      documentsRejected: result.documentsRejected,
      detail: result.detail ?? { missing, invalid, demo },
      durationMs: result.durationMs,
    });

    // Mark what actually landed, so the capture screen can show a figure as
    // reported upstream rather than merely saved locally.
    if (outcome === "accepted" || outcome === "partial") {
      await SbuKpiReading.updateMany(
        {
          sbuCode: config.sbuCode,
          period: formatDateOnly(readingDate),
          measureCode: { $in: batch.documents.map((d) => d.measureCode) },
        },
        {
          $set: {
            syncState: "sent",
            syncBatchRef: result.clientBatchRef,
            syncedAt: new Date(),
            syncError: null,
          },
        },
      );
    }

    return result;
  };

  // Nothing to send is not a failure, but it IS the condition §11 says to
  // alert on, so it is recorded rather than returned silently.
  if (batch.documents.length === 0) {
    return finish("skipped", {
      detail: { reason: "No captured figures for this date.", missing, invalid, demo },
    });
  }

  if (options.dryRun || config.mode !== "live" || !config.credentials || !config.baseUrl) {
    return finish("validated", {
      detail: {
        reason: options.dryRun ? "Dry run requested." : (config.reason ?? "Feed is not live."),
        // The payload is returned so it can be inspected — this is what makes
        // a dry run useful before a key exists.
        payload: batch,
      },
    });
  }

  // ---- The one place bytes leave this process ----------------------------

  const path = operationalReadingsPath();
  // Serialised exactly ONCE (§7). `signed.body` is what gets sent.
  const body = JSON.stringify(batch);
  const signed = signRequest({
    method: "POST",
    path,
    body,
    credentials: config.credentials,
  });

  try {
    const response = await fetch(new URL(path, config.baseUrl), {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: AbortSignal.timeout(20_000),
    });

    const payload: unknown = await response.json().catch(() => null);

    /**
     * The platform wraps its receipt in `{ data: { … } }`, matching the
     * envelope in its documentation. Reading the top level alone silently
     * yielded zero counts and a null batchId on a perfectly successful send —
     * which reads as a failure in the cron log and would have had someone
     * debugging a working feed. Both shapes are accepted so a future
     * unwrapping on their side cannot break this.
     */
    const envelope = (payload ?? {}) as { data?: unknown };
    const receipt = ((envelope.data ?? payload) ?? {}) as {
      batchId?: string;
      status?: string;
      results?: { outcome?: string }[];
    };

    const results = receipt.results ?? [];
    const accepted = results.filter(
      (r) => r.outcome === "accepted" || r.outcome === "replaced" || r.outcome === "duplicate",
    ).length;
    const rejected = results.filter((r) => r.outcome === "rejected").length;

    // §8: ACCEPTED → 200, PARTIAL → 207, REJECTED → 422.
    const outcome: DispatchOutcome =
      response.status === 200
        ? "accepted"
        : response.status === 207
          ? "partial"
          : response.ok
            ? "accepted"
            : "rejected";

    return finish(outcome, {
      httpStatus: response.status,
      batchId: receipt.batchId ?? null,
      detail: payload,
      documentsAccepted: accepted,
      documentsRejected: rejected,
    });
  } catch (error) {
    /**
     * A network failure or timeout. The specification is emphatic (§8, §11):
     * never blind-retry a timed-out batch — the write may have landed. The
     * `clientBatchRef` is persisted by `finish()` precisely so recovery is a
     * lookup rather than a resend.
     */
    return finish("error", {
      detail: {
        error: error instanceof Error ? error.message : String(error),
        recovery: `GET /ingest/v1/batches?clientBatchRef=${batch.clientBatchRef}`,
        note: "Do not blind-retry; query the batch reference first.",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface FeedHealth {
  lastAttemptAt: string | null;
  lastAcceptedAt: string | null;
  lastOutcome: string | null;
  /** True when no batch has been accepted today — §11's alert condition. */
  staleToday: boolean;
  consecutiveFailures: number;
}

/**
 * Whether the feed is actually working.
 *
 * `staleToday` is the figure that matters: §11 says to alert on a day with no
 * accepted batch, because a silent feed and a genuine zero are
 * indistinguishable from the outside. The dashboard shows this next to the
 * figures so nobody reads a stale number as a current one.
 */
export async function getFeedHealth(sbuCode: string): Promise<FeedHealth> {
  const recent = await SbuKpiDispatch.find({ sbuCode }).sort({ attemptedAt: -1 }).limit(20).lean();

  const lastAccepted = recent.find((d) => d.outcome === "accepted" || d.outcome === "partial");

  let consecutiveFailures = 0;
  for (const row of recent) {
    if (row.outcome === "accepted" || row.outcome === "partial") break;
    if (row.outcome === "error" || row.outcome === "rejected") consecutiveFailures += 1;
    else break;
  }

  const today = formatDateOnly(currentDate());
  const acceptedToday = lastAccepted
    ? formatDateOnly(lastAccepted.readingDate) === today
    : false;

  return {
    lastAttemptAt: recent[0]?.attemptedAt.toISOString() ?? null,
    lastAcceptedAt: lastAccepted?.attemptedAt.toISOString() ?? null,
    lastOutcome: recent[0]?.outcome ?? null,
    staleToday: !acceptedToday,
    consecutiveFailures,
  };
}

/** Resolves a measure for display, tolerating an unknown stored code. */
export function describeMeasure(code: string): SbuKpiMeasure | null {
  return findMeasure(code) ?? null;
}
