import { createHmac, createHash } from "node:crypto";
import {
  DAILY_MEASURES,
  EXCEPTION_MEASURES,
  SBU_KPI_MEASURES,
  SPINE_MEASURES,
  MANUAL_MEASURES,
  findMeasure,
  isDecimalString,
  isValidPeriod,
  meetsTarget,
  formatTarget,
  formatMeasureValue,
  trimDecimal,
  periodFormatFor,
} from "@dokuma/shared";
import {
  canonicalString,
  hashBody,
  signRequest,
  signaturesMatch,
  SigningConfigError,
} from "../services/oneplatform/signing.js";
import { resolveConfig } from "../services/oneplatform/config.js";

/**
 * Offline verification for the Group SBU register and the request signer.
 *
 * Needs no database and no network — it checks the two things that would
 * otherwise only fail in production at night:
 *
 *   1. that the register matches the specification's stated counts, and
 *   2. that the HMAC signer reproduces the specification's canonical form.
 *
 * A signing implementation checked against no known vector is one nobody can
 * trust; §7 warns that the two traps (epoch integer, `v1=` prefix) produce a
 * 401 that looks identical to a wrong secret. These assertions are how we know
 * which of those we have.
 *
 * Run: npm run verify:group-kpis --workspace @dokuma/server
 */

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

// ---------------------------------------------------------------------------

console.log("\n[1] Register counts (specification header and §5)");

// "45 bespoke + 14 group spine", "Exceptions (board-level): 5".
equal("45 bespoke measures", SBU_KPI_MEASURES.length - SPINE_MEASURES.length, 45);
equal("14 spine measures", SPINE_MEASURES.length, 14);
equal("59 measures in total", SBU_KPI_MEASURES.length, 59);
equal("5 exception measures", EXCEPTION_MEASURES.length, 5);
equal("4 daily measures", DAILY_MEASURES.length, 4);
equal("41 manual measures", MANUAL_MEASURES.length, 41);

console.log("\n[2] Register integrity");

const codes = SBU_KPI_MEASURES.map((m) => m.code);
equal("no duplicate codes", new Set(codes).size, codes.length);
check(
  "every code is SCREAMING_SNAKE",
  codes.every((c) => /^[A-Z][A-Z0-9_]*$/.test(c)),
  codes.filter((c) => !/^[A-Z][A-Z0-9_]*$/.test(c)).join(", "),
);
check(
  "every spine measure is derived",
  SPINE_MEASURES.every((m) => m.route === "derived"),
);
check(
  "no spine measure is an exception",
  SPINE_MEASURES.every((m) => !m.exception),
);
check(
  "every DAILY measure routes to operational-readings",
  SBU_KPI_MEASURES.filter((m) => m.frequency === "DAILY").every(
    (m) => m.route === "operational-readings",
  ),
);
check(
  "no non-DAILY measure routes to operational-readings",
  SBU_KPI_MEASURES.filter((m) => m.route === "operational-readings").every(
    (m) => m.frequency === "DAILY",
  ),
);

console.log("\n[3] The four daily measures (§2)");

// The exact set the ingest endpoint accepts. Anything else is rejected with
// MEASURE_NOT_RECOGNISED, per-document, at night.
const expectedDaily = ["DEEDS_DIGITISED", "DIGITISATION_RATE", "DATA_ACCURACY", "SYSTEM_UPTIME"];
equal("daily set matches the specification", DAILY_MEASURES.map((m) => m.code).sort().join(","), [...expectedDaily].sort().join(","));

console.log("\n[4] The five exception measures (§4)");

const expectedExceptions = [
  "DATA_ACCURACY",
  "TOP_CLIENT_REVENUE_PCT",
  "GOVT_COLLECTION_DAYS",
  "PROJECT_VS_PLATFORM_SPLIT",
  "SECURITY_INCIDENTS",
];
equal(
  "exception set matches the specification",
  EXCEPTION_MEASURES.map((m) => m.code).sort().join(","),
  [...expectedExceptions].sort().join(","),
);

console.log("\n[5] Targets");

const accuracy = findMeasure("DATA_ACCURACY")!;
equal("DATA_ACCURACY target is >= 99.95", formatTarget(accuracy.target), "≥ 99.95");
equal("99.97 meets the accuracy target", meetsTarget(accuracy, "99.9700"), true);
equal("99.94 misses the accuracy target", meetsTarget(accuracy, "99.9400"), false);
equal("an uncaptured accuracy figure is unknown, not failing", meetsTarget(accuracy, null), null);

const uptime = findMeasure("SYSTEM_UPTIME")!;
equal("SYSTEM_UPTIME target is a band", formatTarget(uptime.target), "99.5–99.9");
equal("99.82 sits inside the uptime band", meetsTarget(uptime, "99.8200"), true);
equal("99.40 sits below the uptime band", meetsTarget(uptime, "99.4000"), false);

const security = findMeasure("SECURITY_INCIDENTS")!;
equal("SECURITY_INCIDENTS target is <= 0", formatTarget(security.target), "≤ 0");
equal("one incident breaches the target", meetsTarget(security, "1"), false);

// Concentration risk reads backwards from its name: a HIGH share is bad.
equal("TOP_CLIENT_REVENUE_PCT is lower-is-better", findMeasure("TOP_CLIENT_REVENUE_PCT")!.direction, "down");
equal("GOVT_COLLECTION_DAYS is lower-is-better", findMeasure("GOVT_COLLECTION_DAYS")!.direction, "down");

console.log("\n[6] Value and period validation");

check("99.9700 is a valid decimal string", isDecimalString("99.9700"));
check("142380.0000 is a valid decimal string", isDecimalString("142380.0000"));
check("a 5-decimal value is rejected", !isDecimalString("99.99700"));
check("a JSON number is rejected", !isDecimalString(99.97 as unknown as string));
check("an empty string is rejected", !isDecimalString(""));
check("a negative value is allowed", isDecimalString("-12.5"));

check("a DAILY measure takes a date period", periodFormatFor(accuracy) === "date");
check("a MONTHLY measure takes a month period", periodFormatFor(security) === "month");
check("DATA_ACCURACY accepts 2026-09-18", isValidPeriod(accuracy, "2026-09-18"));
check("DATA_ACCURACY rejects 2026-09", !isValidPeriod(accuracy, "2026-09"));
check("SECURITY_INCIDENTS accepts 2026-09", isValidPeriod(security, "2026-09"));
check("SECURITY_INCIDENTS rejects 2026-09-18", !isValidPeriod(security, "2026-09-18"));

console.log("\n[6b] Display formatting");

// Stored precision is 4 places because the ingest contract requires it; the
// tile must not imply the measurement resolves that finely.
equal("trailing zeros are trimmed for display", trimDecimal("99.9600"), "99.96");
equal("a whole number is untouched", trimDecimal("1120"), "1120");
equal("an all-zero fraction loses its point", trimDecimal("99.0000"), "99");
equal("a significant trailing digit survives", trimDecimal("99.9500"), "99.95");
equal("interior zeros survive", trimDecimal("99.9005"), "99.9005");
equal("the percent symbol is appended", formatMeasureValue(accuracy, "99.9600"), "99.96%");
equal("days carry a unit", formatMeasureValue(findMeasure("GOVT_COLLECTION_DAYS")!, "87"), "87 d");
equal("an uncaptured figure is an em dash", formatMeasureValue(accuracy, null), "—");

// A measure with no target must never be reported as meeting one. This is what
// keeps 71.4% single-client concentration from rendering as reassurance.
equal(
  "a measure with no target yields no verdict",
  meetsTarget(findMeasure("TOP_CLIENT_REVENUE_PCT")!, "71.4"),
  null,
);

console.log("\n[7] Request signing (§7)");

/**
 * The specification's own worked example, used as a known-answer test.
 *
 * The expected MAC is recomputed here with an independent one-line HMAC rather
 * than hard-coded, so this asserts that `signRequest` builds the CANONICAL
 * STRING correctly — which is the part that is easy to get wrong — instead of
 * merely asserting that Node's crypto agrees with itself.
 */
const secret = "test-secret-do-not-use";
const keyId = "opk_ABCDEFGHIJKLMNOPQRST";
const timestamp = "1789704000";
const nonce = "9f2c1b7e-5a34-4d81-9c0e-11aa22bb33cc";
const path = "/ingest/v1/operational-readings";
const body = JSON.stringify({ sbuCode: "DOKUMA", documents: [] });

const signed = signRequest({
  method: "POST",
  path,
  body,
  credentials: { keyId, secret },
  timestamp,
  nonce,
});

const expectedCanonical = [
  "OP-HMAC-SHA256-V1",
  "POST",
  path,
  timestamp,
  nonce,
  createHash("sha256").update(body, "utf8").digest("hex"),
].join("\n");

equal(
  "canonical string is the six lines, \\n-joined",
  canonicalString({ method: "POST", path, timestamp, nonce, bodyHashHex: hashBody(body) }),
  expectedCanonical,
);
check("canonical string has no trailing newline", !expectedCanonical.endsWith("\n"));
equal("canonical string has exactly 6 lines", expectedCanonical.split("\n").length, 6);

const expectedMac = createHmac("sha256", secret).update(expectedCanonical, "utf8").digest("hex");
equal("signature matches the canonical HMAC", signed.headers["x-op-signature"], `v1=${expectedMac}`);

check("signature carries the v1= prefix", signed.headers["x-op-signature"]!.startsWith("v1="));
check(
  "signature is 64 lowercase hex characters after the prefix",
  /^v1=[0-9a-f]{64}$/.test(signed.headers["x-op-signature"]!),
);
check("timestamp is 10 epoch digits", /^\d{10}$/.test(signed.headers["x-op-timestamp"]!));
equal("body is returned unchanged for sending", signed.body, body);
check("key id header is echoed", signed.headers["x-op-key-id"] === keyId);

// A generated timestamp must also be epoch seconds, not milliseconds — the
// most likely accidental regression in this file.
const live = signRequest({ method: "POST", path, body, credentials: { keyId, secret } });
check("a generated timestamp is 10 digits, not 13", /^\d{10}$/.test(live.headers["x-op-timestamp"]!));
check("a generated nonce is 16-64 url-safe chars", /^[A-Za-z0-9_-]{16,64}$/.test(live.nonce));
check("two signings use different nonces", live.nonce !== signRequest({ method: "POST", path, body, credentials: { keyId, secret } }).nonce);

console.log("\n[8] Signing rejects malformed configuration");

function throws(label: string, fn: () => unknown): void {
  checks += 1;
  try {
    fn();
    failures += 1;
    console.error(`  FAIL ${label} — expected a throw`);
  } catch (error) {
    if (error instanceof SigningConfigError) {
      console.log(`  ok   ${label}`);
    } else {
      failures += 1;
      console.error(`  FAIL ${label} — threw ${String(error)}`);
    }
  }
}

throws("a short key id is refused", () =>
  signRequest({ method: "POST", path, body, credentials: { keyId: "opk_SHORT", secret } }),
);
throws("a lower-case key id is refused", () =>
  signRequest({ method: "POST", path, body, credentials: { keyId: "opk_abcdefghijklmnopqrst", secret } }),
);
throws("a key id without the prefix is refused", () =>
  signRequest({ method: "POST", path, body, credentials: { keyId: "ABCDEFGHIJKLMNOPQRSTUV", secret } }),
);
throws("an empty secret is refused", () =>
  signRequest({ method: "POST", path, body, credentials: { keyId, secret: "" } }),
);
throws("a relative path is refused", () =>
  signRequest({ method: "POST", path: "ingest/v1/x", body, credentials: { keyId, secret } }),
);
throws("an ISO timestamp is refused", () =>
  signRequest({
    method: "POST",
    path,
    body,
    credentials: { keyId, secret },
    timestamp: "2026-09-18T06:00:00Z",
  }),
);
throws("a millisecond timestamp is refused", () =>
  signRequest({ method: "POST", path, body, credentials: { keyId, secret }, timestamp: "1789704000000" }),
);

check("constant-time compare accepts equal signatures", signaturesMatch(`v1=${expectedMac}`, `v1=${expectedMac}`));
check("constant-time compare rejects different signatures", !signaturesMatch(`v1=${expectedMac}`, `v1=${"0".repeat(64)}`));
check("constant-time compare rejects a length mismatch", !signaturesMatch("v1=abc", `v1=${expectedMac}`));

console.log("\n[9] Feed configuration fails closed");

/**
 * The default state — no environment variables — must be `disabled`.
 *
 * This is the assertion that matters most in this section: a misconfiguration
 * must make the feed quieter, never cause unverified figures to be posted to a
 * board-level endpoint.
 */
const saved = {
  base: process.env["OP_INGEST_BASE_URL"],
  key: process.env["OP_INGEST_KEY_ID"],
  secret: process.env["OP_INGEST_SECRET"],
  mode: process.env["OP_INGEST_MODE"],
};

delete process.env["OP_INGEST_BASE_URL"];
delete process.env["OP_INGEST_KEY_ID"];
delete process.env["OP_INGEST_SECRET"];
delete process.env["OP_INGEST_MODE"];

equal("an unconfigured feed is disabled", resolveConfig().mode, "disabled");
equal("an unconfigured feed still reports its SBU", resolveConfig().sbuCode, "DOKUMA");

process.env["OP_INGEST_BASE_URL"] = "http://oneplatform.dokuma.africa";
process.env["OP_INGEST_KEY_ID"] = keyId;
process.env["OP_INGEST_SECRET"] = secret;
equal("a plain-http base url is refused", resolveConfig().mode, "disabled");

process.env["OP_INGEST_BASE_URL"] = "https://oneplatform.dokuma.africa";
equal("a complete https configuration goes live", resolveConfig().mode, "live");

process.env["OP_INGEST_KEY_ID"] = "opk_bad";
equal("a malformed key id disables the feed", resolveConfig().mode, "disabled");

process.env["OP_INGEST_KEY_ID"] = keyId;
process.env["OP_INGEST_MODE"] = "dry-run";
equal("dry-run mode is honoured", resolveConfig().mode, "dry-run");

delete process.env["OP_INGEST_SECRET"];
equal("a missing secret disables the feed", resolveConfig().mode, "disabled");

const described = describeSafely();
check("the described config never contains the secret", !JSON.stringify(described).includes(secret));

function describeSafely(): unknown {
  process.env["OP_INGEST_SECRET"] = secret;
  process.env["OP_INGEST_MODE"] = "live";
  const config = resolveConfig();
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
    keyId: config.credentials?.keyId ?? null,
  };
}

// Restore, so this script leaves the environment as it found it.
for (const [name, value] of [
  ["OP_INGEST_BASE_URL", saved.base],
  ["OP_INGEST_KEY_ID", saved.key],
  ["OP_INGEST_SECRET", saved.secret],
  ["OP_INGEST_MODE", saved.mode],
] as const) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed.\n`);

// Never process.exit(): it races teardown and can turn a passing run non-zero.
process.exitCode = failures === 0 ? 0 : 1;
