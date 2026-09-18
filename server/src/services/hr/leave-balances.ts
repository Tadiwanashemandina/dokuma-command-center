import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { LeaveBalance } from "../../db/models/index.js";
import { LEAVE_DAY_SCALE, decimalToString, toDecimal128 } from "../../db/types.js";

/**
 * Leave balances — the application-level replacement for the Postgres trigger
 * `trg_recompute_leave_balance` / `recompute_leave_balance()` (migration 0024).
 *
 * The SQL body was:
 *
 *   if NEW.status = 'approved' and OLD.status <> 'approved' then
 *     insert into leave_balances (employee_id, leave_type_id, year,
 *                                 days_allocated, days_used)
 *     values (NEW.employee_id, NEW.leave_type_id,
 *             extract(year from NEW.start_date)::int, 0, NEW.days_requested)
 *     on conflict (employee_id, leave_type_id, year)
 *     do update set days_used = leave_balances.days_used + excluded.days_used;
 *   end if;
 *
 * Four behaviors are easy to "fix" by accident. All four are preserved:
 *
 * 1. AFTER UPDATE ONLY. A request INSERTed already-`approved` never increments
 *    a balance — only the transition into approved counts.
 * 2. Guarded on `OLD.status <> 'approved'`, so re-saving an approved request
 *    is a no-op and cannot double-count.
 * 3. It NEVER DECREMENTS. There is no un-approve path and no delete trigger:
 *    reverting or deleting an approved request does not return the days.
 * 4. `year` comes from `start_date` alone, so leave spanning New Year is
 *    attributed entirely to the START year.
 *
 * And one consequence worth stating plainly: the insert branch seeds
 * `days_allocated = 0`, so `days_remaining` (allocated - used) goes NEGATIVE
 * for an approved request with no pre-seeded allocation. That is real current
 * behavior, visible in the UI today, and is not corrected here.
 */

/** Parses a decimal to an exact scaled bigint at leave-day scale. */
function toScaled(value: mongoose.Types.Decimal128 | string | number): bigint {
  const raw = decimalToString(toDecimal128(value, LEAVE_DAY_SCALE), LEAVE_DAY_SCALE) ?? "0";
  const [whole = "0", fraction = ""] = raw.replace("-", "").split(".");
  const digits = BigInt(whole + fraction.padEnd(LEAVE_DAY_SCALE, "0").slice(0, LEAVE_DAY_SCALE));
  return raw.startsWith("-") ? -digits : digits;
}

function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(LEAVE_DAY_SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - LEAVE_DAY_SCALE);
  const fraction = `.${digits.slice(digits.length - LEAVE_DAY_SCALE)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Applies the balance increment for a leave request that has just transitioned
 * into `approved`.
 *
 * Call this ONLY on that transition, and inside the same transaction as the
 * status update (inventory §10, D-11) — the two halves are atomic in Postgres
 * today, and a crash between them would leave `days_used` permanently wrong.
 */
export async function applyApprovedLeaveToBalance(
  input: {
    employeeId: string;
    leaveTypeId: string;
    startDate: Date;
    daysRequested: mongoose.Types.Decimal128 | string | number;
  },
  session?: ClientSession,
): Promise<void> {
  // `extract(year from NEW.start_date)` — the START year, always.
  const year = input.startDate.getUTCFullYear();
  const requested = toScaled(input.daysRequested);

  const existing = await LeaveBalance.findOne({
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    year,
  })
    .session(session ?? null)
    .lean();

  if (existing) {
    // `do update set days_used = days_used + excluded.days_used`.
    // `daysRemaining` is a schema virtual derived from daysAllocated/daysUsed,
    // so there is nothing else to write — it cannot drift from its inputs.
    const used = toScaled(existing.daysUsed) + requested;

    await LeaveBalance.updateOne(
      { _id: existing._id },
      { $set: { daysUsed: toDecimal128(fromScaled(used), LEAVE_DAY_SCALE) } },
      { session },
    );
    return;
  }

  // Insert branch: `days_allocated = 0`, so days_remaining is negative.
  await LeaveBalance.create(
    [
      {
        _id: randomUUID(),
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year,
        daysAllocated: toDecimal128("0", LEAVE_DAY_SCALE),
        daysUsed: toDecimal128(fromScaled(requested), LEAVE_DAY_SCALE),
      },
    ],
    { session },
  );
}

/**
 * Seeds or adjusts an allocation. This is the path that gives a balance a
 * positive `days_allocated`; the trigger path never sets one.
 */
export async function setLeaveAllocation(
  input: {
    employeeId: string;
    leaveTypeId: string;
    year: number;
    daysAllocated: mongoose.Types.Decimal128 | string | number;
  },
  session?: ClientSession,
): Promise<void> {
  const allocated = toScaled(input.daysAllocated);

  const existing = await LeaveBalance.findOne({
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    year: input.year,
  })
    .session(session ?? null)
    .lean();

  const used = existing ? toScaled(existing.daysUsed) : 0n;

  await LeaveBalance.updateOne(
    { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year },
    {
      $set: { daysAllocated: toDecimal128(fromScaled(allocated), LEAVE_DAY_SCALE) },
      $setOnInsert: {
        _id: randomUUID(),
        daysUsed: toDecimal128("0", LEAVE_DAY_SCALE),
      },
    },
    { upsert: true, session },
  );
}
