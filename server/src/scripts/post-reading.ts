// Loads .env.local then .env — see load-env.ts for why plain dotenv is wrong here.
import "./load-env.js";
import { randomUUID } from "node:crypto";
import { findMeasure, isDecimalString, isDateOnly, formatTarget, meetsTarget } from "@dokuma/shared";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { SbuKpiReading } from "../db/models/sbu-kpi.js";
import { resolveConfig, operationalReadingsPath } from "../services/oneplatform/config.js";
import { signRequest } from "../services/oneplatform/signing.js";
import { currentDate, formatDateOnly } from "../db/types.js";

/**
 * Captures ONE daily measure and posts it to the Group platform.
 *
 * A deliberately narrow tool, separate from the nightly cron: it sends exactly
 * one figure that a person has just typed and can vouch for. That is what makes
 * it the right instrument for a first end-to-end test — the smallest possible
 * footprint on the board's data, with a named human behind the number.
 *
 * The value is stored as `source: "manual"`, so it is a real reading: the feed
 * will send it, unlike anything the demo seed wrote.
 *
 *   npm run post:reading --workspace @dokuma/server -- SYSTEM_UPTIME 99.8200
 *   npm run post:reading --workspace @dokuma/server -- SYSTEM_UPTIME 99.8200 --date 2026-09-17
 *   npm run post:reading --workspace @dokuma/server -- SYSTEM_UPTIME 99.8200 --confirm
 *
 * Without `--confirm` it captures, builds and signs, prints everything, and
 * stops before sending. Nothing reaches the Group until the flag is present.
 */

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const code = args[0];
  const value = args[1];
  const confirm = args.includes("--confirm");
  /**
   * `--date YYYY-MM-DD`, optional.
   *
   * The index is checked against -1 explicitly. `args[indexOf(...) + 1]` looks
   * like it reads the following argument, but when the flag is ABSENT indexOf
   * returns -1 and the expression becomes `args[0]` — silently treating the
   * measure code as the date.
   */
  const dateFlag = args.indexOf("--date");
  const dateArg = dateFlag === -1 ? undefined : args[dateFlag + 1];

  if (dateFlag !== -1 && !dateArg) fail("--date was given without a value.");

  if (!code || !value) {
    fail("Usage: post:reading -- <MEASURE_CODE> <value> [--date YYYY-MM-DD] [--confirm]");
  }

  const measure = findMeasure(code);
  if (!measure) fail(`'${code}' is not in the register.`);

  if (measure.route !== "operational-readings") {
    fail(
      `${measure.code} is a ${measure.frequency} measure routed via '${measure.route}'. ` +
        "This tool posts only the four DAILY measures.",
    );
  }

  if (!isDecimalString(value)) {
    fail(
      `'${value}' is not a valid decimal string (up to 4 decimal places, no commas). ` +
        "Note it must be a STRING — 99.95 is not exactly representable as a float.",
    );
  }

  const period = dateArg ?? formatDateOnly(currentDate());
  if (!period || !isDateOnly(period)) fail(`'${dateArg}' is not a YYYY-MM-DD date.`);

  const config = resolveConfig();
  if (config.mode === "disabled") fail(`The feed is disabled: ${config.reason}`);
  if (!config.credentials || !config.baseUrl) fail("No credentials configured.");

  // -------------------------------------------------------------------------

  console.log("\nPost a single reading\n");
  console.log(`  measure   : ${measure.code} — ${measure.name}`);
  console.log(`  value     : ${value} (${measure.unit})`);
  console.log(`  date      : ${period}`);

  const target = formatTarget(measure.target);
  if (target) {
    const ok = meetsTarget(measure, value);
    console.log(`  target    : ${target} → ${ok ? "ON target" : "OFF target"}`);
    if (ok === false) {
      // Said plainly rather than buried: an off-target board measure is a
      // visible amber on the chairman's screen, and the person posting it
      // should know that before it lands, not after.
      console.log("              ⚠ This will show as a breach on the Group's exception tile.");
    }
  }

  console.log(`  target url: ${config.baseUrl}${operationalReadingsPath()}`);
  console.log(`  sbu       : ${config.sbuCode}`);

  await connectToDatabase();

  try {
    // ---- 1. Capture it locally, as a genuine manual reading ---------------

    const now = new Date();
    await SbuKpiReading.updateOne(
      { sbuCode: config.sbuCode, measureCode: measure.code, period },
      {
        $set: {
          frequency: measure.frequency,
          value,
          capturedAt: now,
          sourceUpdatedAt: now,
          syncState: "pending",
          // NOT "seed" — this is a real figure a person vouched for, so the
          // feed's demo-data guard lets it through.
          source: "manual",
        },
        $setOnInsert: { _id: randomUUID() },
      },
      { upsert: true },
    );

    console.log("\n  ✓ captured locally as a manual reading");

    // ---- 2. Build the batch ----------------------------------------------

    const batch = {
      sbuCode: config.sbuCode,
      clientBatchRef: `dokuma-single-${period}-${randomUUID().slice(0, 8)}`,
      atomic: false,
      documents: [
        {
          measureCode: measure.code,
          readingDate: period,
          value,
          status: "POSTED" as const,
          sourceUpdatedAt: now.toISOString(),
        },
      ],
    };

    // Serialised ONCE. These exact bytes are hashed, signed and sent.
    const body = JSON.stringify(batch);

    console.log("\n─ Request body ─────────────────────────────────────────────────\n");
    console.log(JSON.stringify(batch, null, 2));

    const signed = signRequest({
      method: "POST",
      path: operationalReadingsPath(),
      body,
      credentials: config.credentials,
    });

    if (!confirm) {
      console.log("\n─────────────────────────────────────────────────────────────────");
      console.log("\n  Not sent. Re-run with --confirm to post this to the Group.\n");
      return;
    }

    // ---- 3. Send ----------------------------------------------------------

    console.log("\n─ Sending ──────────────────────────────────────────────────────\n");
    console.log(`  clientBatchRef: ${batch.clientBatchRef}`);

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(new URL(operationalReadingsPath(), config.baseUrl), {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // A timeout is NOT a failure to deliver — the write may have landed.
      console.error(`\n  ✗ Network error: ${error instanceof Error ? error.message : String(error)}`);
      console.error("\n  DO NOT simply resend. Look the batch up first:");
      console.error(`    GET /ingest/v1/batches?clientBatchRef=${batch.clientBatchRef}\n`);
      process.exitCode = 1;
      return;
    }

    const raw = await response.text();
    console.log(`  HTTP ${response.status} in ${Date.now() - started}ms\n`);

    let receipt: unknown = null;
    try {
      receipt = JSON.parse(raw);
    } catch {
      console.log(`  (non-JSON reply)\n${raw.slice(0, 500)}`);
    }

    console.log(JSON.stringify(receipt, null, 2));

    // 200 = all accepted, 207 = partial, 422 = none accepted.
    if (response.status === 200) {
      await SbuKpiReading.updateOne(
        { sbuCode: config.sbuCode, measureCode: measure.code, period },
        { $set: { syncState: "sent", syncBatchRef: batch.clientBatchRef, syncedAt: new Date() } },
      );
      console.log("\n  ✓ ACCEPTED by the Group platform, and marked as sent locally.\n");
    } else {
      await SbuKpiReading.updateOne(
        { sbuCode: config.sbuCode, measureCode: measure.code, period },
        { $set: { syncState: "failed", syncError: `HTTP ${response.status}` } },
      );
      console.log(`\n  ✗ Not accepted (HTTP ${response.status}). The figure stays pending locally.\n`);
      process.exitCode = 1;
    }
  } finally {
    await disconnectFromDatabase().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("post-reading crashed:", error);
  process.exitCode = 1;
});
