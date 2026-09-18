import type { ClientSession } from "mongoose";
import type { CreateTransactionInput, TransactionSource } from "@dokuma/shared";
import { FinanceAccount, FinanceTransaction } from "../../db/models/index.js";
import { withTransaction } from "../../db/connection.js";
import { toDecimal128, toDateOnly, currentDate, PERCENT_SCALE } from "../../db/types.js";
import { HttpError } from "../../middleware/http-error.js";
import { recomputeAccountBalance } from "./balances.js";

/**
 * Creating and reversing finance transactions.
 *
 * Ported from `lib/finance/transactions.ts`, with the one thing that file
 * itself flagged as a shortcut now actually fixed. Its own comment read:
 *
 *   "Both the reversal and the audit entry are written atomically-enough for
 *    this app's needs (sequential inserts; a true DB transaction would need a
 *    Postgres function, not needed at this scale)."
 *
 * That was true of the audit row, which is advisory. It was NOT true of the
 * balance recompute, which in Postgres is an AFTER INSERT trigger and
 * therefore genuinely atomic with the insert. A crash between the two halves
 * leaves `current_balance` permanently wrong, and nothing ever notices —
 * `getAccountBalanceAsOf()` would disagree with it silently forever. So every
 * write here runs inside `withTransaction` (inventory §10, D-11), which throws
 * rather than degrading if the deployment has no replica set.
 *
 * The audit row is deliberately written OUTSIDE the transaction by the route,
 * via the existing `audit()` helper, which never rejects. An audit failure
 * must not roll back a committed financial entry.
 */

/** What the caller needs back to write its audit row and invalidate caches. */
export interface TransactionResult {
  id: string;
  accountId: string;
  /**
   * The account's recomputed `current_balance`, for the realtime emit.
   *
   * `null` when the caller passed `skipBalanceRecompute` — it is deliberately
   * not an empty string or a zero, so a caller that forgets to handle the
   * batch case gets a type error rather than a plausible-looking wrong number
   * flowing into a balance display.
   */
  currentBalance: string | null;
}

/**
 * Inserts a transaction and recomputes its account's balance, atomically.
 *
 * `source` is a parameter rather than a hard-coded "manual" because three
 * callers need three different values and the distinction is load-bearing:
 * the Excel importer writes `excel-import`, the Xero reconciler writes
 * `xero-sync` (which the push service then refuses to send back up), and the
 * route writes `manual`.
 */
export async function createTransaction(
  input: CreateTransactionInput,
  createdBy: string | null,
  options: {
    source?: TransactionSource;
    xeroTransactionId?: string | null;
    xeroUpdatedAt?: Date | null;
    /** Reuse an outer transaction — the bulk importer opens exactly one. */
    session?: ClientSession;
    /**
     * Skips the per-insert balance recompute.
     *
     * ONLY safe for a caller that is inside one transaction and recomputes
     * once at the end — the bulk importer and the Xero sync. Because the whole
     * batch commits atomically, no reader can observe the intermediate states,
     * which is exactly what makes skipping the intermediate recomputes sound
     * rather than merely faster. A caller outside a transaction that sets this
     * leaves `current_balance` permanently wrong.
     */
    skipBalanceRecompute?: boolean;
  } = {},
): Promise<TransactionResult> {
  const run = async (session: ClientSession | undefined): Promise<TransactionResult> => {
    // The FK Mongo will not enforce for us. Checked inside the transaction so
    // an account deactivated concurrently cannot slip a row in behind it.
    const account = await FinanceAccount.findById(input.account_id)
      .select("_id isActive")
      .session(session ?? null)
      .lean();

    if (!account) {
      throw new HttpError(400, `Finance account not found: ${input.account_id}`);
    }
    if (!account.isActive) {
      throw new HttpError(400, "Cannot post a transaction to an inactive account.");
    }

    const [created] = await FinanceTransaction.create(
      [
        {
          accountId: input.account_id,
          date: toDateOnly(new Date(`${input.date}T00:00:00Z`)),
          type: input.type,
          // Passed as the exact decimal string it arrived as. Never through
          // Number() — that is the float64 round-trip D-12 exists to avoid.
          amount: toDecimal128(input.amount),
          category: input.category,
          counterparty: input.counterparty,
          description: input.description,
          referenceNo: input.reference_no,
          isDlap: input.is_dlap,
          dlapSharePct:
            input.dlap_share_pct === null
              ? null
              : toDecimal128(input.dlap_share_pct, PERCENT_SCALE),
          source: options.source ?? "manual",
          xeroTransactionId: options.xeroTransactionId ?? null,
          xeroUpdatedAt: options.xeroUpdatedAt ?? null,
          createdBy,
        },
      ],
      { session, ordered: true },
    );

    if (!created) {
      throw new HttpError(500, "Transaction insert returned no document.");
    }

    // The AFTER INSERT trigger, in the same transaction as the insert.
    // Deferred only for a batch caller that recomputes once at the end; see
    // `skipBalanceRecompute` above for why that is sound.
    const currentBalance = options.skipBalanceRecompute
      ? null
      : await recomputeAccountBalance(input.account_id, session);

    return { id: created._id, accountId: input.account_id, currentBalance };
  };

  if (options.session) return run(options.session);
  return withTransaction("createTransaction", run);
}

/**
 * Reverses a transaction by inserting a real, offsetting entry.
 *
 * Three behaviors from §9 that are preserved exactly, because each one is a
 * deliberate design choice rather than an implementation detail:
 *
 *   1. Nothing is ever deleted or edited. The reversal is a new row of the
 *      opposite `type` linked by `reversesTransactionId`, and the original
 *      gets `isReversed = true`. This is what keeps the balance arithmetic
 *      free of special cases — a reversal nets out on its own — and the audit
 *      trail complete.
 *   2. Double-reversal is blocked explicitly. Without the check, reversing
 *      twice books the opposite entry twice and moves the balance the wrong
 *      way by the full amount.
 *   3. The reversal is dated TODAY, not the original's date. Back-dating it
 *      would silently restate a period that may already have been reported on
 *      and signed off.
 *
 * The check-then-write pair runs inside the transaction so two concurrent
 * reversals cannot both read `isReversed === false` and both proceed.
 */
export async function reverseTransaction(
  transactionId: string,
  reason: string,
  actorId: string,
): Promise<
  Omit<TransactionResult, "currentBalance"> & {
    /** Always recomputed here — a reversal is never part of a deferred batch. */
    currentBalance: string;
    originalId: string;
    amount: string;
  }
> {
  return withTransaction("reverseTransaction", async (session) => {
    const original = await FinanceTransaction.findById(transactionId)
      .session(session ?? null)
      .lean();

    if (!original) {
      throw new HttpError(404, `Transaction not found: ${transactionId}`);
    }
    if (original.isReversed) {
      throw new HttpError(409, "This transaction has already been reversed.");
    }
    /**
     * Reversing a reversal is refused. It is arithmetically identical to
     * re-posting the original, but it produces a chain nobody can read and
     * leaves two rows each claiming to reverse the other. If the original
     * needs reinstating, that is a new transaction with its own reason.
     */
    if (original.reversesTransactionId !== null) {
      throw new HttpError(
        409,
        "A reversal cannot itself be reversed. Post a new transaction instead.",
      );
    }

    const oppositeType = original.type === "debit" ? "credit" : "debit";

    const [reversal] = await FinanceTransaction.create(
      [
        {
          accountId: original.accountId,
          date: currentDate(),
          type: oppositeType,
          amount: original.amount,
          category: original.category,
          counterparty: original.counterparty,
          description: `Reversal of ${original._id}: ${reason}`,
          referenceNo: original.referenceNo,
          isDlap: original.isDlap,
          dlapSharePct: original.dlapSharePct,
          source: "manual",
          reversesTransactionId: original._id,
          createdBy: actorId,
        },
      ],
      { session, ordered: true },
    );

    if (!reversal) {
      throw new HttpError(500, "Reversal insert returned no document.");
    }

    await FinanceTransaction.updateOne(
      { _id: original._id },
      { $set: { isReversed: true } },
      { session },
    );

    const currentBalance = await recomputeAccountBalance(original.accountId, session);

    return {
      id: reversal._id,
      originalId: original._id,
      accountId: original.accountId,
      amount: original.amount.toString(),
      currentBalance,
    };
  });
}
