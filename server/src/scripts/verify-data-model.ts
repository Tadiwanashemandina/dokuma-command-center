import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase, supportsTransactions, withTransaction } from "../db/connection.js";
import {
  ActivityRecord,
  Application,
  AttendanceRecord,
  Employee,
  FinanceAccount,
  FinanceTransaction,
  KpiFeed,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  Project,
  ensureIndexes,
  resetDatabase,
} from "../db/models/index.js";
import { currentDate, decimalToString, toDateOnly, toDecimal128 } from "../db/types.js";
import { getAccountBalanceAsOf, getUnusualTransactions, recomputeAccountBalance } from "../services/finance/balances.js";
import { applyApprovedLeaveToBalance } from "../services/hr/leave-balances.js";
import { computeCeoDashboardKpis, refreshKpiFeed } from "../services/kpi.js";
import { randomUUID } from "node:crypto";

/**
 * Prompt 3's validation gate.
 *
 * Runs the data model against a REAL mongod — a single-node replica set from
 * `mongodb-memory-server`, so multi-document transactions (D-11) actually work
 * rather than being silently skipped. The server is disposable: it is created
 * here, torn down at the end, and never touches a developer's own database.
 *
 *   npm run db:verify --workspace @dokuma/server
 *
 * What it proves, in the order Prompt 3 asks for it:
 *   1. indexes build, including every compound unique constraint
 *   2. duplicate and invalid input is rejected
 *   3. the two Postgres triggers behave as they did in SQL
 *   4. representative dashboard / finance / HR / scoped queries return
 *      the figures the concept doc specifies
 */

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

/** Asserts that `work` rejects — used for the constraint checks. */
async function rejects(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
    check(name, false, "expected the write to be rejected, but it succeeded");
  } catch {
    check(name, true);
  }
}

// ---------------------------------------------------------------------------

async function verifyIndexes(): Promise<void> {
  console.log("\n[1] Indexes");

  const results = await ensureIndexes();
  const total = results.reduce((sum, r) => sum + r.indexes, 0);
  check(`ensureIndexes built indexes on ${results.length} models (${total} total)`, results.length > 0);

  // Spot-check the compound unique constraints that the migration inventory
  // calls out; a missing one of these fails OPEN (duplicate rows, silently).
  const expectations: [string, mongoose.Model<never>, string[]][] = [
    ["activity_records (person_name, activity_date, source)", ActivityRecord as never, ["personName", "activityDate", "source"]],
    ["applications (job_opening_id, candidate_id)", Application as never, ["jobOpeningId", "candidateId"]],
    ["attendance_records (employee_id, date)", AttendanceRecord as never, ["employeeId", "date"]],
    ["leave_balances (employee_id, leave_type_id, year)", LeaveBalance as never, ["employeeId", "leaveTypeId", "year"]],
    ["kpi_feed (company, metric_name, as_of_date)", KpiFeed as never, ["company", "metricName", "asOfDate"]],
  ];

  for (const [label, model, keys] of expectations) {
    const indexes = await model.collection.indexes();
    const found = indexes.some(
      (index) =>
        index.unique === true &&
        keys.length === Object.keys(index.key).length &&
        keys.every((k) => k in index.key),
    );
    check(`unique index exists: ${label}`, found);
  }
}

/**
 * Date-only normalization must apply to date-only COLUMNS and nothing else.
 *
 * This was briefly a global `Schema.Types.Date.cast()` override, which
 * truncated every Date in the application to UTC midnight — including session
 * and token `expiresAt`. A password-set token issued at 10:00 to expire at
 * 11:00 got midnight of the same day instead, so it was born expired and every
 * invite link was rejected on arrival. Sessions survived only because their
 * expiry happened to round upward.
 */
async function verifyDateHandling(): Promise<void> {
  console.log("\n[2a] Date handling — date-only columns only");

  const { Session } = await import("../db/models/index.js");

  // A timestamp field must keep its time component.
  const expires = new Date("2026-03-01T11:30:45.000Z");
  await Session.create({
    _id: "verify-date-probe",
    userId: randomUUID(),
    expiresAt: expires,
    absoluteExpiresAt: expires,
  });

  const session = await Session.findById("verify-date-probe").lean();
  equal(
    "a timestamp keeps its time (NOT truncated to midnight)",
    session?.expiresAt?.toISOString(),
    "2026-03-01T11:30:45.000Z",
  );

  // A date-only column still normalizes.
  const project = await Project.create({
    _id: randomUUID(),
    name: "Date probe",
    status: "green",
    startDate: new Date("2026-03-01T17:45:00.000Z"),
  });

  const stored = await Project.findById(project._id).lean();
  equal(
    "a date-only column IS normalized to UTC midnight",
    stored?.startDate?.toISOString(),
    "2026-03-01T00:00:00.000Z",
  );

  await Session.deleteOne({ _id: "verify-date-probe" });
  await Project.deleteOne({ _id: project._id });
}

async function verifyConstraints(): Promise<void> {
  console.log("\n[2] Constraints — duplicates and invalid input");

  const today = currentDate();

  await ActivityRecord.create({
    _id: randomUUID(),
    personName: "Duplicate Test",
    activityDate: today,
    source: "csv",
  });

  await rejects("duplicate activity_records business key is rejected", () =>
    ActivityRecord.create({
      _id: randomUUID(),
      personName: "Duplicate Test",
      activityDate: today,
      source: "csv",
    }),
  );

  // Same person, same day, DIFFERENT source — permitted by the 3-column key.
  const differentSource = await ActivityRecord.create({
    _id: randomUUID(),
    personName: "Duplicate Test",
    activityDate: today,
    source: "api",
  });
  check("same person/day with a different source is allowed", differentSource !== null);

  await rejects("invalid enum value is rejected (projects.status)", () =>
    Project.create({ _id: randomUUID(), name: "Bad status", status: "purple" }),
  );

  await rejects("transaction amount must be > 0", async () => {
    const account = await FinanceAccount.create({
      _id: randomUUID(),
      name: "Constraint probe",
      type: "bank",
      openingBalance: "0.00",
      currentBalance: "0.00",
    });
    return FinanceTransaction.create({
      _id: randomUUID(),
      accountId: account._id,
      date: today,
      type: "debit",
      amount: "0.00",
    });
  });

  await rejects("finance_accounts.type rejects a value outside the CHECK list", () =>
    FinanceAccount.create({
      _id: randomUUID(),
      name: "Bad type",
      type: "crypto",
      openingBalance: "0.00",
      currentBalance: "0.00",
    }),
  );
}

async function verifyBalanceTrigger(): Promise<void> {
  console.log("\n[3] Balance recompute — replaces trg_recompute_account_balance");

  const account = await FinanceAccount.create({
    _id: randomUUID(),
    name: "Trigger probe",
    type: "bank",
    currency: "USD",
    openingBalance: "1000.00",
    currentBalance: "1000.00",
  });

  const insert = async (type: "debit" | "credit", amount: string, date = currentDate()) =>
    FinanceTransaction.create({
      _id: randomUUID(),
      accountId: account._id,
      date,
      type,
      amount,
    });

  await insert("credit", "250.50");
  await insert("debit", "100.25");
  await recomputeAccountBalance(account._id);

  const afterTwo = await FinanceAccount.findById(account._id).lean();
  equal("balance = opening + credits - debits", decimalToString(afterTwo!.currentBalance), "1150.25");

  // Decimal128 exactness: 0.1 + 0.2 in float64 is 0.30000000000000004.
  const exact = await FinanceAccount.create({
    _id: randomUUID(),
    name: "Precision probe",
    type: "cash",
    openingBalance: "0.00",
    currentBalance: "0.00",
  });
  for (const amount of ["0.10", "0.20"]) {
    await FinanceTransaction.create({
      _id: randomUUID(),
      accountId: exact._id,
      date: currentDate(),
      type: "credit",
      amount,
    });
  }
  await recomputeAccountBalance(exact._id);
  const precise = await FinanceAccount.findById(exact._id).lean();
  equal("0.10 + 0.20 sums exactly to 0.30 (Decimal128, D-12)", decimalToString(precise!.currentBalance), "0.30");

  // A FUTURE-dated transaction fires the trigger but is excluded from
  // current_balance, because the SQL recomputed as of current_date.
  const future = new Date(currentDate());
  future.setUTCDate(future.getUTCDate() + 10);
  await insert("credit", "9999.00", toDateOnly(future));
  await recomputeAccountBalance(account._id);
  const afterFuture = await FinanceAccount.findById(account._id).lean();
  equal(
    "future-dated transaction is excluded from current_balance",
    decimalToString(afterFuture!.currentBalance),
    "1150.25",
  );

  // ...but it IS included once the as-of date reaches it.
  const asOfFuture = await getAccountBalanceAsOf(account._id, toDateOnly(future));
  equal("the same transaction counts when as-of reaches its date", asOfFuture, "11149.25");

  // A reversal nets out arithmetically — no special-casing.
  await insert("debit", "250.50");
  await recomputeAccountBalance(account._id);
  const afterReversal = await FinanceAccount.findById(account._id).lean();
  equal("a reversing entry nets out to the pre-credit balance", decimalToString(afterReversal!.currentBalance), "899.75");
}

async function verifyUnusualTransactions(): Promise<void> {
  console.log("\n[4] get_unusual_transactions");

  const account = await FinanceAccount.create({
    _id: randomUUID(),
    name: "Outlier probe",
    type: "bank",
    openingBalance: "0.00",
    currentBalance: "0.00",
  });

  const today = currentDate();

  // No history at all -> returns nothing rather than flagging everything.
  await FinanceTransaction.create({
    _id: randomUUID(),
    accountId: account._id,
    date: today,
    type: "debit",
    amount: "5000.00",
  });
  const noHistory = await getUnusualTransactions(account._id, today);
  equal("no trailing history flags nothing", noHistory.length, 0);

  // ~$500 baseline over the prior 30 days.
  for (let n = 1; n <= 10; n += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - n);
    await FinanceTransaction.create({
      _id: randomUUID(),
      accountId: account._id,
      date: toDateOnly(day),
      type: "debit",
      amount: "500.00",
    });
  }

  const flagged = await getUnusualTransactions(account._id, today);
  equal("a 10x transaction is flagged against a $500 baseline", flagged.length, 1);

  // A transaction at exactly 2x must NOT be flagged: the SQL used a strict `>`.
  const account2 = await FinanceAccount.create({
    _id: randomUUID(),
    name: "Boundary probe",
    type: "bank",
    openingBalance: "0.00",
    currentBalance: "0.00",
  });
  for (let n = 1; n <= 5; n += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - n);
    await FinanceTransaction.create({
      _id: randomUUID(),
      accountId: account2._id,
      date: toDateOnly(day),
      type: "debit",
      amount: "100.00",
    });
  }
  await FinanceTransaction.create({
    _id: randomUUID(),
    accountId: account2._id,
    date: today,
    type: "debit",
    amount: "200.00",
  });
  const boundary = await getUnusualTransactions(account2._id, today);
  equal("exactly 2x the average is NOT flagged (strict >)", boundary.length, 0);
}

async function verifyLeaveBalanceTrigger(): Promise<void> {
  console.log("\n[5] Leave balance — replaces trg_recompute_leave_balance");

  const employee = await Employee.create({ _id: randomUUID(), fullName: "Leave Probe" });
  const leaveType = await LeaveType.create({ _id: randomUUID(), name: "Annual", daysPerYear: 20 });

  await applyApprovedLeaveToBalance({
    employeeId: employee._id,
    leaveTypeId: leaveType._id,
    startDate: new Date(Date.UTC(2026, 2, 1)),
    daysRequested: "3.5",
  });

  // NOT .lean(): `daysRemaining` is a virtual, and lean() strips virtuals.
  const seeded = await LeaveBalance.findOne({ employeeId: employee._id });
  equal("days_used set from the request", decimalToString(seeded!.daysUsed, 1), "3.5");
  equal("days_allocated seeded to 0, as the SQL insert branch did", decimalToString(seeded!.daysAllocated, 1), "0.0");
  equal("days_remaining goes NEGATIVE with no allocation (preserved)", seeded!.get("daysRemaining"), "-3.5");
  equal("year taken from start_date", seeded!.year, 2026);

  // A second approval accumulates.
  await applyApprovedLeaveToBalance({
    employeeId: employee._id,
    leaveTypeId: leaveType._id,
    startDate: new Date(Date.UTC(2026, 5, 10)),
    daysRequested: "1.5",
  });
  const accumulated = await LeaveBalance.findOne({ employeeId: employee._id }).lean();
  equal("a second approval accumulates days_used", decimalToString(accumulated!.daysUsed, 1), "5.0");

  // Leave spanning New Year is attributed entirely to the START year.
  await applyApprovedLeaveToBalance({
    employeeId: employee._id,
    leaveTypeId: leaveType._id,
    startDate: new Date(Date.UTC(2026, 11, 28)),
    daysRequested: "5.0",
  });
  const startYear = await LeaveBalance.findOne({ employeeId: employee._id, year: 2026 }).lean();
  const nextYear = await LeaveBalance.findOne({ employeeId: employee._id, year: 2027 }).lean();
  equal("year-spanning leave counts against the start year", decimalToString(startYear!.daysUsed, 1), "10.0");
  check("no row is created for the following year", nextYear === null);
}

async function verifyTransactionAtomicity(): Promise<void> {
  console.log("\n[6] Multi-document transactions (D-11)");

  check("the deployment reports transaction support", supportsTransactions());

  const account = await FinanceAccount.create({
    _id: randomUUID(),
    name: "Atomicity probe",
    type: "bank",
    openingBalance: "100.00",
    currentBalance: "100.00",
  });

  // A transaction that throws must leave BOTH halves unapplied — the insert
  // and the balance recompute are one unit, exactly as the SQL trigger was.
  try {
    await withTransaction("verify-rollback", async (session) => {
      await FinanceTransaction.create(
        [
          {
            _id: randomUUID(),
            accountId: account._id,
            date: currentDate(),
            type: "credit",
            amount: "50.00",
          },
        ],
        { session },
      );
      await recomputeAccountBalance(account._id, session);
      throw new Error("deliberate rollback");
    });
  } catch {
    // expected
  }

  const afterRollback = await FinanceAccount.findById(account._id).lean();
  const txnCount = await FinanceTransaction.countDocuments({ accountId: account._id });
  equal("balance is unchanged after a rolled-back transaction", decimalToString(afterRollback!.currentBalance), "100.00");
  equal("no transaction row survived the rollback", txnCount, 0);

  // And the committing path applies both halves.
  await withTransaction("verify-commit", async (session) => {
    await FinanceTransaction.create(
      [
        {
          _id: randomUUID(),
          accountId: account._id,
          date: currentDate(),
          type: "credit",
          amount: "50.00",
        },
      ],
      { session },
    );
    await recomputeAccountBalance(account._id, session);
  });

  const afterCommit = await FinanceAccount.findById(account._id).lean();
  equal("balance and row are both applied on commit", decimalToString(afterCommit!.currentBalance), "150.00");
}

async function verifyDashboardQueries(): Promise<void> {
  console.log("\n[7] Dashboard KPIs — replaces v_ceo_dashboard_kpis");

  await resetDatabase();
  await ensureIndexes();

  // Reproduce the concept-doc portfolio shape: 7 green / 3 amber / 2 red.
  const statuses = [
    ...Array<string>(7).fill("green"),
    ...Array<string>(3).fill("amber"),
    ...Array<string>(2).fill("red"),
  ];
  for (const [index, status] of statuses.entries()) {
    await Project.create({ _id: randomUUID(), name: `Project ${index}`, status });
  }

  // Team utilisation: every seeded row is 390 on / 110 off = exactly 78.0%.
  for (const person of ["A", "B", "C"]) {
    await ActivityRecord.create({
      _id: randomUUID(),
      personName: `Person ${person}`,
      activityDate: currentDate(),
      onProjectMinutes: 390,
      offProjectMinutes: 110,
      source: "csv",
    });
  }

  const kpis = await computeCeoDashboardKpis();
  equal("active_projects counts ALL projects (no active filter)", kpis.activeProjects, 12);
  equal("projects_green", kpis.projectsGreen, 7);
  equal("projects_amber", kpis.projectsAmber, 3);
  equal("projects_red", kpis.projectsRed, 2);
  equal("team_utilisation_pct is exactly 78.0", kpis.teamUtilisationPct, "78.0");

  // With no activity rows at all, utilisation is null — not 0.
  await ActivityRecord.deleteMany({});
  const noActivity = await computeCeoDashboardKpis();
  equal("utilisation is null when there is no activity (nullif)", noActivity.teamUtilisationPct, null);

  // refresh_kpi_feed writes the 12 contract metrics and is idempotent per day.
  await refreshKpiFeed();
  const firstCount = await KpiFeed.countDocuments({});
  await refreshKpiFeed();
  const secondCount = await KpiFeed.countDocuments({});
  equal("refresh_kpi_feed writes 12 metrics", firstCount, 12);
  equal("re-running the same day upserts rather than duplicating", secondCount, 12);
}

async function verifyScopedQueries(): Promise<void> {
  console.log("\n[8] HR scoping — self / direct report / HR-tier");

  const { employeeScopeFilter, scopeForUser } = await import("../services/scope.js");

  const supervisor = await Employee.create({ _id: randomUUID(), fullName: "The Supervisor" });
  const report = await Employee.create({
    _id: randomUUID(),
    fullName: "Direct Report",
    supervisorId: supervisor._id,
  });
  const stranger = await Employee.create({ _id: randomUUID(), fullName: "Another Team" });

  const leaveType = await LeaveType.create({ _id: randomUUID(), name: "Annual", daysPerYear: 20 });
  for (const employee of [supervisor, report, stranger]) {
    await LeaveRequest.create({
      _id: randomUUID(),
      employeeId: employee._id,
      leaveTypeId: leaveType._id,
      startDate: currentDate(),
      endDate: currentDate(),
      daysRequested: "1.0",
      reason: "private reason",
    });
  }

  // A supervisor with no linked user account still resolves a scope; here we
  // build one directly so the check does not depend on the User model.
  const supervisorScope = {
    userId: "u-supervisor",
    role: "supervisor" as const,
    employeeId: supervisor._id,
    department: "hr" as const,
    isSystem: false,
  };

  const filter = await employeeScopeFilter(supervisorScope);
  const visible = await LeaveRequest.find(filter).lean();
  equal("a supervisor sees exactly self + direct reports", visible.length, 2);
  check(
    "another team's request is NOT visible",
    !visible.some((r) => r.employeeId === stranger._id),
  );

  const hrScope = { ...supervisorScope, role: "hr_manager" as const };
  const hrVisible = await LeaveRequest.find(await employeeScopeFilter(hrScope)).lean();
  equal("HR-tier sees every request", hrVisible.length, 3);

  // An account with no employee record sees nothing — the filter must not
  // degrade to {} (which would return everything).
  const orphanScope = { ...supervisorScope, employeeId: null };
  const orphanVisible = await LeaveRequest.find(await employeeScopeFilter(orphanScope)).lean();
  equal("an account with no employee record sees nothing (fails closed)", orphanVisible.length, 0);

  // Leave-reason masking (v_leave_requests).
  const { maskLeaveReason } = await import("../services/scope.js");
  const reportRow = visible.find((r) => r.employeeId === report._id)!;
  const masked = maskLeaveReason(supervisorScope, {
    employeeId: reportRow.employeeId,
    reason: reportRow.reason ?? null,
  });
  check("a supervisor cannot read a report's leave reason", masked.reason === null);

  const ownRow = visible.find((r) => r.employeeId === supervisor._id)!;
  const unmasked = maskLeaveReason(supervisorScope, {
    employeeId: ownRow.employeeId,
    reason: ownRow.reason ?? null,
  });
  check("but can read their own", unmasked.reason === "private reason");

  void scopeForUser; // referenced so the import is meaningful in review
}

/**
 * Runs the real seed and checks that the concept-doc figures reproduce.
 *
 * seed.sql's header states these are exact, confirmed values that must not
 * drift: 12 projects (7 green / 3 amber / 2 red), 6 critical blockers across
 * 3 distinct projects, USD 4.2m / 2.1m / 480k, 78.0% utilisation. The two
 * task counts (87 due this week / 19 overdue) are deliberately date-relative
 * and are checked here at the moment of seeding, when they are exact.
 */
async function verifySeed(): Promise<void> {
  console.log("\n[9] Seed — reproduces the concept-doc figures");

  await resetDatabase();

  // Imported lazily: the module runs its own main() on import at top level in
  // some shapes, so it is pulled in only once the database is ready.
  const { seedAll } = await import("./seed.js");
  await seedAll();

  const kpis = await computeCeoDashboardKpis();

  equal("12 projects", kpis.activeProjects, 12);
  equal("7 green", kpis.projectsGreen, 7);
  equal("3 amber", kpis.projectsAmber, 3);
  equal("2 red", kpis.projectsRed, 2);
  equal("6 critical blockers", kpis.criticalBlockers, 6);
  equal("3 high-risk projects (distinct)", kpis.highRiskProjects, 3);
  equal("USD 4.2m revenue pipeline", kpis.revenuePipelineUsd, "4200000.00");
  equal("USD 2.1m contracted revenue", kpis.contractedRevenueUsd, "2100000.00");
  equal("USD 480k outstanding receivables", kpis.outstandingReceivablesUsd, "480000.00");
  equal("78.0% team utilisation", kpis.teamUtilisationPct, "78.0");
  equal("87 tasks due this week (exact at seed time)", kpis.tasksDueThisWeek, 87);
  equal("19 overdue tasks (exact at seed time)", kpis.overdueTasks, 19);

  // The finance seed's balances must reflect every seeded transaction.
  const { getCashPosition } = await import("../services/finance/balances.js");
  const cash = await getCashPosition();
  const usd = cash.find((c) => c.currency === "USD");
  check("cash position is grouped by currency", cash.length === 1 && usd !== undefined);
  equal("all three seeded accounts appear", usd?.accounts.length, 3);

  // Opening 50000 + credits - debits, including the $9,500 outlier.
  const operating = usd?.accounts.find((a) => a.name === "Dokuma Operating Account");
  check(
    "the operating account balance is computed, not left at its opening value",
    operating !== undefined && operating.currentBalance !== "50000.00",
    `got ${operating?.currentBalance}`,
  );

  // The deliberately oversized transaction is there for the report's
  // unusual-transaction flag to catch.
  const { getUnusualTransactions } = await import("../services/finance/balances.js");
  const outliers = await getUnusualTransactions(
    (await FinanceAccount.findOne({ name: "Dokuma Operating Account" }).lean())!._id,
    currentDate(),
  );
  equal("the seeded $9,500 outlier is flagged as unusual", outliers.length, 1);

  // Re-running must not duplicate — Prompt 3 requires an idempotent seed.
  await seedAll();
  const second = await computeCeoDashboardKpis();
  equal("re-running the seed does not duplicate projects", second.activeProjects, 12);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Starting a disposable single-node replica set (mongodb-memory-server)…");

  // A replica set, not a standalone: multi-document transactions (D-11) need
  // one, and verifying atomicity against a standalone would silently pass.
  //
  // The version is pinned to 7.x to match the migration target (inventory §1).
  // The startup timeout is well above the 10s default because a cold start on
  // Windows — first touch of the binary, Defender scanning it, then replica-set
  // initiation — routinely exceeds it, and a timeout here looks like a code
  // failure when it is really just a slow first run.
  const replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.24" },
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });
  const uri = replSet.getUri();

  try {
    await connectToDatabase(uri);
    console.log(`Connected. Transactions supported: ${supportsTransactions()}`);

    await resetDatabase();

    await verifyIndexes();
    await verifyDateHandling();
    await verifyConstraints();
    await verifyBalanceTrigger();
    await verifyUnusualTransactions();
    await verifyLeaveBalanceTrigger();
    await verifyTransactionAtomicity();
    await verifyDashboardQueries();
    await verifyScopedQueries();
    await verifySeed();

    console.log(`\n${checks - failures}/${checks} checks passed.`);
    if (failures > 0) {
      console.log(`${failures} FAILED.`);
      process.exitCode = 1;
    }
  } finally {
    await disconnectFromDatabase().catch(() => undefined);
    await replSet.stop();
  }
}

main().catch((error: unknown) => {
  console.error("\n[verify] crashed:", error);
  process.exitCode = 1;
});
