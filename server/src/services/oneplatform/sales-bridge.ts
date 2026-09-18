import { randomUUID } from "node:crypto";
import { FinanceTransaction } from "../../db/models/index.js";
import { decimalToString, formatDateOnly } from "../../db/types.js";
import { resolveConfig, type OnePlatformConfig } from "./config.js";
import { signRequest } from "./signing.js";

/**
 * Dokuma's finance ledger → the Group's `SALES_DOCUMENT` feed.
 *
 * This is the path that produces the 14 SPINE measures. Unlike the four daily
 * KPIs, the spine is never posted as a number: §1 of the specification is
 * explicit that Revenue, EBITDA, DSO and the rest are derived by the platform
 * from source documents, "so that a figure on the chairman's screen and the
 * transaction behind it are the same number aggregated, never two separately
 * compiled ones". Posting documents is therefore the ONLY way to move those
 * fourteen measures.
 *
 * ---------------------------------------------------------------------------
 * Status: SCAFFOLD. Read this before enabling it.
 * ---------------------------------------------------------------------------
 * The mapping and the arithmetic are complete and tested, but two facts make
 * this unsafe to switch on today:
 *
 *  1. `finance_transactions` holds ~30 rows totalling ~$26k. Dokuma's actual
 *     contract runs to millions. Posting this would tell the board Dokuma's
 *     revenue is a few thousand dollars — a precise-looking wrong number, which
 *     is worse than an empty tile because nobody questions it.
 *
 *  2. A transaction is not an invoice. The Group wants documents with lines,
 *     tax, a customer and an `externalId` that never changes. A ledger entry
 *     has none of that natively, so this synthesises a single-line document —
 *     acceptable for a smoke test, wrong as a permanent representation.
 *
 * The right long-term source is Xero, which holds real invoices with real
 * lines. `services/xero/` is being built separately; when it can list invoices,
 * `buildSalesDocumentsFromXero()` replaces `buildSalesDocumentsFromLedger()`
 * and everything below it stays as-is.
 *
 * Until then this runs only when explicitly invoked with `--confirm`, and never
 * from a cron.
 *
 * ---------------------------------------------------------------------------
 * The key problem
 * ---------------------------------------------------------------------------
 * `SALES_DOCUMENT` is permitted for the `doc-xero` source, NOT for
 * `dokuma-command-centre` (which may send only `OPERATIONAL_READING`). So this
 * module needs its own credentials — see `resolveSalesConfig()`.
 */

const SALES_PATH = "/ingest/v1/sales-documents";

// ---------------------------------------------------------------------------
// Payload types — the Group's SALES_DOCUMENT shape
// ---------------------------------------------------------------------------

export interface SalesLine {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: string;
  unitOfMeasure?: string;
  unitPrice: string;
  discountAmount?: string;
  netAmount: string;
  taxAmount?: string;
  unitCost?: string;
}

export interface SalesDocument {
  externalId: string;
  documentNumber: string;
  documentType: "INVOICE" | "CASH_SALE" | "CREDIT_NOTE";
  documentDate: string;
  currency: string;
  priceIncludesTax: boolean;
  customerId: string;
  customerName?: string;
  /** Another group business when trading internally; null for outside parties. */
  counterpartySbuCode: string | null;
  totalNetAmount: string;
  totalTaxAmount: string;
  lines: SalesLine[];
  status: "POSTED" | "VOIDED";
  sourceUpdatedAt: string;
  restatementReason?: string;
}

export interface SalesBatch {
  sbuCode: string;
  clientBatchRef: string;
  atomic: boolean;
  documents: SalesDocument[];
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Credentials for the SALES feed, which are NOT the KPI feed's.
 *
 * `dokuma-command-centre` is registered for `OPERATIONAL_READING` only, so
 * reusing its key here returns `RECORD_TYPE_NOT_PERMITTED` (403). The sales
 * feed needs the `doc-xero` key, or a source registered for `SALES_DOCUMENT`.
 *
 * Separate variables rather than a shared pair, because the two feeds genuinely
 * are different systems with different permissions — and because a single key
 * able to post both is exactly the over-privileged credential that having two
 * sources was meant to avoid.
 */
export function resolveSalesConfig(): OnePlatformConfig {
  const base = resolveConfig();

  const keyId = process.env["OP_SALES_KEY_ID"]?.trim() || null;
  const secret = process.env["OP_SALES_SECRET"] || null;

  if (!keyId || !secret) {
    return {
      ...base,
      mode: "disabled",
      credentials: null,
      reason:
        "OP_SALES_KEY_ID / OP_SALES_SECRET are not set. The KPI key may not send SALES_DOCUMENT.",
    };
  }

  return { ...base, mode: base.baseUrl ? "live" : "disabled", credentials: { keyId, secret } };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export interface BuiltSalesBatch {
  batch: SalesBatch;
  skipped: { id: string; reason: string }[];
}

/**
 * Builds sales documents from credit (income) transactions in a period.
 *
 * Only `credit` rows are sales; debits are purchases and belong on
 * `/purchase-documents`. Reversed rows are excluded — the Group models a
 * reversal as a `VOIDED` resend of the original, not as a second document, and
 * sending both would double-count.
 */
export async function buildSalesDocumentsFromLedger(options: {
  from: Date;
  to: Date;
  sbuCode: string;
}): Promise<BuiltSalesBatch> {
  const rows = await FinanceTransaction.find({
    type: "credit",
    date: { $gte: options.from, $lte: options.to },
    isReversed: { $ne: true },
  })
    .sort({ date: 1 })
    .lean();

  const documents: SalesDocument[] = [];
  const skipped: BuiltSalesBatch["skipped"] = [];

  for (const row of rows) {
    const amount = decimalToString(row.amount);
    const date = formatDateOnly(row.date);

    if (!amount || !date) {
      skipped.push({ id: row._id, reason: "missing amount or date" });
      continue;
    }

    // Amounts must be strictly positive (§ "Every amount is zero or positive";
    // direction comes from documentType, never from a sign).
    if (Number(amount) <= 0) {
      skipped.push({ id: row._id, reason: `amount ${amount} is not positive` });
      continue;
    }

    /**
     * Tax is NOT split out.
     *
     * The ledger stores a single gross amount with no VAT component, so any
     * split would be invented. Declaring `priceIncludesTax: true` with
     * `totalTaxAmount: "0"` states plainly "this amount is what it is, and we
     * are not telling you a tax figure we do not have" — rather than
     * back-computing 15% that nobody recorded.
     *
     * This is a known limitation of the ledger source and one of the reasons
     * Xero is the right long-term origin: its invoices carry real tax lines.
     */
    const net = amount;

    documents.push({
      // Stable and derived from the row's own id, so a resend updates rather
      // than duplicates — the Group keys sales documents on externalId.
      externalId: `dokuma-txn-${row._id}`,
      documentNumber: row.referenceNo ?? `TXN-${row._id.slice(0, 8)}`,
      // Ledger income with no invoice trail is closer to a cash sale than an
      // invoice, and mislabelling it INVOICE would imply a receivable that
      // does not exist — which would distort DSO.
      documentType: "CASH_SALE",
      documentDate: date,
      currency: "USD",
      priceIncludesTax: true,
      customerId: row.counterparty ? slug(row.counterparty) : "CASH",
      ...(row.counterparty ? { customerName: row.counterparty } : {}),
      // Dokuma's customers are government and conveyancers, not group
      // businesses. Sending our own code here is an explicit error
      // (COUNTERPARTY_IS_SELF), so null is both correct and safe.
      counterpartySbuCode: null,
      totalNetAmount: net,
      totalTaxAmount: "0",
      lines: [
        {
          lineNumber: 1,
          productCode: categoryToProductCode(row.category),
          description: row.description ?? row.category ?? "Revenue",
          quantity: "1",
          unitPrice: net,
          discountAmount: "0",
          // quantity x unitPrice - discount == netAmount, exactly. The Group
          // rejects a line that does not balance (LINE_ARITHMETIC_MISMATCH),
          // and with quantity 1 this is exact by construction.
          netAmount: net,
          taxAmount: "0",
        },
      ],
      status: "POSTED",
      sourceUpdatedAt: (row.updatedAt ?? row.createdAt ?? new Date()).toISOString(),
    });
  }

  return {
    batch: {
      sbuCode: options.sbuCode,
      clientBatchRef: `dokuma-sales-${formatDateOnly(options.from)}-${randomUUID().slice(0, 8)}`,
      // Per-document validation: one malformed row must not discard the rest.
      atomic: false,
      documents,
    },
    skipped,
  };
}

/** A stable customer code from a free-text counterparty name. */
function slug(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "CASH";
}

/**
 * A product code from the ledger category.
 *
 * The Group groups sales by `productCode`, so it must be STABLE — renaming one
 * later splits a product's history in two on the board's screen.
 */
function categoryToProductCode(category: string | null | undefined): string {
  if (!category) return "REVENUE";
  return category.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface SalesDispatchResult {
  outcome: "accepted" | "partial" | "rejected" | "error" | "skipped" | "validated";
  clientBatchRef: string;
  documentsSent: number;
  httpStatus: number | null;
  detail: unknown;
  skipped: BuiltSalesBatch["skipped"];
}

/**
 * Sends a sales batch. Defaults to NOT sending.
 *
 * `confirm` must be passed explicitly — the inverse of the daily feed, which
 * sends by default once configured. Sales documents feed the board's revenue
 * figures, and the current ledger source is known to be unrepresentative, so
 * the safe default is to build and show rather than to post.
 */
export async function dispatchSalesBatch(options: {
  from: Date;
  to: Date;
  confirm?: boolean;
}): Promise<SalesDispatchResult> {
  const config = resolveSalesConfig();
  const { batch, skipped } = await buildSalesDocumentsFromLedger({
    from: options.from,
    to: options.to,
    sbuCode: config.sbuCode,
  });

  const base: Omit<SalesDispatchResult, "outcome" | "httpStatus" | "detail"> = {
    clientBatchRef: batch.clientBatchRef,
    documentsSent: batch.documents.length,
    skipped,
  };

  if (batch.documents.length === 0) {
    return { ...base, outcome: "skipped", httpStatus: null, detail: { reason: "No sales in range." } };
  }

  if (!options.confirm || config.mode !== "live" || !config.credentials || !config.baseUrl) {
    return {
      ...base,
      outcome: "validated",
      httpStatus: null,
      detail: {
        reason: options.confirm ? (config.reason ?? "Sales feed not configured.") : "Not confirmed.",
        payload: batch,
      },
    };
  }

  // Serialised once; these exact bytes are hashed and sent.
  const body = JSON.stringify(batch);
  const signed = signRequest({ method: "POST", path: SALES_PATH, body, credentials: config.credentials });

  try {
    const response = await fetch(new URL(SALES_PATH, config.baseUrl), {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: AbortSignal.timeout(30_000),
    });

    const payload: unknown = await response.json().catch(() => null);

    return {
      ...base,
      outcome:
        response.status === 200 ? "accepted" : response.status === 207 ? "partial" : "rejected",
      httpStatus: response.status,
      detail: payload,
    };
  } catch (error) {
    return {
      ...base,
      outcome: "error",
      httpStatus: null,
      detail: {
        error: error instanceof Error ? error.message : String(error),
        // Never blind-retry: the write may have landed.
        recovery: `GET /ingest/v1/batches?clientBatchRef=${batch.clientBatchRef}`,
      },
    };
  }
}
