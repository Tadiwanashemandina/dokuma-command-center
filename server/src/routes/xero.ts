import { Router } from "express";
import { z } from "zod";
import { FINANCE_READ, FINANCE_APPROVE, booleanFlag } from "@dokuma/shared";
import { XeroConnection, XeroSyncState, XeroStatement } from "../db/models/index.js";
import { requireRole, requireAuthContext } from "../middleware/auth.js";
import { HttpError } from "../middleware/http-error.js";
import { audit } from "../services/audit.js";
import { handle, ok, uuidParam } from "./helpers.js";
import { money, dateOnly, timestamp, nullable } from "./serializers.js";
import {
  resolveXeroConfig,
  describeXeroConfig,
  canPushToXero,
} from "../services/xero/config.js";
import {
  buildAuthorizationUrl,
  completeAuthorization,
  createOAuthState,
  verifyOAuthState,
  disconnect,
} from "../services/xero/auth.js";
import { syncTenant } from "../services/xero/sync.js";
import { pushTransaction, pushPendingTransactions } from "../services/xero/push.js";
import {
  fetchProfitAndLoss,
  fetchBalanceSheet,
  recomputeCompanyTotalsFromXero,
} from "../services/xero/statements.js";
import { currentMonthRange, today } from "../services/finance/reports.js";

/**
 * The Xero integration's endpoints.
 *
 * Authorization is deliberately asymmetric, and the split is the important
 * design decision in this file:
 *
 *   FINANCE_READ    — see the connection status and the synced figures.
 *   FINANCE_APPROVE — connect, disconnect, sync, and push.
 *
 * Connecting binds this system to an external accounting ledger, and pushing
 * writes into it. Neither is a routine finance-officer action: a mis-connected
 * tenant silently syncs the wrong organisation's books, and a push creates
 * entries a real accountant will reconcile. Both sit with the same tier that
 * publishes reports and marks creditors paid (admin, finance_manager), which
 * is where the legacy app already put irreversible finance decisions.
 */

export const xeroRouter = Router();

const readOnly = requireRole(FINANCE_READ);
const canManage = requireRole(FINANCE_APPROVE);

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Connection and sync health.
 *
 * Returns the configuration's `reason` when disabled, so the settings screen
 * can say "XERO_CLIENT_ID is not set" rather than showing a dead Connect
 * button — the same fail-closed-with-an-explanation contract the Group feed
 * status panel uses.
 */
xeroRouter.get(
  "/status",
  ...readOnly,
  handle(async (_req, res) => {
    const config = resolveXeroConfig();

    const connections = await XeroConnection.find()
      // Neither token is selected: both are `select: false`, and this endpoint
      // must never be the thing that leaks one.
      .select("tenantId tenantName tenantType status statusReason scopes lastRefreshedAt")
      .lean();

    const syncState = await XeroSyncState.find().lean();

    ok(res, {
      config: describeXeroConfig(config),
      can_push: canPushToXero(config),
      connections: connections.map((connection) => ({
        tenant_id: connection.tenantId,
        tenant_name: connection.tenantName,
        tenant_type: nullable(connection.tenantType),
        status: connection.status,
        status_reason: nullable(connection.statusReason),
        scopes: connection.scopes,
        last_refreshed_at: timestamp(connection.lastRefreshedAt),
      })),
      sync: syncState.map((state) => ({
        tenant_id: state.tenantId,
        resource: state.resource,
        status: state.status,
        last_run_at: timestamp(state.lastRunAt),
        last_success_at: timestamp(state.lastSuccessAt),
        last_modified_since: timestamp(state.lastModifiedSince),
        last_error: nullable(state.lastError),
        last_created: state.lastCreated,
        last_updated: state.lastUpdated,
        last_skipped: state.lastSkipped,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/**
 * Begins the OAuth flow.
 *
 * Returns the consent URL rather than issuing a 302. The client is a SPA
 * calling this with `fetch`, and a redirect would be followed by the fetch
 * rather than the browser — landing Xero's HTML in a JSON parser. The page
 * assigns `window.location` to the returned URL instead.
 */
xeroRouter.post(
  "/connect",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const config = resolveXeroConfig();

    if (config.mode === "disabled") {
      throw new HttpError(503, config.reason ?? "Xero is not configured.");
    }

    // Signed, user-bound, and short-lived — see createOAuthState for why this
    // is not optional.
    const state = createOAuthState(auth.user.id as string);

    ok(res, { authorization_url: buildAuthorizationUrl(config, state) });
  }),
);

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Completes the OAuth flow.
 *
 * `state` is verified against the CURRENT session's user, which is what binds
 * the callback to the browser that started it. Without that check, an attacker
 * can hand a logged-in administrator a crafted callback URL and connect their
 * own Xero organisation to this system — after which the finance module
 * cheerfully syncs someone else's ledger.
 */
xeroRouter.post(
  "/callback",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { code, state } = callbackSchema.parse(req.body);

    if (!verifyOAuthState(state, auth.user.id as string)) {
      throw new HttpError(
        400,
        "The authorization response could not be verified. Start the connection again.",
      );
    }

    const tenants = await completeAuthorization(code, auth.user.id as string);

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "xero_connected",
      entityType: "xero_connections",
      entityId: tenants[0]?.tenantId ?? null,
      metadata: { tenants: tenants.map((t) => t.tenantName) },
    });

    ok(res, { connected: tenants });
  }),
);

xeroRouter.delete(
  "/connections/:tenantId",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);

    const removed = await disconnect(tenantId);
    if (!removed) throw new HttpError(404, "No such Xero connection.");

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "xero_disconnected",
      entityType: "xero_connections",
      entityId: tenantId,
      metadata: {},
    });

    ok(res, {
      disconnected: true,
      /**
       * Said plainly because it would be easy to assume otherwise: deleting
       * the stored grant stops THIS system using Xero, but does not revoke the
       * app's access at Xero's end. Claiming a revocation we did not perform
       * would leave an administrator believing they had closed something that
       * is still open.
       */
      note: "The stored credentials were deleted. To revoke this app's access entirely, remove it under Settings → Connected Apps in Xero.",
    });
  }),
);

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const syncBodySchema = z.object({
  resources: z
    .array(z.enum(["accounts", "contacts", "bank-transactions", "invoices"]))
    .optional(),
});

xeroRouter.post(
  "/connections/:tenantId/sync",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);
    const { resources } = syncBodySchema.parse(req.body ?? {});

    const connection = await XeroConnection.findOne({ tenantId }).select("_id").lean();
    if (!connection) throw new HttpError(404, "No such Xero connection.");

    const result = await syncTenant(tenantId, resources);

    // Receivables depend on the invoices that were just pulled, so this runs
    // after rather than as part of the resource loop.
    const totals = await recomputeCompanyTotalsFromXero(tenantId);

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "xero_sync_run",
      entityType: "xero_sync_state",
      entityId: tenantId,
      metadata: {
        outcomes: result.outcomes,
        errors: result.errors,
      },
    });

    ok(res, {
      outcomes: result.outcomes,
      /**
       * Partial failure is reported as data with a 200, not as an error
       * status. A run where three resources succeeded and one failed is not a
       * failed request — and returning 500 would hide the three that worked.
       */
      errors: result.errors,
      company_totals: totals,
    });
  }),
);

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

xeroRouter.post(
  "/connections/:tenantId/push/:id",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);
    const transactionId = uuidParam(req);

    const result = await pushTransaction(transactionId, tenantId, auth.user.id as string);

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "xero_transaction_pushed",
      entityType: "finance_transactions",
      entityId: transactionId,
      metadata: {
        status: result.status,
        xero_transaction_id: result.xeroTransactionId,
        reason: result.reason,
      },
    });

    ok(res, {
      transaction_id: result.transactionId,
      status: result.status,
      xero_transaction_id: result.xeroTransactionId,
      reason: result.reason,
    });
  }),
);

const pushAllSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});

xeroRouter.post(
  "/connections/:tenantId/push",
  ...canManage,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);
    const { limit } = pushAllSchema.parse(req.body ?? {});

    const results = await pushPendingTransactions(tenantId, auth.user.id as string, limit);

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "xero_bulk_push",
      entityType: "finance_transactions",
      entityId: null,
      metadata: { sent, failed, skipped, limit },
    });

    ok(res, { sent, failed, skipped, results });
  }),
);

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const statementQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Re-fetch from Xero rather than reading the stored snapshot. */
  refresh: booleanFlag.default(false),
});

/**
 * Profit & Loss.
 *
 * Reads the stored snapshot by default and only calls Xero when `refresh` is
 * set. A board pack has to be reproducible, and re-deriving the figures on
 * every view means the same report can show different numbers on different
 * days — see the note at the top of `statements.ts`.
 */
xeroRouter.get(
  "/connections/:tenantId/profit-and-loss",
  ...readOnly,
  handle(async (req, res) => {
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);
    const query = statementQuerySchema.parse(req.query);

    const range = currentMonthRange();
    const periodStart = query.period_start ?? range.start;
    const periodEnd = query.period_end ?? range.end;

    if (query.refresh) {
      ok(res, await fetchProfitAndLoss(tenantId, periodStart, periodEnd));
      return;
    }

    const stored = await XeroStatement.findOne({
      tenantId,
      type: "profit-and-loss",
      periodStart: new Date(`${periodStart}T00:00:00Z`),
      periodEnd: new Date(`${periodEnd}T00:00:00Z`),
    }).lean();

    if (!stored) {
      // No snapshot for this period yet. Distinct from "the figures are zero",
      // which is why this is null rather than an empty statement.
      ok(res, null);
      return;
    }

    ok(res, {
      id: stored._id,
      type: stored.type,
      period_start: dateOnly(stored.periodStart),
      period_end: dateOnly(stored.periodEnd),
      revenue: money(stored.revenue),
      gross_profit: money(stored.grossProfit),
      net_profit: money(stored.netProfit),
      currency: stored.currency,
      fetched_at: timestamp(stored.fetchedAt),
    });
  }),
);

xeroRouter.get(
  "/connections/:tenantId/balance-sheet",
  ...readOnly,
  handle(async (req, res) => {
    const tenantId = z.string().min(1).parse(req.params["tenantId"]);
    const query = statementQuerySchema.parse(req.query);
    const asAt = query.period_end ?? today();

    if (query.refresh) {
      ok(res, await fetchBalanceSheet(tenantId, asAt));
      return;
    }

    const stored = await XeroStatement.findOne({
      tenantId,
      type: "balance-sheet",
      periodEnd: new Date(`${asAt}T00:00:00Z`),
    }).lean();

    if (!stored) {
      ok(res, null);
      return;
    }

    ok(res, {
      id: stored._id,
      type: stored.type,
      as_at: dateOnly(stored.periodEnd),
      total_assets: money(stored.totalAssets),
      total_liabilities: money(stored.totalLiabilities),
      net_assets: money(stored.netAssets),
      currency: stored.currency,
      fetched_at: timestamp(stored.fetchedAt),
    });
  }),
);
