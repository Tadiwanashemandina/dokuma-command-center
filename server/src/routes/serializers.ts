import type { Types } from "mongoose";
import { decimalToString, formatDateOnly } from "../db/types.js";

/**
 * The serialization boundary.
 *
 * Two rules, both of which exist because the wire format is where type
 * information is easiest to lose:
 *
 * 1. A `Decimal128` leaves as a STRING, never a JSON number. Re-encoding a
 *    ledger balance as a float is exactly the precision loss D-12 chose
 *    Decimal128 to avoid, and it would happen silently.
 * 2. A date-only column leaves as `YYYY-MM-DD`, not an ISO timestamp. These
 *    are calendar days with no time and no zone; shipping midnight-UTC would
 *    invite the client to render the previous day in a negative offset.
 *
 * Field names stay snake_case on the wire. The React components ported from
 * the Next app already read `owner_name`, `due_date`, `budget_usd` and so on,
 * so keeping the shape identical means those files port without edits — and
 * it keeps the `/api/kpi-feed` external contract (D-13) consistent with
 * everything around it.
 */

export type Decimal = Types.Decimal128;

/** Money and other decimals → fixed-scale string, or null. */
export function money(value: Decimal | null | undefined): string | null {
  return decimalToString(value);
}

/** A date-only column → `YYYY-MM-DD`, or null. */
export function dateOnly(value: Date | null | undefined): string | null {
  return formatDateOnly(value);
}

/** A `timestamptz` → full ISO 8601, or null. */
export function timestamp(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
