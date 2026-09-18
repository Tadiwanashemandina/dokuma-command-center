// Loads .env.local then .env — see load-env.ts for why plain dotenv is wrong here.
import "./load-env.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { buildDailyBatch } from "../services/oneplatform/daily-feed.js";
import { resolveConfig } from "../services/oneplatform/config.js";
import { signRequest } from "../services/oneplatform/signing.js";
import { currentDate, formatDateOnly } from "../db/types.js";

/**
 * Prints exactly what the daily feed would send — without sending it.
 *
 * The local equivalent of the portal's payload checker, and the thing to run
 * before flipping `OP_INGEST_MODE` to `live`. It also prints the signing
 * headers that WOULD be attached, so a signature can be reasoned about without
 * a request ever leaving this machine.
 *
 *   npm run feed:preview --workspace @dokuma/server
 *   npm run feed:preview --workspace @dokuma/server -- 2026-09-17
 */

async function main(): Promise<void> {
  const arg = process.argv[2];
  const readingDate = arg ? new Date(`${arg}T00:00:00Z`) : currentDate();

  if (Number.isNaN(readingDate.getTime())) {
    console.error(`Not a valid date: ${arg}. Expected YYYY-MM-DD.`);
    process.exitCode = 1;
    return;
  }

  const config = resolveConfig();
  await connectToDatabase();

  try {
    const { batch, missing, invalid, demo } = await buildDailyBatch(readingDate, config.sbuCode);

    console.log(`\nDaily feed preview — ${formatDateOnly(readingDate)}\n`);
    console.log(`  mode      : ${config.mode}${config.reason ? ` (${config.reason})` : ""}`);
    console.log(`  target    : ${config.baseUrl ?? "(not set)"}/ingest/v1/operational-readings`);
    console.log(`  documents : ${batch.documents.length}`);

    if (demo.length > 0) {
      // The single most important line in this output. A figure withheld here
      // is one that would otherwise have been signed and attributed to Dokuma.
      console.log(`\n  ⚠ ${demo.length} measure(s) WITHHELD — demo seed data, never sent:`);
      for (const d of demo) console.log(`      ${d.code}  (${d.name})`);
      console.log("\n    These are replaced once the QA system posts to");
      console.log("    POST /api/qa-ingest/daily-readings");
    }

    if (missing.length > 0) {
      console.log(`\n  ⚠ ${missing.length} measure(s) have no figure for this date:`);
      for (const m of missing) console.log(`      ${m.code}  (${m.name})`);
      console.log("\n    These are OMITTED, never sent as zero — a genuine zero and a");
      console.log("    missing figure must not look the same to the board.");
    }

    if (invalid.length > 0) {
      console.log(`\n  ✗ ${invalid.length} stored value(s) would be rejected:`);
      for (const i of invalid) console.log(`      ${i.code} = ${i.value} — ${i.problem}`);
    }

    if (batch.documents.length === 0) {
      console.log("\n  Nothing would be sent for this date.\n");
      return;
    }

    console.log("\n─ The exact bytes that would be signed and sent ─────────────────\n");
    // Serialised ONCE, exactly as the dispatcher does, so what is printed is
    // byte-identical to what would go on the wire.
    const body = JSON.stringify(batch, null, 2);
    console.log(body);

    if (config.credentials) {
      console.log("\n─ The headers that would be attached ───────────────────────────\n");
      // Signed over the compact form, which is what the dispatcher sends.
      const signed = signRequest({
        method: "POST",
        path: "/ingest/v1/operational-readings",
        body: JSON.stringify(batch),
        credentials: config.credentials,
      });
      for (const [name, value] of Object.entries(signed.headers)) {
        console.log(`  ${name}: ${value}`);
      }
      console.log("\n  (The secret itself is never sent — only this signature derived from it.)");
    }

    console.log("");
  } finally {
    await disconnectFromDatabase().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("feed-preview crashed:", error);
  process.exitCode = 1;
});
