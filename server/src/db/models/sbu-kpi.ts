import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { KPI_FREQUENCIES } from "@dokuma/shared";
import { uuidPk, uuidRef, dateOnly } from "../types.js";

/**
 * Storage for the Group SBU measures — the 45 bespoke + 14 spine figures of the
 * KPI & Ingestion Specification.
 *
 * Deliberately a NEW collection rather than an extension of `kpi_feed`.
 * `kpi_feed` is a frozen external contract (inventory §10, D-13): twelve fixed
 * metric names polled by a consumer whose auth model is still unagreed. Adding
 * 59 more rows to it would be a breaking change to that consumer, silently, by
 * making a query that returned 12 rows return 71.
 *
 * The two are related but not the same thing:
 *
 *   kpi_feed       — what Dokuma publishes about ITSELF, internally defined.
 *   sbu_kpi_readings — what Dokuma reports UPWARD, on the Group's register.
 *
 * ---------------------------------------------------------------------------
 * Why `value` is a string
 * ---------------------------------------------------------------------------
 * Not Decimal128, which is what D-12 requires of money. These figures are not
 * all money, and the one that matters most is a percentage: DATA_ACCURACY has a
 * target of ≥ 99.95, and the Group platform accepts it as a decimal STRING of
 * up to 4 places. Storing it as a string means the value captured, the value
 * displayed, and the value on the wire are byte-identical, with no conversion
 * that could round 99.9950 to 99.99 on the boundary between a legal land title
 * being right and being wrong.
 *
 * The shape is validated by `isDecimalString()` from the shared register before
 * anything is written, so this is a constrained string, not a free-text field.
 */

const SYNC_STATES = ["pending", "sent", "failed", "not-applicable"] as const;

export type SbuKpiSyncState = (typeof SYNC_STATES)[number];

const sbuKpiReadingSchema = new Schema(
  {
    _id: uuidPk,

    /** Always `DOKUMA` today; stored so a second SBU needs no migration. */
    sbuCode: { type: String, required: true, default: "DOKUMA", index: true },

    /** A code from the shared register. Validated against it at the boundary. */
    measureCode: { type: String, required: true, uppercase: true, trim: true },

    /**
     * `YYYY-MM-DD` for DAILY measures, `YYYY-MM` for everything else.
     *
     * Kept as a STRING rather than a Date because the two formats are not the
     * same granularity, and a `YYYY-MM` stored as a Date would silently become
     * the first of the month — making "September 2026" and "1 September 2026"
     * indistinguishable, which matters when one is a monthly figure and the
     * other could be a daily one.
     */
    period: { type: String, required: true },

    /** The register's frequency at time of capture, denormalised for querying. */
    frequency: { type: String, required: true, enum: KPI_FREQUENCIES },

    /** A decimal string of up to 4 places, or null when cleared. */
    value: { type: String, default: null },

    /** ISO-4217, only meaningful for CURRENCY measures. */
    currency: { type: String, default: null },

    note: { type: String, default: null, maxlength: 500 },

    // -----------------------------------------------------------------------
    // Provenance
    // -----------------------------------------------------------------------

    /**
     * Who last set this figure, or null when a machine did.
     *
     * A board-level measure with no attribution is a measure nobody can be
     * asked about, so this is recorded for every manual capture.
     */
    capturedBy: uuidRef("User"),

    capturedAt: { type: Date, required: true, default: () => new Date() },

    /**
     * When the SOURCE system last changed this record — the specification's
     * `sourceUpdatedAt`, which orders competing versions.
     *
     * The specification is explicit that a resend carrying an OLDER
     * `sourceUpdatedAt` than the stored version is refused as stale, so this
     * must genuinely track when the value changed, not when it was sent.
     */
    sourceUpdatedAt: { type: Date, required: true, default: () => new Date() },

    // -----------------------------------------------------------------------
    // Upstream sync
    // -----------------------------------------------------------------------

    /**
     * Whether this figure has reached the Group platform.
     *
     * `not-applicable` covers the spine, which is derived upstream and never
     * posted — distinct from `pending`, which means "owed but not yet sent".
     * Conflating them would make the spine look permanently overdue.
     */
    syncState: { type: String, required: true, enum: SYNC_STATES, default: "pending", index: true },

    /** The batch that carried it, for matching against a receipt. */
    syncBatchRef: { type: String, default: null },

    syncedAt: { type: Date, default: null },

    /** The last upstream rejection, kept so a failure is diagnosable on screen. */
    syncError: { type: String, default: null },

    /**
     * Where this figure came from.
     *
     *   seed   — the demo generator. NOT a real measurement.
     *   qa     — pushed by Dokuma's QA/scanning system.
     *   manual — typed in by a person.
     *
     * `seed` exists so the dashboard can say plainly that a figure is
     * fabricated. A demo number that looks identical to a measured one is how
     * an invented 142,380 deeds ends up quoted in a board pack — and worse,
     * how it ends up signed and posted to the Group. The flag is what lets the
     * UI refuse to present it as fact.
     */
    source: {
      type: String,
      required: true,
      enum: ["seed", "qa", "manual"],
      default: "manual",
      index: true,
    },
  },
  { timestamps: false },
);

/**
 * One figure per measure per period per SBU.
 *
 * Unique because a resend REPLACES rather than appends — the specification's
 * rule for `measureCode` + `readingDate`. History lives in
 * `sbu_kpi_reading_history`, written on every replacement, so this collection
 * always holds exactly the current truth and a query never has to pick a
 * winner from duplicates.
 */
sbuKpiReadingSchema.index(
  { sbuCode: 1, measureCode: 1, period: 1 },
  { unique: true, name: "uniq_sbu_kpi_reading" },
);

/** Drives the capture sheet, which loads one period at a time. */
sbuKpiReadingSchema.index({ sbuCode: 1, period: -1 }, { name: "idx_sbu_kpi_reading_period" });

/** Drives the daily feed's "what is owed upstream" query. */
sbuKpiReadingSchema.index({ syncState: 1, period: -1 }, { name: "idx_sbu_kpi_reading_sync" });

export type SbuKpiReadingDoc = InferSchemaType<typeof sbuKpiReadingSchema>;
export const SbuKpiReading: Model<SbuKpiReadingDoc> = model<SbuKpiReadingDoc>(
  "SbuKpiReading",
  sbuKpiReadingSchema,
  "sbu_kpi_readings",
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Every superseded value.
 *
 * The specification requires that resending a changed value "writes a history
 * row", and that a correction carries a `restatementReason`. A board-level
 * figure that changes without a trace of what it was before is exactly the
 * thing an auditor asks about, so the previous value is preserved rather than
 * overwritten.
 *
 * Append-only: nothing in this codebase updates or deletes from here.
 */
const sbuKpiReadingHistorySchema = new Schema(
  {
    _id: uuidPk,
    readingId: uuidRef("SbuKpiReading", { required: true, index: true }),
    sbuCode: { type: String, required: true },
    measureCode: { type: String, required: true },
    period: { type: String, required: true },

    /** The value being replaced, and the one replacing it. */
    previousValue: { type: String, default: null },
    newValue: { type: String, default: null },

    restatementReason: { type: String, default: null, maxlength: 500 },

    changedBy: uuidRef("User"),
    changedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

sbuKpiReadingHistorySchema.index(
  { sbuCode: 1, measureCode: 1, changedAt: -1 },
  { name: "idx_sbu_kpi_history_measure" },
);

export type SbuKpiReadingHistoryDoc = InferSchemaType<typeof sbuKpiReadingHistorySchema>;
export const SbuKpiReadingHistory: Model<SbuKpiReadingHistoryDoc> = model<SbuKpiReadingHistoryDoc>(
  "SbuKpiReadingHistory",
  sbuKpiReadingHistorySchema,
  "sbu_kpi_reading_history",
);

// ---------------------------------------------------------------------------
// Feed dispatch log
// ---------------------------------------------------------------------------

/**
 * One row per attempt to push a batch upstream.
 *
 * This exists because of the specification's closing instruction in §11:
 * "alert on a day with no accepted batch — a silent feed and a genuine zero
 * look the same from the outside". Without a log of attempts, a feed that
 * stopped running is indistinguishable from a feed reporting nothing, and the
 * dashboard cannot honestly say whether today's figures reached the board.
 *
 * It also holds `clientBatchRef`, which is the specification's prescribed way
 * to recover a receipt after a timeout — the one thing that makes a blind
 * retry unnecessary.
 */
const sbuKpiDispatchSchema = new Schema(
  {
    _id: uuidPk,
    sbuCode: { type: String, required: true, default: "DOKUMA" },

    /** Our own reference, echoed back on the receipt. Unique per attempt. */
    clientBatchRef: { type: String, required: true },

    /** The business date the batch reported on. */
    readingDate: dateOnly({ required: true }),

    /** `dry-run` never leaves this process; `send` attempts the network. */
    mode: { type: String, required: true, enum: ["dry-run", "send"], default: "send" },

    outcome: {
      type: String,
      required: true,
      enum: ["accepted", "partial", "rejected", "error", "skipped", "validated"],
    },

    /** The platform's batch id, when it got far enough to issue one. */
    batchId: { type: String, default: null },

    httpStatus: { type: Number, default: null },

    documentsSent: { type: Number, required: true, default: 0 },
    documentsAccepted: { type: Number, required: true, default: 0 },
    documentsRejected: { type: Number, required: true, default: 0 },

    /**
     * The receipt or error detail, as returned.
     *
     * `Schema.Types.Mixed` because the shape is the platform's to define, and
     * pinning it here would mean a spec change surfaces as a cast error that
     * loses the very diagnostic we stored it for.
     */
    detail: { type: Schema.Types.Mixed, default: null },

    durationMs: { type: Number, default: null },
    attemptedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

sbuKpiDispatchSchema.index({ clientBatchRef: 1 }, { unique: true, name: "uniq_sbu_kpi_dispatch_ref" });
sbuKpiDispatchSchema.index({ attemptedAt: -1 }, { name: "idx_sbu_kpi_dispatch_recent" });

export type SbuKpiDispatchDoc = InferSchemaType<typeof sbuKpiDispatchSchema>;
export const SbuKpiDispatch: Model<SbuKpiDispatchDoc> = model<SbuKpiDispatchDoc>(
  "SbuKpiDispatch",
  sbuKpiDispatchSchema,
  "sbu_kpi_dispatches",
);
