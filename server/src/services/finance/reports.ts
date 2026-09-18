import type {
  CreditorSummary,
  DailySnapshot,
  DlapSummary,
  PeriodReportData,
  TrendPoint,
  UnusualTransaction,
} from "@dokuma/shared";
import {
  FinanceAccount,
  FinanceCreditor,
  FinanceTransaction,
} from "../../db/models/index.js";
import { decimalToString, toDateOnly } from "../../db/types.js";
import { nullable } from "../../routes/serializers.js";
import {
  getTotalBalanceAsOf,
  getUnusualTransactions,
  toScaled,
  fromScaled,
  mulScaledByPercent,
} from "./balances.js";

/**
 * Report computation — ported from `lib/finance/reports.ts`.
 *
 * Every figure the original computed with `Number(t.amount)` and `+=` is
 * computed here on scaled integers instead. That is not pedantry: a monthly
 * report sums hundreds of two-decimal amounts, and float64 addition of those
 * drifts by cents in a way that shows up as an off-by-a-penny between the
 * report and the ledger it was built from. The DLAP share was worse — it
 * multiplied by a percentage, so the error compounded.
 *
 * The two-figure "Current Balance" vs "Closing Balance" distinction (§9) is
 * preserved and re-documented at `computePeriodReportData`, because it reads
 * like a duplicate field and is not one.
 */

// ---------------------------------------------------------------------------
// Date helpers — UTC throughout, matching the original's `T00:00:00Z` parsing
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` → Date at UTC midnight. */
function parseDay(value: string): Date {
  return toDateOnly(new Date(`${value}T00:00:00Z`));
}

/** Date → `YYYY-MM-DD`. */
export function formatDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Shifts a `YYYY-MM-DD` by whole days, staying in UTC. */
export function addDays(value: string, days: number): string {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

/** Today as `YYYY-MM-DD`, UTC. */
export function today(): string {
  return formatDay(new Date());
}

// ---------------------------------------------------------------------------
// Daily snapshot
// ---------------------------------------------------------------------------

/**
 * End-of-day snapshot for `date`.
 *
 * `openingBalance` is the total as of the day BEFORE — the previous day's
 * close is this day's open. `closingBalance` is the total as of `date`
 * inclusive. Both mix currencies, which `getTotalBalanceAsOf` does
 * deliberately for company-wide totals (§9); the per-currency view lives on
 * the cash-position endpoint instead.
 */
export async function computeDailySnapshot(date: string): Promise<DailySnapshot> {
  const day = parseDay(date);

  const [openingBalance, closingBalance, sameDayTransactions, accounts] = await Promise.all([
    getTotalBalanceAsOf(parseDay(addDays(date, -1))),
    getTotalBalanceAsOf(day),
    FinanceTransaction.find({ date: day }).select("amount type").lean(),
    FinanceAccount.find({ isActive: true }).select("_id name").lean(),
  ]);

  let inScaled = 0n;
  let outScaled = 0n;
  for (const txn of sameDayTransactions) {
    if (txn.type === "credit") inScaled += toScaled(txn.amount);
    else outScaled += toScaled(txn.amount);
  }

  const accountNames = new Map(accounts.map((a) => [a._id, a.name]));

  /**
   * Unusual transactions, per active account.
   *
   * Sequential in the original because it issued one RPC per account. Run in
   * parallel here — each call is independent and reads a different account's
   * 30-day window, so there is no ordering requirement and a 20-account
   * organisation was paying 20 serial round-trips for nothing.
   */
  const flaggedPerAccount = await Promise.all(
    accounts.map((account) => getUnusualTransactions(account._id, day)),
  );

  const unusual: UnusualTransaction[] = flaggedPerAccount.flat().map((txn) => ({
    id: txn._id,
    account_id: txn.accountId,
    account_name: accountNames.get(txn.accountId) ?? null,
    date: formatDay(txn.date),
    type: txn.type,
    amount: decimalToString(txn.amount) ?? "0.00",
    category: nullable(txn.category),
    counterparty: nullable(txn.counterparty),
    description: nullable(txn.description),
  }));

  return {
    date,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    transactions_in: fromScaled(inScaled),
    transactions_out: fromScaled(outScaled),
    unusual_transactions: unusual,
  };
}

// ---------------------------------------------------------------------------
// DLAP share
// ---------------------------------------------------------------------------

/**
 * DLAP totals over a period.
 *
 * `dokumaShare` is `Σ amount × share_pct / 100`. The original did this in
 * float64 per row and accumulated; here each product is computed exactly at
 * money scale and then summed, so the total is the sum of the rounded shares
 * rather than the rounding of an accumulated float. That matches how the
 * figure is read — as a set of per-transaction entitlements that add up.
 *
 * A DLAP row with a null percentage contributes 0, which is why the request
 * schema now refuses to create one (see shared/src/finance.ts).
 */
export async function computeDlapShare(
  periodStart: string,
  periodEnd: string,
): Promise<DlapSummary> {
  const transactions = await FinanceTransaction.find({
    isDlap: true,
    date: { $gte: parseDay(periodStart), $lte: parseDay(periodEnd) },
  })
    .select("amount dlapSharePct")
    .lean();

  let totalScaled = 0n;
  let shareScaled = 0n;

  for (const txn of transactions) {
    const amount = toScaled(txn.amount);
    totalScaled += amount;
    if (txn.dlapSharePct !== null && txn.dlapSharePct !== undefined) {
      shareScaled += mulScaledByPercent(amount, txn.dlapSharePct);
    }
  }

  return {
    total_amount: fromScaled(totalScaled),
    dokuma_share: fromScaled(shareScaled),
    transaction_count: transactions.length,
  };
}

// ---------------------------------------------------------------------------
// Creditors
// ---------------------------------------------------------------------------

/**
 * Unpaid creditors, due date ascending — the list a period report carries.
 *
 * `status != "paid"` rather than `status == "outstanding"`: a partially paid
 * creditor is still owed money and still belongs on the report. Ported as-is.
 */
export async function getCurrentCreditors(): Promise<CreditorSummary[]> {
  const creditors = await FinanceCreditor.find({ status: { $ne: "paid" } })
    .sort({ dueDate: 1 })
    .lean();

  return creditors.map((creditor) => ({
    id: creditor._id,
    name: creditor.name,
    amount_owed: decimalToString(creditor.amountOwed) ?? "0.00",
    due_date: creditor.dueDate === null ? null : formatDay(creditor.dueDate),
    status: creditor.status,
    notes: nullable(creditor.notes),
  }));
}

// ---------------------------------------------------------------------------
// Period reports
// ---------------------------------------------------------------------------

interface TrendWindow {
  label: string;
  start: string;
  end: string;
}

/**
 * Shared weekly/monthly computation.
 *
 * On the two balance fields, which look redundant and are not (§9):
 *
 *   closing_balance — the balance AT `period_end`. This is the period being
 *                     reported on, and it never changes once the period is
 *                     over.
 *   current_balance — the LIVE balance at generation time.
 *
 * For a report generated the morning after its period ends, these usually
 * match. For one generated weeks later, the gap between them is the signal:
 * it tells the reader how much has moved since the period closed. Collapsing
 * them into one field would remove that, and is the single most plausible
 * "cleanup" someone will attempt here.
 */
async function computePeriodReportData(
  periodStart: string,
  periodEnd: string,
  trendWindows: TrendWindow[],
): Promise<PeriodReportData> {
  const [openingBalance, closingBalance, currentBalance, dlap, creditors, trendBalances] =
    await Promise.all([
      getTotalBalanceAsOf(parseDay(addDays(periodStart, -1))),
      getTotalBalanceAsOf(parseDay(periodEnd)),
      getTotalBalanceAsOf(parseDay(today())),
      computeDlapShare(periodStart, periodEnd),
      getCurrentCreditors(),
      // Independent point-in-time totals; the original awaited them in a loop.
      Promise.all(trendWindows.map((w) => getTotalBalanceAsOf(parseDay(w.end)))),
    ]);

  const trend: TrendPoint[] = trendWindows.map((window, index) => ({
    label: window.label,
    period_start: window.start,
    period_end: window.end,
    closing_balance: trendBalances[index] ?? "0.00",
  }));

  return {
    period_start: periodStart,
    period_end: periodEnd,
    opening_balance: openingBalance,
    current_balance: currentBalance,
    closing_balance: closingBalance,
    dlap,
    trend,
    creditors,
  };
}

/** Weekly: the same day-of-week close for each of the last 4 weeks. */
export async function computeWeeklyReportData(
  periodStart: string,
  periodEnd: string,
): Promise<PeriodReportData> {
  const windows = [4, 3, 2, 1].map((weeksAgo) => ({
    label: `${weeksAgo} week${weeksAgo > 1 ? "s" : ""} ago`,
    start: addDays(periodStart, -7 * weeksAgo),
    end: addDays(periodEnd, -7 * weeksAgo),
  }));

  return computePeriodReportData(periodStart, periodEnd, windows);
}

/**
 * Monthly: the close at the end of each of the last 3 months.
 *
 * The windows step back in 30-day increments rather than calendar months.
 * That is what the original did, and it is preserved deliberately: changing
 * it to true calendar months would silently move every historical trend point
 * on every previously generated report, so the comparison a reader makes
 * against last month's PDF would stop holding. If this should become calendar
 * months, it is a data decision to take explicitly, not a drive-by fix.
 */
export async function computeMonthlyReportData(
  periodStart: string,
  periodEnd: string,
): Promise<PeriodReportData> {
  const windows = [3, 2, 1].map((monthsAgo) => ({
    label: `${monthsAgo} month${monthsAgo > 1 ? "s" : ""} ago`,
    start: addDays(periodStart, -30 * monthsAgo),
    end: addDays(periodEnd, -30 * monthsAgo),
  }));

  return computePeriodReportData(periodStart, periodEnd, windows);
}

// ---------------------------------------------------------------------------
// Period boundaries
// ---------------------------------------------------------------------------

/**
 * The current calendar month as `[start, end]`, UTC.
 *
 * Used by the payment-notices page, which shows the current month only (§9),
 * and as the default period for a monthly report.
 */
export function currentMonthRange(reference: Date = new Date()): {
  start: string;
  end: string;
} {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  // Day 0 of the next month is the last day of this one — correct across leap
  // years and month lengths without a table.
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: formatDay(start), end: formatDay(end) };
}

/**
 * The week containing `reference`, Monday–Sunday, UTC.
 *
 * Monday-first because that is how the weekly report reads in this business,
 * and `getUTCDay()` returns 0 for Sunday — the `?? 7` maps Sunday to the end
 * of the week it belongs to rather than the start of the next one.
 */
export function currentWeekRange(reference: Date = new Date()): {
  start: string;
  end: string;
} {
  const day = reference.getUTCDay() === 0 ? 7 : reference.getUTCDay();
  const monday = new Date(reference);
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { start: formatDay(toDateOnly(monday)), end: formatDay(toDateOnly(sunday)) };
}
