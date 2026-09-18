import { createServer, type IncomingMessage } from "node:http";
import { createHmac, createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Proves, against a real HTTP listener, that this system sends ONLY when it is
 * fully configured — and that what it sends is correctly signed.
 *
 * `verify-group-kpis.ts` checks the signer in isolation. This checks the thing
 * that actually matters operationally: that an unconfigured or half-configured
 * deployment opens no connection at all, and that a configured one produces a
 * request the Group platform would accept.
 *
 * It stands up a local stub of `/ingest/v1/operational-readings`, points the
 * feed at it, and counts requests. A connection arriving during a phase that
 * expects silence is a FAIL — that is the regression this file exists to catch,
 * because it is the one that would post unverified figures to a board.
 *
 *   npm run verify:egress --workspace @dokuma/server
 */

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

const KEY_ID = "opk_ABCDEFGHIJKLMNOPQRST";
const SECRET = "local-stub-secret";

interface Received {
  headers: IncomingMessage["headers"];
  rawBody: string;
}

async function main(): Promise<void> {
  // ---- A stub of the Group's ingest endpoint -----------------------------

  const received: Received[] = [];

  const stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, rawBody: raw });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        /**
         * Nested under `data`, exactly as the live platform replies.
         *
         * The stub originally returned a flat receipt, so the parser's failure
         * to unwrap `data` went unnoticed here and only showed up against the
         * real endpoint as `accepted: 0` on a successful send. A stub that is
         * easier to parse than production is a stub that hides bugs.
         */
        JSON.stringify({
          data: {
            batchId: "stub-batch-1",
            status: "ACCEPTED",
            results: [
              { index: 0, outcome: "accepted" },
              { index: 1, outcome: "accepted" },
              { index: 2, outcome: "accepted" },
              { index: 3, outcome: "accepted" },
            ],
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const port = (stub.address() as { port: number }).port;
  const stubUrl = `http://127.0.0.1:${port}`;

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.24" },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });

  process.env["MONGODB_URI"] = replSet.getUri("dokuma_egress");
  process.env["SESSION_SECRET"] ??= "egress-test-secret-at-least-32-chars-long";

  const { connectToDatabase, disconnectFromDatabase } = await import("../db/connection.js");
  await connectToDatabase();

  const { seedGroupKpis } = await import("./seed-group-kpis.js");
  await seedGroupKpis({ days: 2 });

  const { dispatchDailyFeed } = await import("../services/oneplatform/daily-feed.js");
  const { resolveConfig } = await import("../services/oneplatform/config.js");

  const clearEnv = () => {
    delete process.env["OP_INGEST_BASE_URL"];
    delete process.env["OP_INGEST_KEY_ID"];
    delete process.env["OP_INGEST_SECRET"];
    delete process.env["OP_INGEST_MODE"];
  };

  try {
    // ---- Phase 1: nothing configured -----------------------------------
    console.log("\n[1] Unconfigured — must not open a connection");
    clearEnv();

    let result = await dispatchDailyFeed();
    // Either non-sending outcome is correct here: `skipped` when the demo
    // filter already emptied the batch, `validated` when it was the missing
    // configuration that stopped it. What must hold is that no request left.
    check("outcome is a non-sending one", ["validated", "skipped"].includes(result.outcome), result.outcome);
    equal("no HTTP status was recorded", result.httpStatus, null);
    equal("the stub received nothing", received.length, 0);

    // ---- Phase 2: base URL but no key ----------------------------------
    console.log("\n[2] Base URL only, no credentials — still silent");
    process.env["OP_INGEST_BASE_URL"] = stubUrl;

    result = await dispatchDailyFeed();
    check("outcome is a non-sending one", ["validated", "skipped"].includes(result.outcome), result.outcome);
    equal("the stub still received nothing", received.length, 0);

    // ---- Phase 3: fully configured but mode=dry-run --------------------
    console.log("\n[3] Credentials present, mode=dry-run — still silent");
    process.env["OP_INGEST_KEY_ID"] = KEY_ID;
    process.env["OP_INGEST_SECRET"] = SECRET;
    process.env["OP_INGEST_MODE"] = "dry-run";

    equal("config reports dry-run", resolveConfig().mode, "dry-run");
    result = await dispatchDailyFeed();
    check("outcome is a non-sending one", ["validated", "skipped"].includes(result.outcome), result.outcome);
    equal("the stub STILL received nothing", received.length, 0);

    // ---- Phase 4: live, but the caller forces a dry run -----------------
    console.log("\n[4] Live config, explicit dryRun — the override wins");
    process.env["OP_INGEST_MODE"] = "live";
    equal("config reports live", resolveConfig().mode, "live");

    result = await dispatchDailyFeed({ dryRun: true });
    check("outcome is a non-sending one", ["validated", "skipped"].includes(result.outcome), result.outcome);
    equal("the stub received nothing", received.length, 0);

    // ---- Phase 4b: live, but every figure is seeded --------------------
    console.log("\n[4b] Live, but the figures are demo data — must NOT send");

    /**
     * The seed wrote `source: "seed"` on every reading, so a fully live feed
     * must still withhold them. This is the check that stands between the demo
     * generator and a signed batch on the chairman's desk.
     */
    result = await dispatchDailyFeed();
    equal("outcome is skipped, not accepted", result.outcome, "skipped");
    equal("nothing was sent", received.length, 0);
    equal("all four measures were withheld as demo", result.demo.length, 4);
    equal("no documents were built", result.documentsSent, 0);

    // Promote the readings to a real source, as the QA system would.
    const { SbuKpiReading: Readings } = await import("../db/models/sbu-kpi.js");
    await Readings.updateMany({ sbuCode: "DOKUMA" }, { $set: { source: "qa" } });

    // ---- Phase 5: live — now, and only now, it sends -------------------
    console.log("\n[5] Live with real figures — sends one correctly signed request");

    result = await dispatchDailyFeed();
    equal("the stub received exactly one request", received.length, 1);
    equal("outcome is accepted", result.outcome, "accepted");
    equal("HTTP 200 was recorded", result.httpStatus, 200);
    equal("the receipt's batch id was captured", result.batchId, "stub-batch-1");
    // The stub nests its receipt under `data`, exactly as the real platform
    // does. Reading only the top level yielded 0 accepted on a successful
    // send — a working feed that logged like a broken one.
    equal("accepted documents were counted from the nested receipt", result.documentsAccepted, 4);
    equal("no documents were counted as rejected", result.documentsRejected, 0);

    const sent = received[0]!;

    // ---- The signature the Group would verify --------------------------
    console.log("\n[6] The request the Group would receive");

    const keyIdHeader = sent.headers["x-op-key-id"] as string;
    const timestamp = sent.headers["x-op-timestamp"] as string;
    const nonce = sent.headers["x-op-nonce"] as string;
    const signature = sent.headers["x-op-signature"] as string;

    equal("x-op-key-id is our key", keyIdHeader, KEY_ID);
    check("x-op-timestamp is 10 epoch digits", /^\d{10}$/.test(timestamp), timestamp);
    check("x-op-nonce is 16-64 url-safe chars", /^[A-Za-z0-9_-]{16,64}$/.test(nonce), nonce);
    check("x-op-signature has the v1= prefix and 64 hex", /^v1=[0-9a-f]{64}$/.test(signature));

    // Recompute the MAC exactly as the far end would, from the bytes that
    // actually arrived. This is the assertion that proves the body was not
    // re-serialised after signing — the specification's "single most common bug".
    const bodyHash = createHash("sha256").update(sent.rawBody, "utf8").digest("hex");
    const canonical = [
      "OP-HMAC-SHA256-V1",
      "POST",
      "/ingest/v1/operational-readings",
      timestamp,
      nonce,
      bodyHash,
    ].join("\n");
    const expected = "v1=" + createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");

    check(
      "the signature verifies against the RECEIVED bytes",
      signature === expected,
      "the body was altered after signing",
    );

    // ---- The payload ----------------------------------------------------
    const payload = JSON.parse(sent.rawBody) as {
      sbuCode: string;
      atomic: boolean;
      clientBatchRef: string;
      documents: { measureCode: string; value: unknown; status: string; sourceUpdatedAt: string }[];
    };

    equal("sbuCode is DOKUMA", payload.sbuCode, "DOKUMA");
    equal("atomic is false, per §2", payload.atomic, false);
    equal("four documents were sent", payload.documents.length, 4);
    check(
      "every value is a JSON string, never a number",
      payload.documents.every((d) => typeof d.value === "string"),
    );
    check(
      "every document is POSTED",
      payload.documents.every((d) => d.status === "POSTED"),
    );
    check(
      "every sourceUpdatedAt carries an offset",
      payload.documents.every((d) => /([Zz]|[+-]\d{2}:\d{2})$/.test(d.sourceUpdatedAt)),
    );
    check(
      "content-type is application/json",
      String(sent.headers["content-type"]).includes("application/json"),
    );
    check("the secret never appears in the request", !sent.rawBody.includes(SECRET));

    // ---- Phase 7: readings are marked as reported ----------------------
    console.log("\n[7] After a successful send");

    const { SbuKpiReading, SbuKpiDispatch } = await import("../db/models/sbu-kpi.js");

    // The readings just sent must no longer be pending — otherwise the next
    // run would resend them, and the dashboard would keep claiming the day's
    // figures are still owed upstream.
    const sentPeriod = (payload.documents[0] as unknown as { readingDate: string }).readingDate;
    const stillPending = await SbuKpiReading.countDocuments({
      period: sentPeriod,
      syncState: "pending",
      measureCode: { $in: payload.documents.map((d) => d.measureCode) },
    });
    equal("the sent readings are no longer pending", stillPending, 0);

    const nowSent = await SbuKpiReading.countDocuments({ period: sentPeriod, syncState: "sent" });
    equal("all four are marked sent", nowSent, 4);

    const dispatches = await SbuKpiDispatch.countDocuments({});
    check("every attempt was logged, including the silent ones", dispatches >= 5, `got ${dispatches}`);

    const logged = await SbuKpiDispatch.findOne({ clientBatchRef: result.clientBatchRef }).lean();
    equal("the accepted dispatch was logged", logged?.outcome, "accepted");
    check("the dispatch log holds no secret", !JSON.stringify(logged ?? {}).includes(SECRET));
  } finally {
    clearEnv();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await disconnectFromDatabase().catch(() => undefined);
    await replSet.stop().catch(() => undefined);
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("verify-feed-egress crashed:", error);
  process.exitCode = 1;
});
