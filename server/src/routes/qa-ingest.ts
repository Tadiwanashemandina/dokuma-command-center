import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DAILY_MEASURE_CODES, findMeasure, isDecimalString } from "@dokuma/shared";
import { SbuKpiReading, SbuKpiReadingHistory } from "../db/models/sbu-kpi.js";
import { HttpError } from "../middleware/error.js";
import { safeEqual } from "../services/password.js";
import { audit } from "../services/audit.js";
import { handle, ok } from "./helpers.js";

/**
 * Inbound feed from Dokuma's QA / scanning system.
 *
 * This is GAP 1 of the reporting chain:
 *
 *   [QA system] --> HERE --> [Command Centre DB] --> [One Platform]
 *
 * Until this existed, the four DAILY measures had no real source — only the
 * demo generator in `seed-group-kpis.ts`. A configured feed would then have
 * signed and posted fabricated numbers to the Office of the Chairman, which is
 * worse than posting nothing.
 *
 * ---------------------------------------------------------------------------
 * Why this is NOT the One Platform HMAC scheme
 * ---------------------------------------------------------------------------
 * This is a different trust boundary: an internal system on Dokuma's own
 * network talking to Dokuma's own platform. Full HMAC-SHA256 with nonce replay
 * protection is what the GROUP requires of us because we are an external party
 * to them; requiring the same of our own scanning system would mean asking that
 * team to implement canonical-string signing before they can send four numbers,
 * which is how an integration stalls for a quarter.
 *
 * A bearer key over HTTPS, compared in constant time, is the proportionate
 * control here. If this ever crosses the public internet from a third party,
 * revisit — `services/oneplatform/signing.ts` already has the pieces.
 *
 * Deliberately NOT session-authenticated: the caller is a machine with no user,
 * and `requireAuth` would force it to hold a password and a CSRF token.
 */

export const qaIngestRouter = Router();

/**
 * Authenticates the QA system.
 *
 * Fails CLOSED on an unset key: an unauthenticated write endpoint that feeds a
 * board-level measure is not something to leave open by default. The 503 says
 * "not configured" rather than 401 "wrong key", because those are different
 * problems for whoever is debugging.
 */
function assertQaCaller(header: string | undefined): void {
  const key = process.env["QA_INGEST_KEY"];

  if (!key) {
    throw new HttpError(503, "QA ingest is not configured.");
  }

  // A short key is a configuration error, not an auth failure. Catching it here
  // stops a deployment from running with a guessable credential.
  if (key.length < 32) {
    throw new HttpError(503, "QA_INGEST_KEY must be at least 32 characters.");
  }

  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !safeEqual(key, provided)) {
    throw new HttpError(401, "Unauthorized.");
  }
}

/**
 * The payload.
 *
 * Mirrors the Group's own operational-readings shape (§2) on purpose: the QA
 * team implements one document format, and it is the same one that eventually
 * reaches the board. `value` is a decimal STRING for the reason it is a string
 * everywhere in this system — 99.95 is not exactly representable as a float64,
 * and DATA_ACCURACY is measured to four places.
 */
const qaReadingSchema = z.object({
  measureCode: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => (DAILY_MEASURE_CODES as readonly string[]).includes(v), {
      // The same error name the Group platform uses, so a message seen here
      // reads identically to one seen from the ingest API.
      message: `MEASURE_NOT_RECOGNISED — expected one of ${DAILY_MEASURE_CODES.join(", ")}`,
    }),
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  value: z.string().refine(isDecimalString, "Expected a decimal string of up to 4 places"),
  status: z.enum(["POSTED", "VOIDED"]).default("POSTED"),
  /** When the QA system last changed the record — orders competing versions. */
  sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
  restatementReason: z.string().max(500).optional(),
});

const qaBatchSchema = z.object({
  /** The QA system's own reference, echoed back for reconciliation. */
  clientBatchRef: z.string().max(100).optional(),
  readings: z.array(qaReadingSchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// POST /api/qa-ingest/daily-readings
// ---------------------------------------------------------------------------

/**
 * Accepts the day's operational figures.
 *
 * Per-document outcomes rather than all-or-nothing, matching the Group's
 * `atomic: false` behaviour: one bad figure must not discard the other three.
 *
 * Idempotent. Resending an identical value is a `duplicate` no-op; a changed
 * value `replaced`s it and writes a history row. That is what makes a retry
 * after a timeout safe, which in turn is what stops a flaky network from
 * producing a day with no figures.
 */
qaIngestRouter.post(
  "/daily-readings",
  handle(async (req, res) => {
    assertQaCaller(req.get("authorization"));

    const body = qaBatchSchema.parse(req.body);
    const now = new Date();

    const results: {
      measureCode: string;
      readingDate: string;
      outcome: "accepted" | "replaced" | "duplicate" | "voided" | "stale";
    }[] = [];

    for (const reading of body.readings) {
      const measure = findMeasure(reading.measureCode);
      // Unreachable — zod already constrained the code — but a lookup that
      // returns nothing must not become an undefined dereference.
      if (!measure) continue;

      const sourceUpdatedAt = reading.sourceUpdatedAt ? new Date(reading.sourceUpdatedAt) : now;

      const existing = await SbuKpiReading.findOne({
        sbuCode: "DOKUMA",
        measureCode: measure.code,
        period: reading.readingDate,
      });

      /**
       * A resend carrying an OLDER `sourceUpdatedAt` than the stored version is
       * refused as stale — the Group's own rule (§11), applied here so a
       * replayed or out-of-order batch cannot overwrite a newer correction with
       * an older figure.
       */
      if (existing?.sourceUpdatedAt && sourceUpdatedAt < existing.sourceUpdatedAt) {
        results.push({
          measureCode: measure.code,
          readingDate: reading.readingDate,
          outcome: "stale",
        });
        continue;
      }

      // VOIDED removes the day's figure and records the reversal, rather than
      // deleting the row and losing the fact that it was withdrawn.
      if (reading.status === "VOIDED") {
        if (existing) {
          await SbuKpiReadingHistory.create({
            readingId: existing._id,
            sbuCode: "DOKUMA",
            measureCode: measure.code,
            period: reading.readingDate,
            previousValue: existing.value,
            newValue: null,
            restatementReason: reading.restatementReason ?? "VOIDED by source system",
            changedAt: now,
          });
          existing.value = null;
          existing.syncState = "pending";
          existing.sourceUpdatedAt = sourceUpdatedAt;
          await existing.save();
        }
        results.push({
          measureCode: measure.code,
          readingDate: reading.readingDate,
          outcome: "voided",
        });
        continue;
      }

      if (existing && existing.value === reading.value) {
        results.push({
          measureCode: measure.code,
          readingDate: reading.readingDate,
          outcome: "duplicate",
        });
        continue;
      }

      if (existing) {
        await SbuKpiReadingHistory.create({
          readingId: existing._id,
          sbuCode: "DOKUMA",
          measureCode: measure.code,
          period: reading.readingDate,
          previousValue: existing.value,
          newValue: reading.value,
          restatementReason: reading.restatementReason ?? null,
          changedAt: now,
        });

        existing.value = reading.value;
        existing.sourceUpdatedAt = sourceUpdatedAt;
        existing.capturedAt = now;
        // A changed figure has not been reported upstream yet, whatever its
        // previous state — so the nightly feed picks it up again.
        existing.syncState = "pending";
        existing.syncError = null;
        existing.source = "qa";
        await existing.save();

        results.push({
          measureCode: measure.code,
          readingDate: reading.readingDate,
          outcome: "replaced",
        });
        continue;
      }

      await SbuKpiReading.create({
        _id: randomUUID(),
        sbuCode: "DOKUMA",
        measureCode: measure.code,
        period: reading.readingDate,
        frequency: measure.frequency,
        value: reading.value,
        // No `capturedBy`: a machine wrote this, and attributing it to a user
        // would put a name against a figure nobody typed.
        capturedBy: null,
        capturedAt: now,
        sourceUpdatedAt,
        syncState: "pending",
        source: "qa",
      });

      results.push({
        measureCode: measure.code,
        readingDate: reading.readingDate,
        outcome: "accepted",
      });
    }

    await audit(req, {
      actorId: null,
      actorRole: null,
      action: "qa_ingest.daily_readings",
      entityType: "sbu_kpi_reading",
      entityId: body.clientBatchRef ?? null,
      metadata: {
        accepted: results.filter((r) => r.outcome === "accepted").length,
        replaced: results.filter((r) => r.outcome === "replaced").length,
        duplicate: results.filter((r) => r.outcome === "duplicate").length,
        stale: results.filter((r) => r.outcome === "stale").length,
      },
    });

    ok(res, {
      clientBatchRef: body.clientBatchRef ?? null,
      received: body.readings.length,
      results,
      at: now.toISOString(),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/qa-ingest/whoami
// ---------------------------------------------------------------------------

/**
 * A smoke test for the QA team's key, mirroring the Group's own
 * `/ingest/v1/whoami`. A 200 here means the key works and the endpoint is
 * reachable — everything else can then be debugged as a payload problem.
 */
qaIngestRouter.get(
  "/whoami",
  handle(async (req, res) => {
    assertQaCaller(req.get("authorization"));

    ok(res, {
      sbuCode: "DOKUMA",
      acceptedMeasures: DAILY_MEASURE_CODES,
      valueFormat: "decimal string, up to 4 decimal places",
      periodFormat: "YYYY-MM-DD",
      at: new Date().toISOString(),
    });
  }),
);
