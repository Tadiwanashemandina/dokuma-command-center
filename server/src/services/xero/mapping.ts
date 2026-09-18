import type { TransactionType } from "@dokuma/shared";

/**
 * Translating between Xero's representations and this application's.
 *
 * Isolated in one file because every one of these conversions has a sharp edge
 * that is invisible until it produces a wrong number, and each is worth
 * writing down once rather than rediscovering per resource.
 */

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Xero's legacy .NET date format: `/Date(1640995200000+0000)/`.
 *
 * The milliseconds are a real UTC epoch; the trailing offset is the
 * organisation's timezone at that instant and is NOT to be added — doing so
 * shifts every date by the offset, which for a date-only field like an invoice
 * due date moves it a whole calendar day in either direction.
 *
 * Newer endpoints return ISO 8601 instead, and some return a bare
 * `YYYY-MM-DD`. All three shapes appear in live responses depending on the
 * endpoint and the API version, so all three are handled here rather than
 * assumed away at the call site.
 */
export function parseXeroDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value !== "string" || value.trim() === "") return null;

  const trimmed = value.trim();

  const dotNet = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(trimmed);
  if (dotNet) {
    const millis = Number(dotNet[1]);
    return Number.isFinite(millis) ? new Date(millis) : null;
  }

  /**
   * A naive datetime — `2026-03-15T00:00:00`, with no zone designator.
   *
   * Xero returns this shape routinely, and `new Date()` parses it as LOCAL
   * time per ECMA-262 (only date-only forms default to UTC). On a host at
   * UTC+2 that makes midnight on the 15th into 22:00 on the 14th, and
   * `.slice(0, 10)` then reports the wrong calendar day — every invoice due
   * date and transaction date shifted by one, in a direction that depends on
   * where the server happens to be deployed.
   *
   * Xero's naive timestamps are UTC, so the `Z` is appended explicitly rather
   * than left to the host's timezone.
   */
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed);
  const parsed = new Date(naive ? `${trimmed}Z` : trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Xero date → `YYYY-MM-DD`, UTC. */
export function parseXeroDateOnly(value: unknown): string | null {
  const date = parseXeroDate(value);
  return date === null ? null : date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Xero amount → exact decimal string.
 *
 * Xero sends amounts as JSON **numbers**, so they have already been through
 * float64 by the time this process sees them — there is no way to recover more
 * precision than arrived. What this does is stop the loss compounding: it
 * converts to a fixed 2-decimal string immediately, so the value is exact from
 * here on and every downstream sum is integer arithmetic.
 *
 * `toFixed(2)` is correct here precisely because the input is already a float
 * and is being pinned to the scale the ledger stores. It would be wrong on a
 * value that arrived as a string.
 */
export function xeroAmountToString(value: unknown): string {
  if (value === null || value === undefined) return "0.00";

  if (typeof value === "string") {
    const trimmed = value.trim();
    // Already a decimal string — keep it exactly, only normalising the scale.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const [whole = "0", fraction = ""] = trimmed.split(".");
      return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
    }
    return "0.00";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  return "0.00";
}

/** Absolute value of a decimal string, for the sign/type split below. */
export function absDecimalString(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

// ---------------------------------------------------------------------------
// Transaction direction
// ---------------------------------------------------------------------------

/**
 * Xero bank-transaction types, and how they map onto debit/credit here.
 *
 * This is the conversion most likely to be got backwards, so it is stated
 * explicitly rather than inferred from a sign:
 *
 *   RECEIVE*  — money INTO the bank account  → credit (increases the balance)
 *   SPEND*    — money OUT of the bank account → debit  (decreases it)
 *
 * Note this is the *bank account holder's* perspective, which is the opposite
 * of double-entry bookkeeping convention where a bank receipt debits the asset
 * account. This application's `type` field means "did the balance go up or
 * down", as `getAccountBalanceAsOf` shows: credits add, debits subtract. Using
 * accounting convention here would invert every synced balance.
 *
 * The TRANSFER variants are deliberately excluded by the caller — a transfer
 * between two linked accounts would otherwise be imported twice, once from
 * each side, double-counting it.
 */
const RECEIVE_TYPES = new Set([
  "RECEIVE",
  "RECEIVE-OVERPAYMENT",
  "RECEIVE-PREPAYMENT",
  "RECEIVE-TRANSFER",
]);

const SPEND_TYPES = new Set([
  "SPEND",
  "SPEND-OVERPAYMENT",
  "SPEND-PREPAYMENT",
  "SPEND-TRANSFER",
]);

export function xeroTypeToTransactionType(xeroType: unknown): TransactionType | null {
  if (typeof xeroType !== "string") return null;
  const normalized = xeroType.toUpperCase();
  if (RECEIVE_TYPES.has(normalized)) return "credit";
  if (SPEND_TYPES.has(normalized)) return "debit";
  return null;
}

/** True for the transfer variants, which the sync skips. See above. */
export function isTransferType(xeroType: unknown): boolean {
  return typeof xeroType === "string" && xeroType.toUpperCase().endsWith("-TRANSFER");
}

/** The reverse mapping, for pushing a local transaction up to Xero. */
export function transactionTypeToXeroType(type: TransactionType): "RECEIVE" | "SPEND" {
  return type === "credit" ? "RECEIVE" : "SPEND";
}

// ---------------------------------------------------------------------------
// Invoice status
// ---------------------------------------------------------------------------

/**
 * Xero invoice status → this application's creditor status.
 *
 * `PAID` and `VOIDED` both mean "stop chasing this", but they are not the same
 * fact and the distinction survives in `XeroInvoice.status`. The creditor row
 * only carries the three-value enum, so both collapse to `paid` there — which
 * is why the creditor is not the source of truth for a voided bill.
 *
 * A partially paid invoice is `AUTHORISED` in Xero with `AmountPaid > 0`;
 * Xero has no distinct status for it, so the caller derives
 * `partially_paid` from the amounts rather than from the status alone.
 */
export function xeroInvoiceStatusToCreditorStatus(
  status: string,
  amountPaidScaled: number,
): "outstanding" | "partially_paid" | "paid" {
  const normalized = status.toUpperCase();
  if (normalized === "PAID" || normalized === "VOIDED" || normalized === "DELETED") {
    return "paid";
  }
  return amountPaidScaled > 0 ? "partially_paid" : "outstanding";
}
