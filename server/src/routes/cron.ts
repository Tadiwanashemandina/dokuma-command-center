import { Router } from "express";
import { refreshKpiFeed } from "../services/kpi.js";
import { dispatchDailyFeed } from "../services/oneplatform/daily-feed.js";
import { handle, ok } from "./helpers.js";
import { HttpError } from "../middleware/error.js";
import { safeEqual } from "../services/password.js";

/**
 * Scheduled jobs.
 *
 * Authenticated by a shared secret rather than a session, because the caller is
 * Vercel Cron, not a person. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * on every scheduled invocation.
 *
 * The endpoint is otherwise public, so the check is the only thing standing
 * between an anonymous caller and an unbounded write loop — it is compared in
 * constant time, and a missing secret refuses rather than defaulting open.
 */

export const cronRouter = Router();

function assertCronCaller(header: string | undefined): void {
  const secret = process.env["CRON_SECRET"];

  // No configured secret means the endpoint cannot be authenticated, so it
  // must not run. Failing closed here is deliberate: the alternative is an
  // unauthenticated write endpoint in production.
  if (!secret) {
    throw new HttpError(503, "Scheduled jobs are not configured.");
  }

  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !safeEqual(secret, provided)) {
    throw new HttpError(401, "Unauthorized.");
  }
}

/**
 * GET /api/cron/kpi-snapshot — writes today's row into `kpi_feed`.
 *
 * This is what gives every KPI a trend. `kpi_feed` has always been keyed on
 * `(company, metric_name, as_of_date)` so it can hold one row per metric per
 * day, but nothing ran it on a schedule — so it held a single snapshot and no
 * card could honestly show a sparkline or a delta.
 *
 * Idempotent: the upsert means running twice in a day overwrites rather than
 * duplicating, so a retry is safe and a manual run costs nothing.
 */
cronRouter.get(
  "/kpi-snapshot",
  handle(async (req, res) => {
    assertCronCaller(req.get("authorization"));

    const startedAt = Date.now();
    await refreshKpiFeed();

    ok(res, {
      job: "kpi-snapshot",
      metricsWritten: 12,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/cron/group-feed — pushes the day's four DAILY measures upstream.
 *
 * This is the nightly job §0 of the Group KPI & Ingestion Specification says
 * Dokuma's engineers build: four numbers, one endpoint, once a day.
 *
 * Safe to schedule before a signing key exists. `dispatchDailyFeed()` resolves
 * its configuration at call time and returns `validated` — building the batch
 * and logging it without opening a connection — whenever the feed is not fully
 * configured. So this can run in production from today and simply start
 * sending on the deploy that adds the key, with the intervening runs serving as
 * a record that the payload was correct all along.
 *
 * Always 200 on a reachable outcome, including a rejected batch. The dispatch
 * row carries the real result; a 500 here would make Vercel retry a batch the
 * far end has already seen, which §11 explicitly warns against.
 */
cronRouter.get(
  "/group-feed",
  handle(async (req, res) => {
    assertCronCaller(req.get("authorization"));

    const result = await dispatchDailyFeed();

    ok(res, {
      job: "group-feed",
      outcome: result.outcome,
      clientBatchRef: result.clientBatchRef,
      documentsSent: result.documentsSent,
      documentsAccepted: result.documentsAccepted,
      documentsRejected: result.documentsRejected,
      // Surfaced so a missing figure is visible in the cron log rather than
      // only in the database — a measure silently omitted every night is the
      // failure mode this feed is most likely to have.
      missing: result.missing.map((m: { code: string }) => m.code),
      invalid: result.invalid.map((m: { code: string }) => m.code),
      durationMs: result.durationMs,
      at: new Date().toISOString(),
    });
  }),
);
