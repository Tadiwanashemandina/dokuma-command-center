import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { uuidPk, uuidRef, money, dateOnly, timestampOptions } from "../types.js";

/**
 * Xero integration state.
 *
 * Two collections, and the split between them is the important part:
 *
 *   - `xero_connections` holds the OAuth grant — refresh token, tenant, scopes.
 *     One row per connected Xero organisation. This is the only place a token
 *     is ever written, and it is never returned over the API.
 *   - `xero_sync_state` holds one row per (tenant, resource) recording where
 *     the last incremental pull got to. Xero's `If-Modified-Since` contract is
 *     per-resource, so a failed Invoices pull must not roll back the Accounts
 *     cursor — hence a row each rather than one blob.
 *
 * Nothing here duplicates ledger data. Synced transactions land in
 * `finance_transactions` with `source: "xero-sync"` and the Xero id on the
 * row itself, so there is exactly one ledger and one balance calculation.
 */

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export const XERO_CONNECTION_STATUSES = ["active", "expired", "revoked"] as const;

const xeroConnectionSchema = new Schema(
  {
    _id: uuidPk,
    /** Xero's tenant (organisation) id. Unique — one row per org. */
    tenantId: { type: String, required: true },
    tenantName: { type: String, required: true },
    tenantType: { type: String, default: null },

    /**
     * The refresh token. Xero rotates this on EVERY refresh and invalidates
     * the previous one, so a lost write here permanently breaks the
     * connection — `refreshAccessToken()` persists it before returning the
     * access token for exactly that reason.
     *
     * `select: false` so a stray `.find()` cannot leak it into a response
     * body, matching how `passwordHash` is handled on the User model.
     */
    refreshToken: { type: String, required: true, select: false },
    /**
     * The access token is cached only to avoid a refresh round-trip on every
     * call; it is short-lived (30 minutes) and always re-derived when stale.
     */
    accessToken: { type: String, default: null, select: false },
    accessTokenExpiresAt: { type: Date, default: null },

    /** Granted scopes, as returned by the token endpoint. */
    scopes: { type: [String], required: true, default: () => [] },

    status: {
      type: String,
      required: true,
      default: "active",
      enum: XERO_CONNECTION_STATUSES,
    },
    /**
     * Why a connection stopped working, for the settings screen. A user
     * seeing "disconnected" with no reason will reconnect blindly; a user
     * seeing "refresh token rejected — reauthorise" knows what to do.
     */
    statusReason: { type: String, default: null },

    connectedBy: uuidRef("User"),
    lastRefreshedAt: { type: Date, default: null },
  },
  timestampOptions,
);

xeroConnectionSchema.index({ tenantId: 1 }, { unique: true, name: "uniq_xero_connection_tenant" });

export type XeroConnectionDoc = InferSchemaType<typeof xeroConnectionSchema>;
export const XeroConnection: Model<XeroConnectionDoc> = model<XeroConnectionDoc>(
  "XeroConnection",
  xeroConnectionSchema,
  "xero_connections",
);

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export const XERO_RESOURCES = [
  "accounts",
  "bank-transactions",
  "invoices",
  "contacts",
  "profit-and-loss",
  "balance-sheet",
] as const;

export type XeroResource = (typeof XERO_RESOURCES)[number];

export const XERO_SYNC_STATUSES = ["idle", "running", "ok", "failed"] as const;

const xeroSyncStateSchema = new Schema(
  {
    _id: uuidPk,
    tenantId: { type: String, required: true },
    resource: { type: String, required: true, enum: XERO_RESOURCES },

    /**
     * The `If-Modified-Since` cursor for the next pull. Xero compares this
     * against `UpdatedDateUTC` server-side.
     *
     * Advanced ONLY after a resource's pull fully succeeds. Advancing it
     * optimistically would permanently skip every record in a page that
     * failed halfway — those rows would never be seen again, because the next
     * pull asks for changes after the cursor.
     */
    lastModifiedSince: { type: Date, default: null },

    status: { type: String, required: true, default: "idle", enum: XERO_SYNC_STATUSES },
    lastRunAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    /** Counters from the most recent run, for the sync status panel. */
    lastCreated: { type: Number, required: true, default: 0 },
    lastUpdated: { type: Number, required: true, default: 0 },
    lastSkipped: { type: Number, required: true, default: 0 },
  },
  timestampOptions,
);

xeroSyncStateSchema.index(
  { tenantId: 1, resource: 1 },
  { unique: true, name: "uniq_xero_sync_tenant_resource" },
);

export type XeroSyncStateDoc = InferSchemaType<typeof xeroSyncStateSchema>;
export const XeroSyncState: Model<XeroSyncStateDoc> = model<XeroSyncStateDoc>(
  "XeroSyncState",
  xeroSyncStateSchema,
  "xero_sync_state",
);

// ---------------------------------------------------------------------------
// Financial statements pulled from Xero
// ---------------------------------------------------------------------------

export const XERO_STATEMENT_TYPES = ["profit-and-loss", "balance-sheet"] as const;

/**
 * A snapshot of a Xero-computed financial statement.
 *
 * Stored rather than fetched on demand because these are the figures that
 * feed the Group spine measures (REVENUE, EBITDA), and a board pack must be
 * reproducible: re-running the same report against Xero months later can
 * return different numbers if the period was reopened and adjusted. The
 * snapshot records what was true when it was taken.
 *
 * `lines` is Mixed — Xero's report rows are a nested, section-shaped
 * structure that varies by report and by organisation's chart of accounts.
 */
const xeroStatementSchema = new Schema(
  {
    _id: uuidPk,
    tenantId: { type: String, required: true },
    type: { type: String, required: true, enum: XERO_STATEMENT_TYPES },
    periodStart: dateOnly({ required: true }),
    periodEnd: dateOnly({ required: true }),

    /** Headline figures extracted from `lines` for cheap querying. */
    revenue: money(),
    grossProfit: money(),
    netProfit: money(),
    totalAssets: money(),
    totalLiabilities: money(),
    netAssets: money(),

    currency: { type: String, required: true, default: "USD" },
    lines: { type: Schema.Types.Mixed, required: true, default: () => ({}) },

    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  timestampOptions,
);

xeroStatementSchema.index(
  { tenantId: 1, type: 1, periodStart: 1, periodEnd: 1 },
  { unique: true, name: "uniq_xero_statement_period" },
);

export type XeroStatementDoc = InferSchemaType<typeof xeroStatementSchema>;
export const XeroStatement: Model<XeroStatementDoc> = model<XeroStatementDoc>(
  "XeroStatement",
  xeroStatementSchema,
  "xero_statements",
);

// ---------------------------------------------------------------------------
// Receivables (ACCREC invoices)
// ---------------------------------------------------------------------------

export const XERO_INVOICE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "AUTHORISED",
  "PAID",
  "VOIDED",
  "DELETED",
] as const;

/**
 * Sales invoices pulled from Xero, which are what "outstanding receivables"
 * actually means.
 *
 * Kept in their own collection rather than folded into `finance_creditors`
 * (which holds payables) because they are the opposite side of the ledger and
 * every query that wants one specifically does not want the other. The
 * headline receivables figure on `finance_company_totals` is derived from the
 * sum of `amountDue` here where the status is AUTHORISED.
 *
 * VOIDED and DELETED invoices are stored rather than dropped: an invoice that
 * disappears between syncs must be able to disappear from the total too, and
 * that only works if we can see it was voided.
 */
const xeroInvoiceSchema = new Schema(
  {
    _id: uuidPk,
    tenantId: { type: String, required: true },
    xeroInvoiceId: { type: String, required: true },
    invoiceNumber: { type: String, default: null },
    reference: { type: String, default: null },

    contactId: { type: String, default: null },
    contactName: { type: String, default: null },

    status: { type: String, required: true, enum: XERO_INVOICE_STATUSES },
    currency: { type: String, required: true, default: "USD" },

    subTotal: money(),
    totalTax: money(),
    total: money({ required: true, default: 0 }),
    amountDue: money({ required: true, default: 0 }),
    amountPaid: money({ required: true, default: 0 }),

    issueDate: dateOnly(),
    dueDate: dateOnly(),
    fullyPaidOnDate: dateOnly(),

    /** Best-effort link to a local client, matched on name. Never assumed. */
    clientId: uuidRef("Client"),

    xeroUpdatedAt: { type: Date, default: null },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  timestampOptions,
);

xeroInvoiceSchema.index(
  { xeroInvoiceId: 1 },
  { unique: true, name: "uniq_xero_invoice_id" },
);
// The receivables total filters status and sums amountDue over this pair.
xeroInvoiceSchema.index({ tenantId: 1, status: 1, dueDate: 1 }, { name: "idx_xero_invoice_status_due" });

export type XeroInvoiceDoc = InferSchemaType<typeof xeroInvoiceSchema>;
export const XeroInvoice: Model<XeroInvoiceDoc> = model<XeroInvoiceDoc>(
  "XeroInvoice",
  xeroInvoiceSchema,
  "xero_invoices",
);

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const xeroContactSchema = new Schema(
  {
    _id: uuidPk,
    tenantId: { type: String, required: true },
    xeroContactId: { type: String, required: true },
    name: { type: String, required: true },
    emailAddress: { type: String, default: null },
    /** Xero's own flags — a contact can be both, or neither. */
    isCustomer: { type: Boolean, required: true, default: false },
    isSupplier: { type: Boolean, required: true, default: false },
    contactStatus: { type: String, default: null },

    /** Best-effort link to a local client, matched on name. */
    clientId: uuidRef("Client"),

    xeroUpdatedAt: { type: Date, default: null },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  timestampOptions,
);

xeroContactSchema.index({ xeroContactId: 1 }, { unique: true, name: "uniq_xero_contact_id" });
xeroContactSchema.index({ tenantId: 1, name: 1 }, { name: "idx_xero_contact_name" });

export type XeroContactDoc = InferSchemaType<typeof xeroContactSchema>;
export const XeroContact: Model<XeroContactDoc> = model<XeroContactDoc>(
  "XeroContact",
  xeroContactSchema,
  "xero_contacts",
);

// ---------------------------------------------------------------------------
// Outbound push queue
// ---------------------------------------------------------------------------

export const XERO_PUSH_STATUSES = ["pending", "sent", "failed", "skipped"] as const;

/**
 * One row per local transaction we intend to push UP into Xero.
 *
 * This table is what makes the push idempotent, and that is its entire
 * reason for existing. Without it, a push that times out after Xero has
 * already committed the entry is indistinguishable from one that never
 * arrived — and retrying creates a duplicate in somebody's real ledger.
 *
 * The `idempotencyKey` is sent as Xero's `Idempotency-Key` header and is
 * derived from the local transaction id, so a retry of the same transaction
 * is collapsed by Xero itself even if this row was lost.
 */
const xeroPushQueueSchema = new Schema(
  {
    _id: uuidPk,
    tenantId: { type: String, required: true },
    transactionId: uuidRef("FinanceTransaction", { required: true }),
    idempotencyKey: { type: String, required: true },

    status: { type: String, required: true, default: "pending", enum: XERO_PUSH_STATUSES },
    attempts: { type: Number, required: true, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    /** Set once Xero accepts it. Also written back onto the transaction. */
    xeroTransactionId: { type: String, default: null },

    requestedBy: uuidRef("User"),
  },
  timestampOptions,
);

// One push row per transaction — the uniqueness constraint that stops a
// double-click from queueing the same entry twice.
xeroPushQueueSchema.index(
  { transactionId: 1 },
  { unique: true, name: "uniq_xero_push_transaction" },
);
xeroPushQueueSchema.index({ status: 1, createdAt: 1 }, { name: "idx_xero_push_status" });

export type XeroPushQueueDoc = InferSchemaType<typeof xeroPushQueueSchema>;
export const XeroPushQueue: Model<XeroPushQueueDoc> = model<XeroPushQueueDoc>(
  "XeroPushQueue",
  xeroPushQueueSchema,
  "xero_push_queue",
);
