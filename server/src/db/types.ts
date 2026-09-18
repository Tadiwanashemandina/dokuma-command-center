import { randomUUID } from "node:crypto";
import mongoose, { Schema, type SchemaTypeOptions } from "mongoose";

/**
 * Shared schema primitives that encode the three cross-cutting decisions from
 * the migration inventory: UUID string `_id` (D-8), Decimal128 money (D-12),
 * and date-only columns stored without a time component.
 *
 * Every model imports from here rather than re-declaring the types, so a
 * change to how money or dates are represented happens in exactly one place.
 */

// ---------------------------------------------------------------------------
// Identifiers — D-8
// ---------------------------------------------------------------------------

/**
 * Postgres `uuid primary key default gen_random_uuid()`.
 *
 * Kept as a UUID *string* rather than an ObjectId (inventory §10, D-8): every
 * FK value, storage path convention and `audit_log.entity_id` carries a UUID
 * today, and 10+ endpoints validate them with zod's `.uuid()`.
 */
export const uuidPk = {
  type: String,
  // Wrapped rather than passed as `default: randomUUID`. Mongoose invokes a
  // default function with its own arguments — during `setDefaultsOnInsert` on
  // a bulkWrite upsert it passes `null` — and Node's `randomUUID` throws on a
  // null options argument. The wrapper ignores whatever it is handed.
  default: () => randomUUID(),
  // Mongo has no uuid type for a string _id; validate the shape ourselves so a
  // malformed id cannot be written by a service that skipped its zod schema.
  validate: {
    validator: isUuid,
    message: "{PATH} must be a UUID",
  },
} satisfies SchemaTypeOptions<string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * A FK column holding another document's UUID `_id`.
 *
 * `ref` is set so `populate()` works, but note that referential integrity is
 * NOT enforced by Mongo — the cascade/set-null behavior of the original
 * `REFERENCES ... ON DELETE` clauses lives in `db/cascade.ts`.
 */
export function uuidRef(ref: string, options: { required?: boolean; index?: boolean } = {}) {
  return {
    type: String,
    ref,
    required: options.required ?? false,
    index: options.index ?? false,
    default: options.required ? undefined : null,
    validate: {
      validator: (value: unknown) => value === null || value === undefined || isUuid(value),
      message: "{PATH} must be a UUID",
    },
  } satisfies SchemaTypeOptions<string>;
}

// ---------------------------------------------------------------------------
// Money — D-12
// ---------------------------------------------------------------------------

/**
 * Postgres `numeric(14, 2)`.
 *
 * Stored as Decimal128, never as a JS number (inventory §10, D-12): float64
 * cannot represent cents exactly, and these values are summed across thousands
 * of ledger rows to produce account balances. The cost is an explicit
 * conversion at both boundaries — `toDecimal128` on the way in, `decimalToNumber`
 * (or `.toString()`) on the way out.
 */
export function money(options: { required?: boolean; default?: string | number } = {}) {
  return {
    type: Schema.Types.Decimal128,
    required: options.required ?? false,
    default:
      options.default === undefined
        ? options.required
          ? undefined
          : null
        : toDecimal128(options.default),
    set: (value: unknown) =>
      value === null || value === undefined
        ? value
        : toDecimal128(value as string | number | mongoose.Types.Decimal128),
  } satisfies SchemaTypeOptions<mongoose.Types.Decimal128>;
}

/**
 * The `set` callback for a nullable Decimal128 column at a non-default scale.
 *
 * Mongoose types a setter's input as `unknown`, so narrowing away null and
 * undefined still leaves `{}`. This centralizes the one cast that fact
 * requires, instead of repeating it at every decimal field.
 */
export function decimalSetter(scale: number) {
  return (value: unknown) =>
    value === null || value === undefined
      ? value
      : toDecimal128(value as string | number | mongoose.Types.Decimal128, scale);
}

/** The scale every `numeric(14, 2)` column in the source schema carries. */
export const MONEY_SCALE = 2;

/** `numeric(5, 2)` — dlap_share_pct, hours_today. */
export const PERCENT_SCALE = 2;

/** `numeric(5, 1)` — leave day counts, which are half-day granular. */
export const LEAVE_DAY_SCALE = 1;

/**
 * Converts a number/string/Decimal128 to Decimal128, rounded to `scale`
 * decimal places (half-up, matching Postgres `numeric` rounding).
 *
 * Accepting a string is what lets a caller pass an exact decimal literal that
 * float64 would already have corrupted before this function ever saw it.
 */
export function toDecimal128(
  value: string | number | mongoose.Types.Decimal128,
  scale: number = MONEY_SCALE,
): mongoose.Types.Decimal128 {
  if (value instanceof mongoose.Types.Decimal128) return value;

  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (raw === "" || Number.isNaN(Number(raw))) {
    throw new TypeError(`Cannot convert ${JSON.stringify(value)} to a decimal`);
  }

  return mongoose.Types.Decimal128.fromString(roundDecimalString(raw, scale));
}

/**
 * Rounds a decimal *string* to `scale` places without going through float64.
 *
 * Doing this with `Number.toFixed` would reintroduce exactly the precision
 * loss Decimal128 is here to prevent, so the digits are manipulated directly.
 */
function roundDecimalString(raw: string, scale: number): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new TypeError(`Malformed decimal: ${raw}`);

  const [, sign, intPart = "", fracPart = "", exponent] = match;

  // Exponential notation is rare here (it only shows up via JS number
  // stringification of very large/small values); normalize it through
  // Decimal128 itself rather than reimplementing exponent shifting.
  if (exponent !== undefined) {
    return roundDecimalString(
      mongoose.Types.Decimal128.fromString(raw).toString(),
      scale,
    );
  }

  if (fracPart.length <= scale) {
    return `${sign}${intPart || "0"}.${fracPart.padEnd(scale, "0")}`;
  }

  const keep = fracPart.slice(0, scale);
  const nextDigit = Number(fracPart[scale]);
  let digits = `${intPart || "0"}${keep}`;

  if (nextDigit >= 5) {
    // Increment the digit string by one, carrying as needed.
    digits = (BigInt(digits) + 1n).toString().padStart(digits.length, "0");
  }

  const cut = digits.length - scale;
  const newInt = digits.slice(0, cut) || "0";
  const newFrac = digits.slice(cut);
  return `${sign}${newInt}.${newFrac}`;
}

/**
 * Decimal128 → number, for JSON responses and arithmetic in the UI.
 *
 * Safe at these magnitudes (`numeric(14,2)` tops out well inside float64's
 * exact-integer range once scaled), but deliberately a named function so that
 * every lossy conversion is greppable.
 */
export function decimalToNumber(
  value: mongoose.Types.Decimal128 | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

/** Decimal128 → fixed-scale string, for exact display and PDF/CSV output. */
export function decimalToString(
  value: mongoose.Types.Decimal128 | null | undefined,
  scale: number = MONEY_SCALE,
): string | null {
  if (value === null || value === undefined) return null;
  return roundDecimalString(value.toString(), scale);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Postgres `date` — a calendar day with no time or zone.
 *
 * Stored as a UTC-midnight `Date`. Mongo has no date-only type, so the
 * normalizer is what keeps `date` columns comparable: without it, two rows
 * written from different timezones on the same calendar day would sort and
 * group differently, quietly breaking the daily/weekly report boundaries and
 * the `unique (person_name, activity_date, source)` style constraints.
 */
export function dateOnly(options: { required?: boolean; default?: () => Date } = {}) {
  return {
    type: Date,
    required: options.required ?? false,
    default: options.default ?? (options.required ? undefined : null),
    // Per-field normalization. `cast` runs for query operands as well as
    // document writes, and only on this path — so timestamps elsewhere in the
    // application keep their time component.
    cast: false as const,
    set: toDateOnlyOrPassThrough,
    /**
     * Normalization to UTC midnight happens in the Date *caster* (installed by
     * `installDateOnlyCast()` below), not in a setter.
     *
     * A path setter also receives query values, where it is handed the whole
     * operator object — `{ $lte: someDate }` from `find({ date: { $lte: x } })`
     * — rather than the operand. Normalizing there either throws on the object
     * or returns it unchanged for Mongoose to then mis-cast as a Date. Either
     * way, every date-range query in the application breaks.
     *
     * The caster runs once per actual value, including each operand inside an
     * operator, which is exactly the granularity this needs.
     */
  } satisfies SchemaTypeOptions<Date>;
}

/**
 * Normalization for date-only (Postgres `date`) columns.
 *
 * Mongo has no date-only type. Without normalizing, two rows written from
 * different timezones on the same calendar day sort and group differently,
 * which quietly breaks the daily/weekly report boundaries and the
 * `unique (person_name, activity_date, source)` style constraints.
 *
 * This is applied per FIELD, via `dateOnly()` below, and deliberately NOT as a
 * global `mongoose.Schema.Types.Date.cast()` override. A global cast truncates
 * every Date in the application — session `expiresAt`, token `expiresAt`,
 * `lastUsedAt`, audit timestamps — to midnight. That is silently destructive:
 * a token issued at 10:00 to expire at 11:00 instead gets midnight of the same
 * day, which is in the past, so it is born expired. Sessions survived only
 * because their expiry happened to round upward.
 *
 * The cast hook cannot distinguish a date-only column from a timestamp,
 * because by the time it runs it sees only a Date. The schema field does know,
 * so that is where the rule belongs.
 */
export function toDateOnlyOrPassThrough(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    return toDateOnly(value as Date | string | number);
  }
  // An operator object (`{ $lte: … }`) on a query: Mongoose descends into it
  // and calls the caster again per operand, so pass it through untouched.
  return value;
}

/** Truncates any date-ish value to UTC midnight of its calendar day. */
export function toDateOnly(value: Date | string | number): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Cannot convert ${JSON.stringify(value)} to a date`);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Postgres `current_date`, as a UTC-midnight Date. */
export function currentDate(): Date {
  return toDateOnly(new Date());
}

/** `current_date + n days`, the idiom the seed data and KPI windows use. */
export function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

/** Formats a date-only value as `YYYY-MM-DD` for API responses. */
export function formatDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/**
 * Postgres `timestamptz not null default now()`.
 *
 * The source schema names these `created_at`/`updated_at` and sets them with
 * column defaults rather than triggers; `timestamps: {...}` on the schema
 * reproduces that, with the field names mapped explicitly so the JSON shape
 * the client already consumes is unchanged.
 */
export const timestampOptions = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
} as const;

/** For tables that have `created_at` but no `updated_at`. */
export const createdAtOnly = {
  timestamps: { createdAt: "createdAt", updatedAt: false },
} as const;

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/**
 * `v_project_margins` (migration 0003) — `(budget − cost) / budget × 100`,
 * to two decimal places.
 *
 * Lives in this module, rather than beside the other finance arithmetic in
 * `services/finance/balances.ts`, because the `ProjectFinance.marginPct`
 * virtual needs it. A model importing from a service that imports the model
 * barrel is a require cycle, and the symptom would be a model that is
 * undefined at registration time — a failure that appears far from its cause.
 * This file already has no dependencies of its own, which is what makes it the
 * safe home.
 *
 * Returns null when budget is absent or zero, matching the view's CASE
 * exactly. Null and 0 are different facts: 0 means "this project has consumed
 * its entire budget", null means "no budget was ever set". Rendering the
 * second as the first puts a red zero against a project nobody has budgeted.
 *
 * The division runs on scaled integers, like every other figure in the finance
 * module — `(budget − cost)` is a difference of two exact decimals, and doing
 * it in float64 reintroduces the error Decimal128 storage exists to prevent.
 */
export function computeMarginPct(
  budget: string | null,
  costToDate: string | null,
): number | null {
  if (budget === null) return null;

  const budgetScaled = decimalStringToScaled(budget);
  if (budgetScaled === 0n) return null;

  const costScaled = costToDate === null ? 0n : decimalStringToScaled(costToDate);

  // ×10000 before dividing retains two decimal places of the percentage in
  // integer arithmetic; the quotient is small enough that the final Number()
  // conversion is exact.
  const numerator = (budgetScaled - costScaled) * 10000n;
  const denominator = budgetScaled < 0n ? -budgetScaled : budgetScaled;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;

  // Half-up, matching Postgres `numeric` rounding.
  const rounded = (magnitude + denominator / 2n) / denominator;
  return Number(negative ? -rounded : rounded) / 100;
}

/**
 * A fixed-scale decimal string → exact scaled bigint.
 *
 * A local copy of the same conversion `services/finance/balances.ts` exports,
 * kept here only to avoid the require cycle described above. It is deliberately
 * narrow — string input only — so it cannot drift into being a second general
 * conversion helper.
 */
function decimalStringToScaled(raw: string, scale: number = MONEY_SCALE): bigint {
  const normalized = roundDecimalString(raw.trim(), scale);
  const [whole = "0", fraction = ""] = normalized.replace("-", "").split(".");
  const digits = BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  return normalized.startsWith("-") ? -digits : digits;
}
