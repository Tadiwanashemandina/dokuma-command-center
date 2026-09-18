import { DAILY_MEASURES, EXCEPTION_MEASURES, SBU_KPI_MEASURES, type UserRole } from "@dokuma/shared";

/**
 * HTTP-level tests for /api/group-kpis.
 *
 * Kept in its own module so the Group reporting surface can be extended without
 * touching the main `api-tests.ts` harness. It receives the harness's own
 * `check`/`equal`/`signIn` helpers rather than importing them, so there is one
 * counter and one client implementation.
 *
 * What this covers, and why each matters:
 *   - the role gate (exec reads, finance writes, employee is refused);
 *   - that a spine measure cannot be captured by hand, which is the rule
 *     preventing two divergent sources of truth for revenue;
 *   - that a float value is rejected, which is what protects DATA_ACCURACY;
 *   - that the feed refuses to send when unconfigured — failing closed.
 */

interface TestClient {
  get(path: string): Promise<{ status: number; body: Record<string, unknown> }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
}

export interface GroupKpiTestDeps {
  baseUrl: string;
  check: (label: string, ok: boolean, detail?: string) => void;
  equal: (label: string, actual: unknown, expected: unknown) => void;
  signIn: (baseUrl: string, role: UserRole) => Promise<TestClient>;
  anonClient: (baseUrl: string) => TestClient;
  data: (response: { body: Record<string, unknown> }) => Record<string, unknown>;
}

export async function testGroupKpis(deps: GroupKpiTestDeps): Promise<void> {
  const { baseUrl, check, equal, signIn, anonClient, data } = deps;

  console.log("\n[11] Group KPI register — /api/group-kpis");

  // ---- Authentication and role gates -------------------------------------

  const anon = anonClient(baseUrl);
  equal("unauthenticated overview → 401", (await anon.get("/api/group-kpis/overview")).status, 401);
  equal("unauthenticated readings → 401", (await anon.get("/api/group-kpis/readings")).status, 401);

  const employee = await signIn(baseUrl, "employee");
  equal(
    "an employee may not read group reporting → 403",
    (await employee.get("/api/group-kpis/overview")).status,
    403,
  );

  const admin = await signIn(baseUrl, "admin");

  // ---- The register itself ------------------------------------------------

  const register = await admin.get("/api/group-kpis/register");
  equal("admin GET /register → 200", register.status, 200);
  const counts = data(register)["counts"] as Record<string, number>;
  equal("the served register has 59 measures", counts["total"], SBU_KPI_MEASURES.length);
  equal("45 bespoke", counts["bespoke"], 45);
  equal("14 spine", counts["spine"], 14);
  equal("5 exceptions", counts["exceptions"], EXCEPTION_MEASURES.length);
  equal("4 daily", counts["daily"], DAILY_MEASURES.length);

  // ---- Overview -----------------------------------------------------------

  const overview = await admin.get("/api/group-kpis/overview");
  equal("admin GET /overview → 200", overview.status, 200);
  const o = data(overview);
  equal("the overview is for DOKUMA", o["sbuCode"], "DOKUMA");

  const exceptions = o["exceptions"] as Record<string, unknown>[];
  equal("the overview carries exactly 5 exception measures", exceptions.length, 5);
  check(
    "every exception row carries its measure definition",
    exceptions.every((e) => typeof (e["measure"] as Record<string, unknown>)?.["code"] === "string"),
  );

  // The seeded DATA_ACCURACY for today sits above 99.95, so the tile is green
  // AND the target evaluation actually ran — a null here would mean the
  // comparison silently did nothing.
  const accuracy = exceptions.find(
    (e) => (e["measure"] as Record<string, unknown>)["code"] === "DATA_ACCURACY",
  );
  check("DATA_ACCURACY is present in the exceptions", accuracy !== undefined);
  check(
    "DATA_ACCURACY has been evaluated against its target",
    accuracy?.["onTarget"] === true || accuracy?.["onTarget"] === false,
    `got ${String(accuracy?.["onTarget"])}`,
  );

  const feed = o["feed"] as Record<string, unknown>;
  equal("the feed is disabled without credentials", feed["mode"], "disabled");
  check("the feed never returns a secret", !JSON.stringify(feed).toLowerCase().includes("secret"));
  const health = feed["health"] as Record<string, unknown>;
  check("feed health reports today as stale when nothing has been sent", health["staleToday"] === true);

  // ---- Readings -----------------------------------------------------------

  const readings = await admin.get("/api/group-kpis/readings");
  equal("admin GET /readings → 200", readings.status, 200);
  const rows = data(readings)["readings"] as Record<string, unknown>[];
  equal("every measure is returned, captured or not", rows.length, SBU_KPI_MEASURES.length);

  check(
    "spine measures are marked not-applicable rather than pending",
    rows
      .filter((r) => (r["measure"] as Record<string, unknown>)["route"] === "derived")
      .every((r) => r["syncState"] === "not-applicable"),
  );

  check(
    "values are decimal strings, never JSON numbers",
    rows.every((r) => r["value"] === null || typeof r["value"] === "string"),
  );

  // ---- Capture ------------------------------------------------------------

  console.log("\n[12] Group KPI capture");

  equal(
    "an employee may not capture → 403",
    (await employee.post("/api/group-kpis/readings", { readings: [] })).status,
    403,
  );

  // Finance may write even though it may not read the board view — §9 describes
  // these as typed in by finance and operations staff.
  const finance = await signIn(baseUrl, "finance_officer");
  const financeWrite = await finance.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "SECURITY_INCIDENTS", period: "2026-08", value: "2" }],
  });
  equal("a finance officer may capture → 200", financeWrite.status, 200);

  const saved = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "GOVT_COLLECTION_DAYS", period: "2026-08", value: "91" }],
  });
  equal("admin capture → 200", saved.status, 200);
  const savedResults = data(saved)["results"] as Record<string, unknown>[];
  equal("the figure was saved", savedResults[0]?.["outcome"], "saved");

  // An identical resend is a no-op, matching the ingest API's `duplicate`.
  const resent = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "GOVT_COLLECTION_DAYS", period: "2026-08", value: "91" }],
  });
  equal(
    "an identical resend is unchanged, not a new write",
    (data(resent)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "unchanged",
  );

  // ---- The rules that protect the figures ---------------------------------

  const spine = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "REVENUE", period: "2026-08", value: "100000.00" }],
  });
  equal(
    "a spine measure cannot be captured by hand",
    (data(spine)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "rejected",
  );

  const unknown = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "NOT_A_MEASURE", period: "2026-08", value: "1" }],
  });
  equal(
    "an unregistered code is rejected as MEASURE_NOT_RECOGNISED",
    (data(unknown)["results"] as Record<string, unknown>[])[0]?.["error"],
    "MEASURE_NOT_RECOGNISED",
  );

  // A JSON number must never be accepted: 99.95 is not exactly representable as
  // a float64, and this is the endpoint DATA_ACCURACY is captured through.
  const asNumber = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "SECURITY_INCIDENTS", period: "2026-08", value: 2 }],
  });
  equal("a JSON number value → 400", asNumber.status, 400);

  const tooPrecise = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "DATA_ACCURACY", period: "2026-08-01", value: "99.999999" }],
  });
  equal("more than 4 decimal places → 400", tooPrecise.status, 400);

  // A DAILY measure captured against a month has nowhere to go upstream.
  const wrongPeriod = await admin.post("/api/group-kpis/readings", {
    readings: [{ measureCode: "DATA_ACCURACY", period: "2026-08", value: "99.9600" }],
  });
  equal(
    "a DAILY measure rejects a month period",
    (data(wrongPeriod)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "rejected",
  );

  // One bad document must not discard the good ones (atomic: false).
  const mixed = await admin.post("/api/group-kpis/readings", {
    readings: [
      { measureCode: "CASH_RUNWAY", period: "2026-08", value: "11" },
      { measureCode: "REVENUE", period: "2026-08", value: "1.00" },
    ],
  });
  const mixedResults = data(mixed)["results"] as Record<string, unknown>[];
  equal("a partial batch returns 207", mixed.status, 207);
  equal("the valid document still saved", mixedResults[0]?.["outcome"], "saved");
  equal("the invalid document was rejected", mixedResults[1]?.["outcome"], "rejected");

  // ---- The feed fails closed ----------------------------------------------

  console.log("\n[13] Group feed dispatch");

  const preview = await admin.get("/api/group-kpis/feed/preview");
  equal("admin GET /feed/preview → 200", preview.status, 200);
  const built = data(preview);
  const batch = built["batch"] as Record<string, unknown>;
  equal("the batch is for DOKUMA", batch["sbuCode"], "DOKUMA");
  check("the batch is non-atomic, per §2", batch["atomic"] === false);
  check(
    "the batch carries only DAILY measures",
    (batch["documents"] as Record<string, unknown>[]).every((d) =>
      DAILY_MEASURES.some((m) => m.code === d["measureCode"]),
    ),
  );
  check(
    "every document value is a decimal string",
    (batch["documents"] as Record<string, unknown>[]).every((d) => typeof d["value"] === "string"),
  );

  equal(
    "a finance officer may not dispatch the feed → 403",
    (await finance.post("/api/group-kpis/feed/dispatch")).status,
    403,
  );

  // With no credentials configured, a dispatch must build and log without
  // sending. `validated` — not `accepted` — is the honest outcome.
  const dispatch = await admin.post("/api/group-kpis/feed/dispatch");
  equal("admin POST /feed/dispatch → 200", dispatch.status, 200);
  const result = data(dispatch);
  check(
    "an unconfigured feed validates rather than sends",
    result["outcome"] === "validated" || result["outcome"] === "skipped",
    `got ${String(result["outcome"])}`,
  );
  equal("nothing was sent over the network", result["httpStatus"], null);

  // ---- The QA system's inbound endpoint -----------------------------------

  console.log("\n[14] QA ingest — /api/qa-ingest");

  const QA_KEY = "qa-test-key-that-is-at-least-32-chars-long";

  // Unconfigured, the endpoint must refuse rather than accept anonymously.
  delete process.env["QA_INGEST_KEY"];
  const unconfigured = await anon.post("/api/qa-ingest/daily-readings", { readings: [] });
  equal("unconfigured QA ingest → 503, not open", unconfigured.status, 503);

  process.env["QA_INGEST_KEY"] = QA_KEY;

  equal(
    "no bearer key → 401",
    (await anon.post("/api/qa-ingest/daily-readings", {
      readings: [{ measureCode: "DATA_ACCURACY", readingDate: "2020-06-15", value: "99.9700" }],
    })).status,
    401,
  );

  // A keyed client. The harness Client sends no Authorization header, so the
  // raw fetch is used for the authenticated cases.
  const qaPost = async (payload: unknown, key = QA_KEY) => {
    const response = await fetch(`${baseUrl}/api/qa-ingest/daily-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  equal("a wrong key → 401", (await qaPost({ readings: [] }, "wrong-key-of-sufficient-length-here")).status, 401);

  /**
   * Note the explicit `sourceUpdatedAt`.
   *
   * Omitting it defaults to NOW, which then makes any later send carrying a
   * genuine (older) source timestamp lose the staleness comparison. That is
   * correct behaviour but a real operational trap: a QA system that omits the
   * field on its first send and supplies it afterwards would see every
   * subsequent figure silently refused as stale. Documented in
   * GROUP-REPORTING.md; asserted here so the ordering rule stays tested.
   */
  const accepted = await qaPost({
    clientBatchRef: "qa-test-1",
    readings: [
      {
        measureCode: "DATA_ACCURACY",
        readingDate: "2020-06-15",
        value: "99.9700",
        sourceUpdatedAt: "2020-06-15T06:00:00+02:00",
      },
      {
        measureCode: "SYSTEM_UPTIME",
        readingDate: "2020-06-15",
        value: "99.8200",
        sourceUpdatedAt: "2020-06-15T06:00:00+02:00",
      },
    ],
  });
  equal("a valid QA batch → 200", accepted.status, 200);
  const qaResults = data(accepted)["results"] as Record<string, unknown>[];
  equal("the first reading was accepted", qaResults[0]?.["outcome"], "accepted");
  equal("the batch ref is echoed", data(accepted)["clientBatchRef"], "qa-test-1");

  // Idempotence: the same value again is a no-op, not a duplicate row.
  const repeat = await qaPost({
    readings: [
      {
        measureCode: "DATA_ACCURACY",
        readingDate: "2020-06-15",
        value: "99.9700",
        sourceUpdatedAt: "2020-06-15T06:00:00+02:00",
      },
    ],
  });
  equal(
    "an identical resend is a duplicate no-op",
    (data(repeat)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "duplicate",
  );

  const changed = await qaPost({
    readings: [
      {
        measureCode: "DATA_ACCURACY",
        readingDate: "2020-06-15",
        value: "99.9800",
        sourceUpdatedAt: "2020-06-16T06:00:00+02:00",
      },
    ],
  });
  equal(
    "a changed value replaces it",
    (data(changed)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "replaced",
  );

  // An out-of-order resend must not overwrite a newer figure with an older one.
  const stale = await qaPost({
    readings: [
      {
        measureCode: "DATA_ACCURACY",
        readingDate: "2020-06-15",
        value: "99.1000",
        sourceUpdatedAt: "2020-06-14T06:00:00+02:00",
      },
    ],
  });
  equal(
    "an older sourceUpdatedAt is refused as stale",
    (data(stale)["results"] as Record<string, unknown>[])[0]?.["outcome"],
    "stale",
  );

  // A MONTHLY measure has no business on the daily feed.
  equal(
    "a non-DAILY measure → 400",
    (await qaPost({
      readings: [{ measureCode: "SECURITY_INCIDENTS", readingDate: "2020-06-15", value: "1" }],
    })).status,
    400,
  );

  equal(
    "a JSON number value → 400",
    (await qaPost({
      readings: [{ measureCode: "DATA_ACCURACY", readingDate: "2020-06-15", value: 99.97 }],
    })).status,
    400,
  );

  const whoami = await fetch(`${baseUrl}/api/qa-ingest/whoami`, {
    headers: { Authorization: `Bearer ${QA_KEY}` },
  });
  equal("GET /whoami with a valid key → 200", whoami.status, 200);

  delete process.env["QA_INGEST_KEY"];
}
