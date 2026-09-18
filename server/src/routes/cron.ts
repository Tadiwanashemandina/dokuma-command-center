import { Router } from "express";
import { refreshKpiFeed } from "../services/kpi.js";
import { dispatchDailyFeed } from "../services/oneplatform/daily-feed.js";
import { syncAllProjects } from "../services/jira/sync.js";
import { XeroConnection } from "../db/models/index.js";
import { syncTenant } from "../services/xero/sync.js";
import { recomputeCompanyTotalsFromXero } from "../services/xero/statements.js";
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

/**
 * GET /api/cron/xero-sync — pulls the day's changes from every connected
 * Xero organisation.
 *
 * Incremental: each resource carries its own `If-Modified-Since` cursor, so a
 * daily run transfers only what changed rather than replaying the whole
 * ledger. The first run after connecting is the expensive one.
 *
 * Safe to schedule before Xero is configured, exactly like the group feed
 * above: with no connections stored this finds nothing to do and returns an
 * empty result without opening a connection. So it can be deployed today and
 * simply start working on the day someone completes the OAuth flow.
 *
 * Always 200 on a reachable outcome, including a partially failed sync. A 500
 * would make Vercel retry, and a retry of a run that already advanced some
 * cursors does redundant work for no benefit — the per-resource failure is
 * recorded in `xero_sync_state` and surfaced on the settings page, which is
 * where someone can actually act on it.
 *
 * Scheduled at 03:30, deliberately ahead of the 04:30 group feed: the
 * receivables figure the feed may eventually carry should be computed from
 * that morning's Xero data, not the previous day's.
 */
cronRouter.get(
  "/xero-sync",
  handle(async (req, res) => {
    assertCronCaller(req.get("authorization"));

    const startedAt = Date.now();

    const connections = await XeroConnection.find({ status: "active" })
      .select("tenantId tenantName")
      .lean();

    const results: {
      tenantId: string;
      tenantName: string;
      outcomes: unknown[];
      errors: unknown[];
    }[] = [];

    for (const connection of connections) {
      // One tenant's failure must not stop the others — they are independent
      // organisations and a rate limit on one says nothing about the rest.
      try {
        const result = await syncTenant(connection.tenantId);
        await recomputeCompanyTotalsFromXero(connection.tenantId);
        results.push({
          tenantId: connection.tenantId,
          tenantName: connection.tenantName,
          outcomes: result.outcomes,
          errors: result.errors,
        });
      } catch (error) {
        results.push({
          tenantId: connection.tenantId,
          tenantName: connection.tenantName,
          outcomes: [],
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
        });
      }
    }

    ok(res, {
      job: "xero-sync",
      tenantsProcessed: results.length,
      results,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/cron/jira-sync — pulls Jira issues into the portfolio.
 *
 * Incremental: each mapping fetches only issues updated since its watermark, so
 * a routine run is a handful of issues rather than a full board.
 *
 * Runs at 03:00, before the 04:30 Group feed, so any delivery measures derived
 * from Jira reflect the same day's work rather than yesterday's.
 *
 * Always 200 on a reachable outcome, including a partial sync — the sync row
 * carries the real result, and a 500 here would make Vercel retry work that
 * already half-succeeded.
 */
cronRouter.get(
  "/jira-sync",
  handle(async (req, res) => {
    assertCronCaller(req.get("authorization"));

    const result = await syncAllProjects({ mode: "cron" });

    ok(res, {
      job: "jira-sync",
      outcome: result.outcome,
      projectsSynced: result.projectsSynced,
      issuesFetched: result.issuesFetched,
      tasksCreated: result.tasksCreated,
      tasksUpdated: result.tasksUpdated,
      errors: result.errors,
      durationMs: result.durationMs,
      at: new Date().toISOString(),
    });
  }),
);
