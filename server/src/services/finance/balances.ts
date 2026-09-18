import mongoose, { type ClientSession } from "mongoose";
import { FinanceAccount, FinanceTransaction } from "../../db/models/index.js";
import {
  MONEY_SCALE,
  PERCENT_SCALE,
  currentDate,
  decimalToString,
  toDateOnly,
  toDecimal128,
} from "../../db/types.js";

/**
 * Account balances — the application-level replacement for the Postgres
 * function `get_account_balance_as_of` and the trigger
 * `trg_recompute_account_balance` (migration 0015).
 *
 * Both are reproduced exactly, including two behaviors that look like bugs but
 * are load-bearing. They are called out at each site below.
 *
 * All arithmetic runs on scaled integers (bigint), never float64: summing
 * thousands of two-decimal values as JS numbers accumulates error, which is
 * precisely what Decimal128 storage exists to prevent (inventory §10, D-12).
 */

/**
 * Parses a decimal string/Decimal128 into an exact scaled bigint.
 *
 * Exported because the report service does the same arithmetic on the same
 * values, and a second implementation there would be a second rounding
 * policy — the two would agree until they didn't.
 */
export function toScaled(
  value: mongoose.Types.Decimal128 | string | number,
  scale = MONEY_SCALE,
): bigint {
  const raw = decimalToString(toDecimal128(value, scale), scale) ?? "0";
  const [whole = "0", fraction = ""] = raw.replace("-", "").split(".");
  const digits = BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  return raw.startsWith("-") ? -digits : digits;
}

/** Renders a scaled bigint back to a fixed-point decimal string. */
export function fromScaled(scaled: bigint, scale = MONEY_SCALE): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Sums scaled amounts. A named helper purely so the intent is greppable. */
export function addScaled(...values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

/**
 * `amount × percent / 100`, exactly, at money scale.
 *
 * Both operands are scaled integers, so the product carries
 * MONEY_SCALE + PERCENT_SCALE decimal places and must be divided back down.
 * The division rounds half-up to match Postgres `numeric` rounding, which is
 * what the stored column would have done.
 *
 * The float64 version of this (`amount * (pct / 100)`) was the worst
 * arithmetic in the legacy reports: it rounded twice per row and accumulated
 * across the period, so a DLAP partner's share drifted from the sum of the
 * individual entitlements it is supposed to represent.
 */
export function mulScaledByPercent(
  amountScaled: bigint,
  percent: mongoose.Types.Decimal128 | string | number,
): bigint {
  const percentScaled = toScaled(percent, PERCENT_SCALE);
  const divisor = 100n * 10n ** BigInt(PERCENT_SCALE);

  const product = amountScaled * percentScaled;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  // Half-up: add half the divisor before truncating.
  const rounded = (magnitude + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/**
 * `public.get_account_balance_as_of(p_account_id, p_as_of_date)`:
 *
 *   opening_balance
 *   + sum(amount) where type = 'credit'
 *   - sum(amount) where type = 'debit'
 *   for transactions with date <= as_of_date
 *
 * `amount` is always positive (`check (amount > 0)`), so direction comes
 * entirely from `type`. A reversal is a real opposite-type row and therefore
 * nets out arithmetically — no special-casing, exactly as in SQL.
 *
 * The date bound is inclusive. An account with no qualifying transactions
 * returns its opening balance (the SQL used a LEFT JOIN for that reason).
 *
 * Returns a fixed-scale decimal string, never a number.
 */
export async function getAccountBalanceAsOf(
  accountId: string,
  asOfDate: Date,
  session?: ClientSession,
): Promise<string> {
  const account = await FinanceAccount.findById(accountId)
    .select("openingBalance")
    .session(session ?? null)
    .lean();

  if (!account) {
    throw new Error(`Finance account not found: ${accountId}`);
  }

  const transactions = await FinanceTransaction.find({
    accountId,
    date: { $lte: toDateOnly(asOfDate) },
  })
    .select("type amount")
    .session(session ?? null)
    .lean();

  let scaled = toScaled(account.openingBalance);
  for (const txn of transactions) {
    const amount = toScaled(txn.amount);
    scaled += txn.type === "credit" ? amount : -amount;
  }

  return fromScaled(scaled);
}

/**
 * `public.recompute_account_balance()` — the AFTER INSERT trigger body.
 *
 * Two deliberate fidelities to the SQL:
 *
 * 1. It recomputes as of `current_date`, NOT as of the transaction's own date.
 *    A back-dated transaction is therefore included, but a FUTURE-dated one is
 *    excluded from `current_balance` even though inserting it triggers this
 *    recompute. That is what the trigger does today.
 *
 * 2. The trigger fires on INSERT ONLY — not on UPDATE, not on DELETE. Callers
 *    must not invoke this after an update or a delete: corrections are made by
 *    inserting an offsetting reversal row, which is itself an insert. See the
 *    design note in migration 0014.
 *
 * Must run in the same transaction as the insert that triggered it
 * (inventory §10, D-11) — the pair is atomic in Postgres today, and a crash
 * between the two halves would leave `current_balance` permanently wrong.
 */
export async function recomputeAccountBalance(
  accountId: string,
  session?: ClientSession,
): Promise<string> {
  const balance = await getAccountBalanceAsOf(accountId, currentDate(), session);

  await FinanceAccount.updateOne(
    { _id: accountId },
    { $set: { currentBalance: toDecimal128(balance) } },
    { session },
  );

  return balance;
}

export interface CashPositionByCurrency {
  currency: string;
  totalBalance: string;
  accounts: { id: string; name: string; type: string; currentBalance: string }[];
}

/**
 * Cash position, grouped by currency and never naively summed across
 * currencies — ported from lib/finance/balances.ts, which grouped for exactly
 * that reason. Sorted by currency then name, matching the original ordering.
 */
export async function getCashPosition(): Promise<CashPositionByCurrency[]> {
  const accounts = await FinanceAccount.find({ isActive: true })
    .select("name type currency currentBalance")
    .sort({ currency: 1, name: 1 })
    .lean();

  const byCurrency = new Map<
    string,
    { currency: string; scaled: bigint; accounts: CashPositionByCurrency["accounts"] }
  >();

  for (const account of accounts) {
    const bucket = byCurrency.get(account.currency) ?? {
      currency: account.currency,
      scaled: 0n,
      accounts: [],
    };

    bucket.scaled += toScaled(account.currentBalance);
    bucket.accounts.push({
      id: account._id,
      name: account.name,
      type: account.type,
      currentBalance: decimalToString(account.currentBalance) ?? "0.00",
    });

    byCurrency.set(account.currency, bucket);
  }

  return Array.from(byCurrency.values()).map((bucket) => ({
    currency: bucket.currency,
    totalBalance: fromScaled(bucket.scaled),
    accounts: bucket.accounts,
  }));
}

/**
 * Total across every active account as of a date, all currencies mixed.
 *
 * Ported from `getTotalBalanceAsOf`, used for company-wide report totals where
 * a single figure is expected. Mixing currencies is questionable, but it is
 * current behavior and is preserved deliberately.
 */
export async function getTotalBalanceAsOf(asOfDate: Date): Promise<string> {
  const accounts = await FinanceAccount.find({ isActive: true }).select("_id").lean();

  let scaled = 0n;
  for (const account of accounts) {
    scaled += toScaled(await getAccountBalanceAsOf(account._id, asOfDate));
  }

  return fromScaled(scaled);
}

/**
 * `public.get_unusual_transactions(p_account_id, p_check_date)` (0015).
 *
 * Flags transactions on `checkDate` whose amount exceeds 2x the account's
 * trailing 30-day average amount. The window is half-open and excludes
 * `checkDate` itself, so a large transaction cannot inflate its own baseline.
 * With no prior history the SQL returned zero rows rather than flagging
 * everything (`b.avg_amount is not null`); that guard is preserved.
 *
 * Debits and credits are pooled — direction is not considered, matching SQL.
 */
export async function getUnusualTransactions(accountId: string, checkDate: Date) {
  const check = toDateOnly(checkDate);
  const windowStart = new Date(check.getTime());
  windowStart.setUTCDate(windowStart.getUTCDate() - 30);

  const baseline = await FinanceTransaction.find({
    accountId,
    date: { $gte: toDateOnly(windowStart), $lt: check },
  })
    .select("amount")
    .lean();

  // No history — return nothing rather than flagging every row.
  if (baseline.length === 0) return [];

  const totalScaled = baseline.reduce<bigint>((acc, txn) => acc + toScaled(txn.amount), 0n);

  // Threshold is 2x the mean. Comparing `amount * count` against `2 * total`
  // keeps the test in exact integers instead of dividing.
  const thresholdNumerator = 2n * totalScaled;
  const count = BigInt(baseline.length);

  const candidates = await FinanceTransaction.find({ accountId, date: check }).lean();

  return candidates.filter((txn) => toScaled(txn.amount) * count > thresholdNumerator);
}
