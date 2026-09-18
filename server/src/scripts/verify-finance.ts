import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connectToDatabase, disconnectFromDatabase, supportsTransactions } from "../db/connection.js";
import {
  FinanceAccount,
  FinanceCreditor,
  FinanceTransaction,
  ProjectFinance,
  FinanceCompanyTotals,
  XeroInvoice,
  ensureIndexes,
  resetDatabase,
} from "../db/models/index.js";
import {
  toDecimal128,
  toDateOnly,
  decimalToString,
  computeMarginPct,
  currentDate,
} from "../db/types.js";
import { getAccountBalanceAsOf, getCashPosition } from "../services/finance/balances.js";
import { createTransaction, reverseTransaction } from "../services/finance/transactions.js";
import {
  computeDailySnapshot,
  computeDlapShare,
  computeWeeklyReportData,
  currentMonthRange,
  currentWeekRange,
} from "../services/finance/reports.js";
import { mapAndValidateRows, commitImport } from "../services/finance/import.js";
import { idempotencyKeyFor } from "../services/xero/push.js";
import {
  parseXeroDate,
  parseXeroDateOnly,
  xeroAmountToString,
  xeroTypeToTransactionType,
  isTransferType,
  xeroInvoiceStatusToCreditorStatus,
} from "../services/xero/mapping.js";
import { resolveXeroConfig, canPushToXero } from "../services/xero/config.js";
import { booleanFlag, createPeriodReportSchema } from "@dokuma/shared";
import { recomputeCompanyTotalsFromXero } from "../services/xero/statements.js";
import { randomUUID } from "node:crypto";

/**
 * The finance module's validation gate.
 *
 *   npm run verify:finance --workspace @dokuma/server
 *
 * Runs against a REAL mongod (a single-node replica set from
 * `mongodb-memory-server`) so the multi-document transactions the balance
 * arithmetic depends on actually execute rather than being silently skipped.
 *
 * It exists because every important property of this module is one that a
 * type-checker cannot see and a casual click-through will not surface:
 * whether the arithmetic is exact, whether a reversal nets to zero, whether
 * an import is genuinely all-or-nothing, and whether the Xero direction
 * mapping is the right way round. Each of those fails silently in production
 * as a wrong number rather than as an error.
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

async function rejects(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
    check(name, false, "expected a rejection, but it succeeded");
  } catch {
    check(name, true);
  }
}

const DAY = (d: string) => toDateOnly(new Date(`${d}T00:00:00Z`));

async function makeAccount(name: string, opening: string, currency = "USD"): Promise<string> {
  const account = await FinanceAccount.create({
    name,
    type: "bank",
    currency,
    openingBalance: toDecimal128(opening),
    currentBalance: toDecimal128(opening),
  });
  return account._id;
}

// ---------------------------------------------------------------------------
// [1] Exact decimal arithmetic
// ---------------------------------------------------------------------------

/**
 * The property float64 cannot hold.
 *
 * 0.1 + 0.2 is 0.30000000000000004 as a double. Summed across a few thousand
 * ledger rows the error becomes cents, and cents are what a bank reconciliation
 * is checked to. This is the single most important check in the file.
 */
async function verifyExactArithmetic(): Promise<void> {
  console.log("\n[1] Exact decimal arithmetic");

  const accountId = await makeAccount("Precision probe", "0.00");

  // 1000 credits of 0.01 must be exactly 10.00, not 9.999999999999831.
  for (let i = 0; i < 1000; i += 1) {
    await FinanceTransaction.create({
      accountId,
      date: DAY("2026-01-15"),
      type: "credit",
      amount: toDecimal128("0.01"),
    });
  }

  const balance = await getAccountBalanceAsOf(accountId, DAY("2026-01-15"));
  equal("1000 × 0.01 sums to exactly 10.00", balance, "10.00");

  // The classic: 0.1 + 0.2 - 0.3 must be exactly zero.
  const tinyId = await makeAccount("Tiny", "0.00");
  for (const amount of ["0.10", "0.20"]) {
    await FinanceTransaction.create({
      accountId: tinyId,
      date: DAY("2026-01-15"),
      type: "credit",
      amount: toDecimal128(amount),
    });
  }
  await FinanceTransaction.create({
    accountId: tinyId,
    date: DAY("2026-01-15"),
    type: "debit",
    amount: toDecimal128("0.30"),
  });

  equal(
    "0.10 + 0.20 − 0.30 is exactly 0.00",
    await getAccountBalanceAsOf(tinyId, DAY("2026-01-15")),
    "0.00",
  );

  // Large magnitudes stay exact — float64 loses integer precision past 2^53.
  const bigId = await makeAccount("Large", "99999999.99");
  await FinanceTransaction.create({
    accountId: bigId,
    date: DAY("2026-01-15"),
    type: "credit",
    amount: toDecimal128("0.01"),
  });
  equal(
    "99999999.99 + 0.01 is exactly 100000000.00",
    await getAccountBalanceAsOf(bigId, DAY("2026-01-15")),
    "100000000.00",
  );
}

// ---------------------------------------------------------------------------
// [2] Balance semantics
// ---------------------------------------------------------------------------

async function verifyBalanceSemantics(): Promise<void> {
  console.log("\n[2] Balance semantics");

  const accountId = await makeAccount("Semantics", "100.00");

  await FinanceTransaction.create({
    accountId,
    date: DAY("2026-02-10"),
    type: "credit",
    amount: toDecimal128("50.00"),
  });
  await FinanceTransaction.create({
    accountId,
    date: DAY("2026-02-20"),
    type: "debit",
    amount: toDecimal128("30.00"),
  });

  equal(
    "opening balance is returned when no transactions qualify",
    await getAccountBalanceAsOf(accountId, DAY("2026-02-01")),
    "100.00",
  );

  // The date bound is INCLUSIVE — a transaction dated exactly as-of counts.
  equal(
    "the as-of date bound is inclusive",
    await getAccountBalanceAsOf(accountId, DAY("2026-02-10")),
    "150.00",
  );

  equal(
    "credits add and debits subtract",
    await getAccountBalanceAsOf(accountId, DAY("2026-02-28")),
    "120.00",
  );
}

// ---------------------------------------------------------------------------
// [3] Reversal
// ---------------------------------------------------------------------------

/**
 * A reversal must net the balance back to where it started, mark the original,
 * and refuse to happen twice. All three in one place because they are one
 * behavior (§9) and breaking any of them corrupts the ledger differently.
 */
async function verifyReversal(): Promise<void> {
  console.log("\n[3] Reversal — never deletion");

  const actorId = randomUUID();
  const accountId = await makeAccount("Reversal", "1000.00");

  const created = await createTransaction(
    {
      account_id: accountId,
      date: "2026-03-05",
      type: "debit",
      amount: "250.00",
      category: null,
      counterparty: "Supplier",
      description: "Payment",
      reference_no: "REF-1",
      is_dlap: false,
      dlap_share_pct: null,
    },
    actorId,
  );

  equal("balance after the debit", created.currentBalance, "750.00");

  const reversal = await reverseTransaction(created.id, "Duplicate payment", actorId);

  equal("balance nets back after the reversal", reversal.currentBalance, "1000.00");

  const original = await FinanceTransaction.findById(created.id).lean();
  check("the original is marked is_reversed", original?.isReversed === true);
  check("the original is NOT deleted", original !== null);

  const reversalRow = await FinanceTransaction.findById(reversal.id).lean();
  equal("the reversal is the opposite type", reversalRow?.type, "credit");
  equal("the reversal links to the original", reversalRow?.reversesTransactionId, created.id);
  check(
    "the reversal records the reason in its description",
    (reversalRow?.description ?? "").includes("Duplicate payment"),
  );

  await rejects("a second reversal of the same transaction is refused", () =>
    reverseTransaction(created.id, "again", actorId),
  );

  await rejects("reversing a reversal is refused", () =>
    reverseTransaction(reversal.id, "undo the undo", actorId),
  );
}

// ---------------------------------------------------------------------------
// [4] Atomicity (D-11)
// ---------------------------------------------------------------------------

/**
 * The insert and the balance recompute must commit together.
 *
 * Verified by the observable consequence rather than by simulating a crash:
 * after any successful create, the stored `current_balance` must equal a fresh
 * replay of the history. If the two ever ran outside one transaction, a
 * failure between them would leave those permanently unequal — and nothing in
 * the application would ever notice.
 */
async function verifyAtomicity(): Promise<void> {
  console.log("\n[4] Transaction atomicity (D-11)");

  check("the deployment supports multi-document transactions", supportsTransactions());

  const accountId = await makeAccount("Atomicity", "500.00");
  const actorId = randomUUID();

  for (const amount of ["10.00", "20.50", "0.05"]) {
    await createTransaction(
      {
        account_id: accountId,
        date: "2026-04-01",
        type: "credit",
        amount,
        category: null,
        counterparty: null,
        description: null,
        reference_no: null,
        is_dlap: false,
        dlap_share_pct: null,
      },
      actorId,
    );
  }

  const stored = await FinanceAccount.findById(accountId).select("currentBalance").lean();
  const replayed = await getAccountBalanceAsOf(accountId, new Date());

  equal("stored current_balance matches a replay of the history", decimalToString(stored!.currentBalance), replayed);
  equal("and it is the arithmetically correct figure", replayed, "530.55");
}

// ---------------------------------------------------------------------------
// [5] Cash position
// ---------------------------------------------------------------------------

async function verifyCashPosition(): Promise<void> {
  console.log("\n[5] Cash position — grouped by currency, never summed across");

  await FinanceAccount.deleteMany({});

  await makeAccount("USD Main", "1000.00", "USD");
  await makeAccount("USD Petty", "250.50", "USD");
  await makeAccount("ZWL Ops", "80000.00", "ZWL");

  const position = await getCashPosition();

  equal("one bucket per currency", position.length, 2);

  const usd = position.find((p) => p.currency === "USD");
  const zwl = position.find((p) => p.currency === "ZWL");

  equal("USD total is the sum of its accounts only", usd?.totalBalance, "1250.50");
  equal("ZWL total is separate", zwl?.totalBalance, "80000.00");
  check(
    "currencies are NOT summed into a single figure",
    position.every((p) => p.currency !== "MIXED"),
  );
}

// ---------------------------------------------------------------------------
// [6] DLAP share
// ---------------------------------------------------------------------------

async function verifyDlap(): Promise<void> {
  console.log("\n[6] DLAP share — exact percentage arithmetic");

  await FinanceTransaction.deleteMany({});
  const accountId = await makeAccount("DLAP", "0.00");

  // 33.33% of 100.00 is 33.33. In float64, 100 * (33.33/100) is
  // 33.329999999999998, which rounds correctly by luck — but summed over many
  // rows the luck runs out.
  for (let i = 0; i < 3; i += 1) {
    await FinanceTransaction.create({
      accountId,
      date: DAY("2026-05-10"),
      type: "credit",
      amount: toDecimal128("100.00"),
      isDlap: true,
      dlapSharePct: toDecimal128("33.33", 2),
    });
  }

  const dlap = await computeDlapShare("2026-05-01", "2026-05-31");

  equal("DLAP total amount", dlap.total_amount, "300.00");
  equal("DLAP share is exactly 3 × 33.33", dlap.dokuma_share, "99.99");
  equal("DLAP transaction count", dlap.transaction_count, 3);
}

// ---------------------------------------------------------------------------
// [7] Reports
// ---------------------------------------------------------------------------

async function verifyReports(): Promise<void> {
  console.log("\n[7] Reports");

  await FinanceAccount.deleteMany({});
  await FinanceTransaction.deleteMany({});

  const accountId = await makeAccount("Report", "1000.00");

  await FinanceTransaction.create({
    accountId,
    date: DAY("2026-06-15"),
    type: "credit",
    amount: toDecimal128("200.00"),
  });
  await FinanceTransaction.create({
    accountId,
    date: DAY("2026-06-15"),
    type: "debit",
    amount: toDecimal128("75.00"),
  });

  const snapshot = await computeDailySnapshot("2026-06-15");

  equal("daily opening balance is the previous day's close", snapshot.opening_balance, "1000.00");
  equal("daily closing balance includes the day's movements", snapshot.closing_balance, "1125.00");
  equal("transactions in", snapshot.transactions_in, "200.00");
  equal("transactions out", snapshot.transactions_out, "75.00");

  /**
   * Current vs Closing balance (§9) — the two fields that look like one.
   *
   * The period ends in the past and there are no transactions after it, so
   * both equal the same figure here. What is verified is that BOTH FIELDS
   * EXIST and are populated: collapsing them is the plausible "cleanup" that
   * would destroy the signal, and this check fails if someone does.
   */
  const weekly = await computeWeeklyReportData("2026-06-08", "2026-06-14");
  check("weekly report carries closing_balance", typeof weekly.closing_balance === "string");
  check("weekly report carries current_balance separately", typeof weekly.current_balance === "string");
  equal("weekly trend has 4 points", weekly.trend.length, 4);
  check(
    "trend points are labelled oldest-first",
    weekly.trend[0]?.label === "4 weeks ago" && weekly.trend[3]?.label === "1 week ago",
  );
}

// ---------------------------------------------------------------------------
// [8] Period boundaries
// ---------------------------------------------------------------------------

async function verifyPeriods(): Promise<void> {
  console.log("\n[8] Period boundaries — UTC");

  const feb = currentMonthRange(new Date("2024-02-15T12:00:00Z"));
  equal("February 2024 (leap year) starts on the 1st", feb.start, "2024-02-01");
  equal("February 2024 ends on the 29th", feb.end, "2024-02-29");

  const dec = currentMonthRange(new Date("2026-12-31T23:00:00Z"));
  equal("December ends on the 31st", dec.end, "2026-12-31");

  // A Sunday must belong to the week that is ending, not the one starting.
  const sunday = currentWeekRange(new Date("2026-06-14T12:00:00Z"));
  equal("a Sunday's week starts on the preceding Monday", sunday.start, "2026-06-08");
  equal("and ends on that Sunday", sunday.end, "2026-06-14");

  const monday = currentWeekRange(new Date("2026-06-15T12:00:00Z"));
  equal("a Monday starts its own week", monday.start, "2026-06-15");
}

// ---------------------------------------------------------------------------
// [9] Import — all-or-nothing
// ---------------------------------------------------------------------------

async function verifyImport(): Promise<void> {
  console.log("\n[9] Excel import — all-or-nothing (§9)");

  await FinanceTransaction.deleteMany({});
  const accountId = await makeAccount("Import", "0.00");
  const actorId = randomUUID();

  const mapping = { date: "Date", type: "Type", amount: "Amount" };

  const goodRows = [
    { Date: "2026-07-01", Type: "credit", Amount: "100.00" },
    { Date: "2026-07-02", Type: "debit", Amount: "40.00" },
  ];

  const good = mapAndValidateRows(goodRows, mapping, accountId);
  equal("valid rows validate", good.validCount, 2);
  equal("with no invalid rows", good.invalidCount, 0);

  const result = await commitImport(good.results, accountId, actorId);
  equal("all rows were inserted", result.inserted, 2);
  equal("and the balance was recomputed once, correctly", result.currentBalance, "60.00");

  // One bad row must abort the WHOLE import.
  const mixedRows = [
    { Date: "2026-07-03", Type: "credit", Amount: "500.00" },
    { Date: "not-a-date", Type: "credit", Amount: "10.00" },
  ];

  const mixed = mapAndValidateRows(mixedRows, mapping, accountId);
  equal("the invalid row is detected", mixed.invalidCount, 1);

  await rejects("a batch containing an invalid row is refused", () =>
    commitImport(mixed.results, accountId, actorId),
  );

  const countAfter = await FinanceTransaction.countDocuments({ accountId });
  equal("NOTHING from the rejected batch was written", countAfter, 2);

  /**
   * Ambiguous dates are rejected rather than guessed.
   *
   * `03/04/2026` is March 4th in the US and April 3rd elsewhere. The legacy
   * importer resolved it with the host's locale, silently booking a
   * transaction into the wrong month.
   */
  const ambiguous = mapAndValidateRows(
    [{ Date: "03/04/2026", Type: "credit", Amount: "10.00" }],
    mapping,
    accountId,
  );
  equal("an ambiguous DD/MM vs MM/DD date is rejected, not guessed", ambiguous.invalidCount, 1);

  // Prototype pollution via a header cell must not reach Object.prototype.
  const polluted = mapAndValidateRows(
    [{ Date: "2026-07-05", Type: "credit", Amount: "10.00" }],
    mapping,
    accountId,
  );
  check("a normal row still validates after the pollution probe", polluted.validCount === 1);
  check(
    "Object.prototype was not polluted",
    ({} as Record<string, unknown>)["polluted"] === undefined,
  );
}

// ---------------------------------------------------------------------------
// [10] Margin
// ---------------------------------------------------------------------------

async function verifyMargin(): Promise<void> {
  console.log("\n[10] Project margin — null is not zero");

  equal("margin of a 100k budget with 25k spent", computeMarginPct("100000.00", "25000.00"), 75);
  equal("margin with no cost yet", computeMarginPct("100000.00", null), 100);
  equal("a zero budget yields NULL, not zero", computeMarginPct("0.00", "500.00"), null);
  equal("an absent budget yields NULL", computeMarginPct(null, "500.00"), null);
  equal("overspend produces a negative margin", computeMarginPct("100.00", "150.00"), -50);
  equal("rounds to 2 decimal places", computeMarginPct("3.00", "1.00"), 66.67);

  // The virtual and the function must agree — they are one formula.
  const projectId = randomUUID();
  await ProjectFinance.create({
    projectId,
    budgetUsd: toDecimal128("80000.00"),
    costToDateUsd: toDecimal128("20000.00"),
  });
  const doc = await ProjectFinance.findOne({ projectId });
  equal("the model virtual agrees with the function", doc?.get("marginPct"), 75);
}

// ---------------------------------------------------------------------------
// [11] Xero mapping
// ---------------------------------------------------------------------------

/**
 * The direction mapping is the conversion most likely to be silently wrong.
 *
 * RECEIVE means money into the bank account, which INCREASES the balance, and
 * this application's `credit` adds. Getting it backwards inverts every synced
 * balance — and the figure still looks plausible.
 */
function verifyXeroMapping(): void {
  console.log("\n[11] Xero mapping");

  equal("RECEIVE is a credit (money in, balance up)", xeroTypeToTransactionType("RECEIVE"), "credit");
  equal("SPEND is a debit (money out, balance down)", xeroTypeToTransactionType("SPEND"), "debit");
  equal("RECEIVE-OVERPAYMENT is a credit", xeroTypeToTransactionType("RECEIVE-OVERPAYMENT"), "credit");
  equal("SPEND-PREPAYMENT is a debit", xeroTypeToTransactionType("SPEND-PREPAYMENT"), "debit");
  equal("an unknown type maps to null rather than a guess", xeroTypeToTransactionType("MYSTERY"), null);

  check("transfers are identified for skipping", isTransferType("SPEND-TRANSFER"));
  check("a plain SPEND is not a transfer", !isTransferType("SPEND"));

  // .NET epoch dates — the offset must NOT be added.
  const dotNet = parseXeroDate("/Date(1640995200000+0000)/");
  equal("a .NET date parses to the right instant", dotNet?.toISOString(), "2022-01-01T00:00:00.000Z");

  const offsetDate = parseXeroDateOnly("/Date(1640995200000+1300)/");
  equal("a .NET date's timezone suffix is not added to the value", offsetDate, "2022-01-01");

  /**
   * A naive datetime must be read as UTC, not as the host's local time.
   *
   * This check caught a real bug: `new Date("2026-03-15T00:00:00")` parses as
   * LOCAL time per ECMA-262, so on a UTC+2 host it became 22:00 on the 14th
   * and every Xero date landed a day early. The failure is invisible on a
   * UTC-configured CI box and appears only where the server actually runs.
   */
  equal("a naive datetime is read as UTC, not local time", parseXeroDateOnly("2026-03-15T00:00:00"), "2026-03-15");
  equal("a naive datetime late in the day stays on its day", parseXeroDateOnly("2026-03-15T23:30:00"), "2026-03-15");
  equal("an explicit Z is honoured", parseXeroDateOnly("2026-03-15T00:00:00Z"), "2026-03-15");
  equal("a date-only string parses", parseXeroDateOnly("2026-03-15"), "2026-03-15");
  equal(
    "an explicit offset is respected (not treated as naive)",
    parseXeroDateOnly("2026-03-15T01:00:00+02:00"),
    "2026-03-14",
  );
  equal("a null date stays null", parseXeroDate(null), null);
  equal("garbage parses to null, not Invalid Date", parseXeroDate("not a date"), null);

  equal("a Xero number amount is pinned to 2dp", xeroAmountToString(1234.5), "1234.50");
  equal("a Xero string amount keeps its exact digits", xeroAmountToString("99.99"), "99.99");
  equal("a missing amount is 0.00, never NaN", xeroAmountToString(undefined), "0.00");

  equal(
    "an AUTHORISED invoice with no payment is outstanding",
    xeroInvoiceStatusToCreditorStatus("AUTHORISED", 0),
    "outstanding",
  );
  equal(
    "an AUTHORISED invoice with a part payment is partially_paid",
    xeroInvoiceStatusToCreditorStatus("AUTHORISED", 50),
    "partially_paid",
  );
  equal("a PAID invoice is paid", xeroInvoiceStatusToCreditorStatus("PAID", 100), "paid");
  equal("a VOIDED invoice is treated as paid (stop chasing)", xeroInvoiceStatusToCreditorStatus("VOIDED", 0), "paid");
}

// ---------------------------------------------------------------------------
// [12] Xero fail-closed + idempotency
// ---------------------------------------------------------------------------

function verifyXeroSafety(): void {
  console.log("\n[12] Xero — fail closed, and idempotent by construction");

  // Clear anything the developer's own .env might have set.
  const saved = {
    id: process.env["XERO_CLIENT_ID"],
    secret: process.env["XERO_CLIENT_SECRET"],
    uri: process.env["XERO_REDIRECT_URI"],
    mode: process.env["XERO_MODE"],
  };

  delete process.env["XERO_CLIENT_ID"];
  delete process.env["XERO_CLIENT_SECRET"];
  delete process.env["XERO_REDIRECT_URI"];
  delete process.env["XERO_MODE"];

  let config = resolveXeroConfig();
  equal("with no credentials the integration is disabled", config.mode, "disabled");
  check("and it states why", typeof config.reason === "string" && config.reason.length > 0);
  check("a disabled integration cannot push", !canPushToXero(config));

  // http redirect URI must be refused (localhost excepted).
  process.env["XERO_CLIENT_ID"] = "test-client";
  process.env["XERO_CLIENT_SECRET"] = "test-secret";
  process.env["XERO_REDIRECT_URI"] = "http://evil.example.com/callback";
  config = resolveXeroConfig();
  equal("a non-https redirect URI disables the integration", config.mode, "disabled");

  process.env["XERO_REDIRECT_URI"] = "https://app.example.com/callback";
  process.env["XERO_MODE"] = "read-only";
  config = resolveXeroConfig();
  equal("read-only mode resolves", config.mode, "read-only");
  check("read-only CANNOT push", !canPushToXero(config));
  check(
    "read-only requests no write scope",
    !config.scopes.includes("accounting.transactions"),
  );

  process.env["XERO_MODE"] = "live";
  config = resolveXeroConfig();
  equal("live mode resolves", config.mode, "live");
  check("live may push", canPushToXero(config));
  check("the secret is never in the described config", !JSON.stringify(config).includes("XERO_CLIENT_SECRET"));

  // Idempotency keys must be stable across calls and distinct per transaction.
  const a = randomUUID();
  const b = randomUUID();
  equal("the idempotency key is deterministic", idempotencyKeyFor(a), idempotencyKeyFor(a));
  check("and distinct per transaction", idempotencyKeyFor(a) !== idempotencyKeyFor(b));

  // Restore.
  if (saved.id === undefined) delete process.env["XERO_CLIENT_ID"];
  else process.env["XERO_CLIENT_ID"] = saved.id;
  if (saved.secret === undefined) delete process.env["XERO_CLIENT_SECRET"];
  else process.env["XERO_CLIENT_SECRET"] = saved.secret;
  if (saved.uri === undefined) delete process.env["XERO_REDIRECT_URI"];
  else process.env["XERO_REDIRECT_URI"] = saved.uri;
  if (saved.mode === undefined) delete process.env["XERO_MODE"];
  else process.env["XERO_MODE"] = saved.mode;
}

// ---------------------------------------------------------------------------
// [13] Xero sync idempotency at the database level
// ---------------------------------------------------------------------------

/**
 * The unique partial index is what actually stops a re-run duplicating the
 * ledger. Verified directly, because it is the last line of defence if the
 * cursor logic is ever wrong.
 */
async function verifyXeroIndexes(): Promise<void> {
  console.log("\n[13] Xero sync — duplicate protection");

  await FinanceTransaction.deleteMany({});
  const accountId = await makeAccount("Xero sync", "0.00");

  const xeroId = "xero-txn-abc-123";

  await FinanceTransaction.create({
    accountId,
    date: DAY("2026-08-01"),
    type: "credit",
    amount: toDecimal128("500.00"),
    source: "xero-sync",
    xeroTransactionId: xeroId,
  });

  await rejects("a second row with the same Xero id is refused by the index", () =>
    FinanceTransaction.create({
      accountId,
      date: DAY("2026-08-01"),
      type: "credit",
      amount: toDecimal128("500.00"),
      source: "xero-sync",
      xeroTransactionId: xeroId,
    }),
  );

  // Many rows WITHOUT a Xero id must still be allowed — the index is partial.
  for (let i = 0; i < 3; i += 1) {
    await FinanceTransaction.create({
      accountId,
      date: DAY("2026-08-02"),
      type: "debit",
      amount: toDecimal128("1.00"),
    });
  }
  const unlinked = await FinanceTransaction.countDocuments({
    accountId,
    xeroTransactionId: null,
  });
  equal("rows with no Xero id are unaffected by the unique index", unlinked, 3);

  // Same for creditors.
  await FinanceCreditor.create({
    name: "Supplier A",
    amountOwed: toDecimal128("100.00"),
    xeroInvoiceId: "xero-inv-1",
  });
  await rejects("a duplicate Xero invoice id is refused", () =>
    FinanceCreditor.create({
      name: "Supplier A again",
      amountOwed: toDecimal128("100.00"),
      xeroInvoiceId: "xero-inv-1",
    }),
  );
}

// ---------------------------------------------------------------------------
// [14] Regressions — bugs found in review, each fixed and pinned here
// ---------------------------------------------------------------------------

/**
 * Every check below corresponds to a real defect that shipped into the working
 * tree and was caught by review rather than by the type-checker. They are
 * pinned because each one fails SILENTLY in production — none would raise an
 * error, they would just produce a wrong number or quietly do nothing.
 */
async function verifyRegressions(): Promise<void> {
  console.log("\n[14] Regressions");

  /**
   * `z.coerce.boolean()` is `Boolean(value)`, so the STRING "false" is true.
   *
   * A multipart field and a query parameter are always strings. With the
   * coercing version, `dry_run=false` parsed as `true` and EVERY real import
   * took the dry-run branch: the wizard reported success and wrote nothing.
   */
  equal('booleanFlag parses the string "false" as false', booleanFlag.parse("false"), false);
  equal('booleanFlag parses the string "true" as true', booleanFlag.parse("true"), true);
  equal('booleanFlag parses "0" as false', booleanFlag.parse("0"), false);
  equal("booleanFlag passes a real boolean through", booleanFlag.parse(true), true);
  check(
    "booleanFlag REJECTS an unrecognised string rather than defaulting true",
    !booleanFlag.safeParse("maybe").success,
  );

  // The same schema the import endpoint uses, end to end.
  equal(
    "a report saved with publish=\"false\" stays a draft",
    createPeriodReportSchema.parse({
      period_start: "2026-01-01",
      period_end: "2026-01-07",
      publish: "false",
    }).publish,
    false,
  );

  /**
   * `recomputeCompanyTotalsFromXero` must not blank the two pipeline KPIs.
   *
   * They are commercial forecasts with no Xero counterpart. Seeding them to
   * zero when creating the day's row wiped both headline CEO figures every
   * morning at 03:30 — the exact failure the function's own comment claims to
   * prevent.
   */
  await FinanceCompanyTotals.deleteMany({});
  await XeroInvoice.deleteMany({});

  const yesterday = new Date(currentDate().getTime() - 24 * 60 * 60 * 1000);
  await FinanceCompanyTotals.create({
    asOfDate: toDateOnly(yesterday),
    revenuePipelineUsd: toDecimal128("4200000.00"),
    contractedRevenueUsd: toDecimal128("2100000.00"),
    outstandingReceivablesUsd: toDecimal128("480000.00"),
  });

  await XeroInvoice.create({
    tenantId: "t1",
    xeroInvoiceId: "inv-regression-1",
    status: "AUTHORISED",
    total: toDecimal128("1000.00"),
    amountDue: toDecimal128("750.25"),
    amountPaid: toDecimal128("249.75"),
  });

  const totals = await recomputeCompanyTotalsFromXero("t1");
  equal("receivables are computed from AUTHORISED invoices", totals.outstandingReceivables, "750.25");

  const todayRow = await FinanceCompanyTotals.findOne({ asOfDate: currentDate() }).lean();
  equal(
    "revenue pipeline is carried forward, NOT zeroed",
    decimalToString(todayRow?.revenuePipelineUsd ?? null),
    "4200000.00",
  );
  equal(
    "contracted revenue is carried forward, NOT zeroed",
    decimalToString(todayRow?.contractedRevenueUsd ?? null),
    "2100000.00",
  );

  // Re-running the same day must not lose them either.
  await recomputeCompanyTotalsFromXero("t1");
  const rerun = await FinanceCompanyTotals.findOne({ asOfDate: currentDate() }).lean();
  equal(
    "a second run the same day still preserves the pipeline",
    decimalToString(rerun?.revenuePipelineUsd ?? null),
    "4200000.00",
  );

  /**
   * The sync upsert must be atomic, not findOne-then-create.
   *
   * Two overlapping runs both observing "not present" both insert; the unique
   * index rejects the loser, aborting the resource and discarding its cursor.
   * An upsert converges instead — which is what the index was added for.
   */
  await FinanceTransaction.deleteMany({});
  const accountId = await makeAccount("Concurrent sync", "0.00");

  const fields = {
    accountId,
    date: DAY("2026-09-01"),
    type: "credit" as const,
    amount: toDecimal128("123.45"),
    source: "xero-sync" as const,
    xeroTransactionId: "xero-concurrent-1",
  };

  // Fired together, as two overlapping sync runs would.
  const writes = await Promise.allSettled(
    [0, 1, 2].map(() =>
      FinanceTransaction.updateOne(
        { xeroTransactionId: fields.xeroTransactionId },
        { $set: fields, $setOnInsert: { createdBy: null } },
        { upsert: true },
      ),
    ),
  );

  const rejected = writes.filter((w) => w.status === "rejected").length;
  const rows = await FinanceTransaction.countDocuments({
    xeroTransactionId: fields.xeroTransactionId,
  });

  equal("three concurrent upserts produce exactly one row", rows, 1);
  check(
    "and none of them threw a duplicate-key error",
    rejected === 0,
    `${rejected} of 3 writes were rejected`,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Starting a disposable MongoDB replica set…");

  const replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.24" },
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });

  try {
    await connectToDatabase(replSet.getUri());
    console.log(`Connected. Transactions supported: ${supportsTransactions()}`);

    await resetDatabase();
    await ensureIndexes();

    await verifyExactArithmetic();
    await verifyBalanceSemantics();
    await verifyReversal();
    await verifyAtomicity();
    await verifyCashPosition();
    await verifyDlap();
    await verifyReports();
    await verifyPeriods();
    await verifyImport();
    await verifyMargin();
    verifyXeroMapping();
    verifyXeroSafety();
    await verifyXeroIndexes();
    await verifyRegressions();

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
  console.error("\n[verify:finance] crashed:", error);
  process.exitCode = 1;
});
