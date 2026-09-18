// Loads .env.local then .env — see load-env.ts for why plain dotenv is wrong here.
import "./load-env.js";
import { resolveConfig, whoamiPath, operationalReadingsPath } from "../services/oneplatform/config.js";
import { signRequest } from "../services/oneplatform/signing.js";

/**
 * Checks the live connection to the Group platform, step by step.
 *
 * This is the tool to run when going live, and the first thing to run when the
 * feed starts failing. It follows the portal's own quick-start order — verify
 * the key, then look at what the key may send, then confirm the record type the
 * daily feed needs — and translates each documented error code into the action
 * that fixes it.
 *
 * It is READ-ONLY. It calls `/whoami` and `/batches`, both GETs; it never posts
 * a document. Running it cannot change anything on the Group platform.
 *
 *   npm run check:oneplatform --workspace @dokuma/server
 */

const REQUIRED_RECORD_TYPE = "OPERATIONAL_READING";

/** Maps the documented error codes to what to actually do about them. */
const REMEDIES: Record<string, string> = {
  MISSING_AUTH_HEADER: "A signing header is missing or malformed — this is a bug in the client, not your key.",
  TIMESTAMP_OUT_OF_WINDOW:
    "This machine's clock is more than 5 minutes from the server's. Sync it (NTP) and retry.",
  AUTHENTICATION_FAILED:
    "The signature did not match. Most likely OP_INGEST_SECRET is wrong, truncated, or has a stray space/newline.",
  KEY_EXPIRED: "This key was rotated and its grace period ended. Use the new secret from the portal.",
  REPLAY_DETECTED: "A nonce was reused — a client bug. Each request must generate a fresh UUID.",
  IP_NOT_ALLOWED:
    "This key is restricted to certain IPs and this host is not one. Send the egress IP to your administrator.",
  HTTPS_REQUIRED: "The base URL must be https://.",
  SBU_SCOPE_VIOLATION: "OP_INGEST_SBU_CODE does not match the business this key belongs to.",
  RECORD_TYPE_NOT_PERMITTED: `This source may not send ${REQUIRED_RECORD_TYPE}. Ask your administrator to add it, or register a separate source for the Command Centre.`,
  INGEST_NOT_CONFIGURED: "Ingestion is not switched on for this server. Contact the OnePlatform administrator.",
  RATE_LIMITED: "Too many requests. Wait for the Retry-After seconds.",
};

function line(): void {
  console.log("─".repeat(72));
}

async function signedGet(path: string): Promise<{ status: number; json: unknown; raw: string }> {
  const config = resolveConfig();
  if (!config.credentials || !config.baseUrl) {
    throw new Error("not configured");
  }

  // A GET has an empty body; the signer hashes the empty string, which is the
  // documented e3b0c442… digest.
  const signed = signRequest({
    method: "GET",
    path,
    body: "",
    credentials: config.credentials,
  });

  const response = await fetch(new URL(path, config.baseUrl), {
    method: "GET",
    headers: {
      "x-op-key-id": signed.headers["x-op-key-id"]!,
      "x-op-timestamp": signed.headers["x-op-timestamp"]!,
      "x-op-nonce": signed.headers["x-op-nonce"]!,
      "x-op-signature": signed.headers["x-op-signature"]!,
    },
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Left null — a non-JSON reply is itself diagnostic.
  }

  return { status: response.status, json, raw };
}

/** Pulls `error.code` out of a receipt, whatever nesting the platform used. */
function errorCode(json: unknown): string | null {
  const body = json as { error?: { code?: string }; code?: string } | null;
  return body?.error?.code ?? body?.code ?? null;
}

async function main(): Promise<void> {
  console.log("\nOnePlatform connection check\n");
  line();

  // ---- Step 1: local configuration ---------------------------------------

  const config = resolveConfig();

  console.log("[1] Local configuration");
  console.log(`    base URL : ${config.baseUrl ?? "(not set)"}`);
  console.log(`    SBU      : ${config.sbuCode}`);
  console.log(`    key id   : ${config.credentials?.keyId ?? "(not set)"}`);
  console.log(`    mode     : ${config.mode}`);

  if (config.mode === "disabled") {
    console.log(`\n    ✗ The feed is DISABLED: ${config.reason}`);
    console.log("\n    Set these in .env.local (and in Vercel for production):");
    console.log("      OP_INGEST_BASE_URL=https://oneplatform.dokuma.africa");
    console.log("      OP_INGEST_KEY_ID=opk_…");
    console.log("      OP_INGEST_SECRET=…        (shown once at issuance)");
    console.log("      OP_INGEST_MODE=dry-run    (then 'live' once this check passes)\n");
    process.exitCode = 1;
    return;
  }

  console.log("    ✓ configured\n");
  line();

  // ---- Step 2: does the key work? ----------------------------------------

  console.log("[2] Verifying the key — GET /ingest/v1/whoami");

  let whoami: { status: number; json: unknown; raw: string };
  try {
    whoami = await signedGet(whoamiPath());
  } catch (error) {
    console.log(`    ✗ Could not reach the platform: ${error instanceof Error ? error.message : String(error)}`);
    console.log("      Check the base URL, DNS and any outbound firewall.\n");
    process.exitCode = 1;
    return;
  }

  if (whoami.status !== 200) {
    const code = errorCode(whoami.json);
    console.log(`    ✗ HTTP ${whoami.status}${code ? ` — ${code}` : ""}`);
    if (code && REMEDIES[code]) console.log(`\n      ${REMEDIES[code]}`);
    console.log(`\n      Response: ${whoami.raw.slice(0, 400)}\n`);
    process.exitCode = 1;
    return;
  }

  console.log("    ✓ HTTP 200 — the key and signature are accepted\n");

  const info = (whoami.json as { data?: Record<string, unknown> })?.data ?? (whoami.json as Record<string, unknown>);
  console.log("    The platform says this key belongs to:");
  console.log(`    ${JSON.stringify(info, null, 2).split("\n").join("\n    ")}\n`);

  line();

  // ---- Step 3: may this key send operational readings? -------------------

  console.log(`[3] Checking this source may send ${REQUIRED_RECORD_TYPE}`);

  // The field name is not fixed by the docs, so look through the likely ones
  // rather than guessing one and reporting a false negative.
  const record = info as Record<string, unknown>;
  const candidates = [record["recordTypes"], record["permittedRecordTypes"], record["allowedRecordTypes"]];
  const permitted = candidates.find((c): c is string[] => Array.isArray(c)) ?? null;

  if (!permitted) {
    console.log("    ? Could not find a record-type list in the /whoami reply.");
    console.log(`      Check the portal: the source must list ${REQUIRED_RECORD_TYPE}.\n`);
  } else if (permitted.includes(REQUIRED_RECORD_TYPE)) {
    console.log(`    ✓ ${REQUIRED_RECORD_TYPE} is permitted\n`);
  } else {
    console.log(`    ✗ ${REQUIRED_RECORD_TYPE} is NOT permitted for this key.`);
    console.log(`      This key may send: ${permitted.join(", ")}`);
    console.log(`\n      ${REMEDIES["RECORD_TYPE_NOT_PERMITTED"]}`);
    console.log("\n      Until then the daily feed will be refused with 403.\n");
    process.exitCode = 1;
    return;
  }

  line();

  // ---- Step 4: can we read our own batch history? ------------------------

  console.log("[4] Receipt lookup — GET /ingest/v1/batches?clientBatchRef=…");
  console.log("    (the recovery path used after a timeout)");

  const probe = await signedGet(`${"/ingest/v1/batches"}?clientBatchRef=connection-check-probe`);
  if (probe.status === 200) {
    console.log("    ✓ HTTP 200 — recovery lookups work");
    console.log('      An empty "data" array simply means no such batch, which is expected here.\n');
  } else {
    console.log(`    ! HTTP ${probe.status} — lookups may not work; sending is unaffected.\n`);
  }

  line();

  // ---- Summary ------------------------------------------------------------

  console.log("\nReady.\n");
  console.log(`  The feed will POST to ${config.baseUrl}${operationalReadingsPath()}`);

  if (config.mode === "dry-run") {
    console.log("\n  Mode is DRY-RUN, so nothing is sent yet. To see the exact payload:");
    console.log("    npm run feed:preview --workspace @dokuma/server");
    console.log("\n  When you are satisfied, set OP_INGEST_MODE=live.");
  } else {
    console.log("\n  Mode is LIVE. The 04:30 cron will send each day.");
    console.log("  Note: readings whose source is the demo seed are never sent.");
  }
  console.log("");
}

main().catch((error: unknown) => {
  console.error("\ncheck-oneplatform crashed:", error);
  process.exitCode = 1;
});
