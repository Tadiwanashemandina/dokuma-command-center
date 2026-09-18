import { createHash } from "node:crypto";
import {
  FinanceAccount,
  FinanceTransaction,
  XeroPushQueue,
} from "../../db/models/index.js";
import { decimalToString } from "../../db/types.js";
import { HttpError } from "../../middleware/http-error.js";
import { xeroRequest } from "./client.js";
import { resolveXeroConfig, canPushToXero } from "./config.js";
import { transactionTypeToXeroType } from "./mapping.js";

/**
 * Pushing local transactions UP into Xero.
 *
 * This is the only code in the integration that writes to someone's real
 * accounting ledger, so it is built around one question: what happens when a
 * request is sent twice?
 *
 * Three independent defences, because any one of them can be defeated:
 *
 *   1. `XeroPushQueue` has a UNIQUE index on `transactionId`. A double-click,
 *      a duplicated cron tick or two concurrent requests cannot create two
 *      queue rows for the same transaction — the second insert fails.
 *   2. Every request carries an `Idempotency-Key` derived deterministically
 *      from the local transaction id. Xero collapses repeats of the same key
 *      for 24 hours, so even a retry that bypasses the queue row entirely —
 *      say the process died before the row was written — does not create a
 *      second entry.
 *   3. Before sending, the transaction is re-read and refused if it already
 *      carries an `xeroTransactionId`.
 *
 * Belt, braces and a second belt, because the failure mode is a duplicate
 * entry in a ledger that someone reconciles against a bank statement, and it
 * is discovered weeks later by an accountant rather than by a test.
 */

/**
 * A stable idempotency key for a transaction.
 *
 * Derived from the id alone, NOT from the contents. If it included the amount,
 * an edit would change the key and a retry after an edit would create a second
 * Xero entry — which is exactly the case the key exists to prevent. The id is
 * a UUID and is already unique, and hashing it just keeps the key inside
 * Xero's length limit and out of the business of leaking internal ids.
 */
export function idempotencyKeyFor(transactionId: string): string {
  return createHash("sha256").update(`dokuma:txn:${transactionId}`).digest("hex").slice(0, 36);
}

interface XeroBankTransactionResponse {
  BankTransactions?: { BankTransactionID: string; Status?: string }[];
}

export interface PushResult {
  transactionId: string;
  status: "sent" | "skipped" | "failed";
  xeroTransactionId: string | null;
  reason: string | null;
}

/**
 * Queues a transaction for push, then sends it.
 *
 * Returns `skipped` rather than throwing for the cases that are normal rather
 * than erroneous — already pushed, came from Xero, no linked account — because
 * a bulk push over a day's transactions will hit all of them and none is a
 * failure worth aborting the batch for.
 */
export async function pushTransaction(
  transactionId: string,
  tenantId: string,
  requestedBy: string | null,
): Promise<PushResult> {
  const config = resolveXeroConfig();

  const skip = (reason: string): PushResult => ({
    transactionId,
    status: "skipped",
    xeroTransactionId: null,
    reason,
  });

  if (!canPushToXero(config)) {
    return skip(config.reason ?? "Xero push is not enabled.");
  }

  const transaction = await FinanceTransaction.findById(transactionId).lean();
  if (!transaction) {
    throw new HttpError(404, `Transaction not found: ${transactionId}`);
  }

  // Defence 3. Already in Xero, by either direction.
  if (transaction.xeroTransactionId !== null) {
    return skip("Already linked to a Xero transaction.");
  }

  /**
   * A row that CAME from Xero is never sent back up. This is the loop that
   * would otherwise duplicate every synced entry on the next push run, and it
   * is the single most important line in this file.
   */
  if (transaction.source === "xero-sync") {
    return skip("Originated in Xero.");
  }

  const account = await FinanceAccount.findById(transaction.accountId)
    .select("xeroAccountId name")
    .lean();

  if (!account?.xeroAccountId) {
    return skip("The transaction's account is not linked to a Xero bank account.");
  }

  const idempotencyKey = idempotencyKeyFor(transactionId);

  /**
   * Defence 1. The unique index on `transactionId` means a concurrent caller
   * loses this race rather than sending a second request.
   *
   * An existing row in `sent` state is a completed push whose write-back was
   * lost; report it as skipped rather than resending.
   */
  const existingQueueRow = await XeroPushQueue.findOne({ transactionId }).lean();
  if (existingQueueRow?.status === "sent") {
    return skip("Already pushed to Xero.");
  }

  await XeroPushQueue.updateOne(
    { transactionId },
    {
      $set: {
        tenantId,
        idempotencyKey,
        status: "pending",
        requestedBy,
      },
      $inc: { attempts: 1 },
    },
    { upsert: true },
  );

  const amount = decimalToString(transaction.amount) ?? "0.00";
  const date = transaction.date.toISOString().slice(0, 10);

  /**
   * The Xero payload.
   *
   * `LineAmountTypes: "NoTax"` is deliberate and conservative: this system
   * does not model tax, so declaring the amount tax-exclusive with no tax
   * component is the only honest statement available. Letting Xero apply a
   * default tax rate would silently change the value of the entry.
   *
   * `AccountCode` on the line item is required by Xero and is the ledger
   * account the other side of the entry lands in. It is taken from the
   * transaction's `category` where that maps to a code, and otherwise left to
   * Xero's default — see the note in the route that surfaces unmapped
   * categories.
   */
  const payload = {
    BankTransactions: [
      {
        Type: transactionTypeToXeroType(transaction.type),
        Date: date,
        Reference: transaction.referenceNo ?? undefined,
        BankAccount: { AccountID: account.xeroAccountId },
        Contact: { Name: transaction.counterparty ?? "Unknown" },
        LineAmountTypes: "NoTax",
        LineItems: [
          {
            Description:
              transaction.description ?? transaction.category ?? "Dokuma Command Centre",
            Quantity: 1,
            UnitAmount: Number(amount),
            AccountCode: transaction.category ?? undefined,
          },
        ],
      },
    ],
  };

  try {
    // Defence 2. Xero collapses repeats of this key for 24 hours.
    const response = await xeroRequest<XeroBankTransactionResponse>(
      tenantId,
      "/BankTransactions",
      { method: "POST", body: payload, idempotencyKey },
    );

    const xeroId = response.BankTransactions?.[0]?.BankTransactionID ?? null;

    if (!xeroId) {
      throw new HttpError(502, "Xero accepted the transaction but returned no id.");
    }

    /**
     * The write-back, in this order: the ledger row first, then the queue.
     *
     * The transaction's `xeroTransactionId` is what defence 3 reads, so it is
     * the one that must survive. A crash after this write and before the queue
     * update leaves a `pending` queue row for an already-linked transaction,
     * which the next attempt correctly skips.
     */
    await FinanceTransaction.updateOne(
      { _id: transactionId },
      { $set: { xeroTransactionId: xeroId } },
    );

    await XeroPushQueue.updateOne(
      { transactionId },
      {
        $set: {
          status: "sent",
          xeroTransactionId: xeroId,
          lastAttemptAt: new Date(),
          lastError: null,
        },
      },
    );

    return { transactionId, status: "sent", xeroTransactionId: xeroId, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await XeroPushQueue.updateOne(
      { transactionId },
      {
        $set: {
          status: "failed",
          lastAttemptAt: new Date(),
          lastError: message.slice(0, 1000),
        },
      },
    );

    return { transactionId, status: "failed", xeroTransactionId: null, reason: message };
  }
}

/**
 * Pushes every eligible unpushed transaction.
 *
 * Sequential, and bounded by `limit`. Xero's per-tenant rate limit makes a
 * parallel burst counterproductive — it would spend the minute quota in a
 * second and then spend the rest of the run backing off.
 *
 * A failure does not abort the batch: each transaction's outcome is
 * independent, and one malformed row should not block the other ninety-nine.
 */
export async function pushPendingTransactions(
  tenantId: string,
  requestedBy: string | null,
  limit = 100,
): Promise<PushResult[]> {
  const config = resolveXeroConfig();
  if (!canPushToXero(config)) {
    return [];
  }

  const candidates = await FinanceTransaction.find({
    xeroTransactionId: null,
    source: { $ne: "xero-sync" },
  })
    .select("_id")
    .sort({ date: 1, createdAt: 1 })
    .limit(limit)
    .lean();

  const results: PushResult[] = [];
  for (const candidate of candidates) {
    results.push(await pushTransaction(candidate._id, tenantId, requestedBy));
  }

  return results;
}
