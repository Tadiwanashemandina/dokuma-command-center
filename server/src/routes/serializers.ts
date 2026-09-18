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

/**
 * Collapses `undefined` to `null` for an optional column.
 *
 * Mongoose infers a `default: null` path as `T | null | undefined` — the
 * `undefined` arm is reachable via `.lean()` on a document written before the
 * field existed. The wire contract has only `T | null`, and letting
 * `undefined` through would drop the key from the JSON entirely rather than
 * sending an explicit null, so a client destructuring it gets `undefined`
 * where it expected an absent-but-present field.
 */
export function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}
