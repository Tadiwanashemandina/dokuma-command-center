/**
 * HTTP-level tests for the domain endpoints (Prompt 5's validation).
 *
 * Boots the real Express app against a disposable single-node replica set, so
 * every request goes through the same middleware chain production would use:
 * session cookie, CSRF, `requireAuth`/`requireRole`, zod, the services, the
 * error handler. Nothing is stubbed.
 *
 *   npm run test:api --workspace @dokuma/server
 *
 * Covers, per Prompt 5: happy paths, malformed input, unauthorized access,
 * forbidden roles, missing resources and boundary values.
 */

import type { Server } from "node:http";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { authenticator } from "otplib";
import { createApp } from "../app.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { User } from "../db/models/index.js";
import { hashPassword } from "../services/password.js";
import { seedAll } from "./seed.js";
import { USER_ROLES, type UserRole } from "@dokuma/shared";
import { testGroupKpis } from "./api-tests-group-kpis.js";

const PASSWORD = "DokumaTest123!";

/**
 * TOTP secrets by role, so a second sign-in during the same run can answer the
 * challenge for a factor it already enrolled. Without this, the second call
 * gets `mfaNext: "verify"` and has no secret to generate a code from.
 */
const MFA_SECRETS = new Map<UserRole, string>();

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

/** A cookie-aware client, so each role holds its own session. */
class Client {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private get csrf(): string | undefined {
    return this.cookies.get("dokuma_csrf");
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const cookieHeader = [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    if (this.csrf) headers["X-CSRF-Token"] = this.csrf;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body);
}

function data(response: { body: Record<string, unknown> }): Record<string, unknown> {
  return (response.body["data"] ?? {}) as Record<string, unknown>;
}

/**
 * Signs in, completing the MFA challenge when the role requires one.
 *
 * The four finance/HR roles hold a session that is authenticated but not
 * verified until they clear TOTP, and `requireMfa` refuses every endpoint
 * until they do (§4.4). That is correct — so these tests satisfy the
 * challenge the way a real user would, by enrolling and submitting a live
 * code, rather than by weakening the gate for testing.
 */
async function signIn(baseUrl: string, role: UserRole): Promise<Client> {
  const client = new Client(baseUrl);
  const response = await client.post("/api/auth/login", {
    email: `${role}@dokuma.local`,
    password: PASSWORD,
  });
  if (response.status !== 200) {
    throw new Error(`Could not sign in as ${role}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const mfaNext = data(response)["mfaNext"];
  if (mfaNext === null || mfaNext === undefined) return client;

  if (mfaNext === "enroll") {
    const enroll = await client.post("/api/auth/mfa/enroll");
    if (enroll.status !== 200) {
      throw new Error(`MFA enroll failed for ${role}: ${enroll.status} ${JSON.stringify(enroll.body)}`);
    }

    const secret = data(enroll)["secret"] as string;
    MFA_SECRETS.set(role, secret);

    const verify = await client.post("/api/auth/mfa/enroll/verify", {
      code: authenticator.generate(secret),
    });
    if (verify.status !== 200) {
      throw new Error(`MFA verify failed for ${role}: ${verify.status} ${JSON.stringify(verify.body)}`);
    }
    return client;
  }

  if (mfaNext === "verify") {
    // Already enrolled earlier in this run — answer the challenge with the
    // secret that enrollment handed us.
    const secret = MFA_SECRETS.get(role);
    if (!secret) {
      throw new Error(`${role} needs an MFA challenge but no secret was cached for it.`);
    }

    const challenge = await client.post("/api/auth/mfa/challenge", {
      code: authenticator.generate(secret),
    });
    if (challenge.status !== 200) {
      throw new Error(
        `MFA challenge failed for ${role}: ${challenge.status} ${JSON.stringify(challenge.body)}`,
      );
    }
    return client;
  }

  throw new Error(`Unexpected mfaNext for ${role}: ${String(mfaNext)}`);
}

// ---------------------------------------------------------------------------

async function testUnauthenticated(baseUrl: string): Promise<void> {
  console.log("\n[1] Unauthenticated access is rejected");

  const anon = new Client(baseUrl);

  for (const path of ["/api/projects", "/api/delivery-metrics", "/api/meetings"]) {
    const response = await anon.get(path);
    equal(`GET ${path} without a session → 401`, response.status, 401);
  }

  // A 404 for an unknown id must still require auth — otherwise the endpoint
  // leaks whether a resource exists to anyone who asks.
  const unknown = await anon.get("/api/projects/00000000-0000-4000-8000-000000000000");
  equal("GET /api/projects/:id without a session → 401, not 404", unknown.status, 401);
}

async function testProjects(baseUrl: string): Promise<void> {
  console.log("\n[2] Projects");

  const admin = await signIn(baseUrl, "admin");

  const list = await admin.get("/api/projects");
  equal("GET /api/projects → 200", list.status, 200);

  const body = data(list);
  const items = body["items"] as Record<string, unknown>[];
  equal("the seeded 12 projects are returned", body["total"], 12);
  check("items is an array", Array.isArray(items));

  // The client-name join the Supabase shim silently dropped (inventory §0).
  const withClient = items.find((p) => p["client_name"] !== null);
  check(
    "client_name resolves — the joined select the shim dropped",
    withClient !== undefined,
    "every project came back with a null client_name",
  );

  // Money is a string, never a JSON number (D-12).
  const budget = items[0]?.["budget_usd"];
  check(
    "budget_usd serializes as a string, not a float",
    typeof budget === "string" || budget === null,
    `got ${typeof budget}`,
  );

  // Date-only columns are YYYY-MM-DD, not ISO timestamps.
  const endDate = items.find((p) => p["target_end_date"] !== null)?.["target_end_date"];
  check(
    "target_end_date is YYYY-MM-DD, not an ISO timestamp",
    typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate),
    `got ${String(endDate)}`,
  );

  // Ordering: status ascending, then name — ported from the legacy page's
  // `.order("status", { ascending: true }).order("name", ...)`.
  //
  // Note that "ascending status" is ALPHABETICAL (amber, green, red), not
  // RAG severity (red first). That is what Postgres did too, so the port is
  // faithful; the portfolio table has never actually grouped by severity.
  // Asserted explicitly so a future change to severity ordering is a
  // deliberate decision rather than an accident.
  const statuses = items.map((p) => p["status"] as string);
  const sorted = [...statuses].sort();
  check(
    "ordered by status ascending (alphabetical: amber, green, red)",
    statuses.every((s, i) => s === sorted[i]),
    statuses.join(", "),
  );

  const greens = items.filter((p) => p["status"] === "green").map((p) => p["name"] as string);
  check(
    "and by name within a status",
    greens.every((n, i) => i === 0 || greens[i - 1]!.localeCompare(n) <= 0),
    greens.join(", "),
  );

  // Filtering.
  const red = await admin.get("/api/projects?status=red");
  equal("?status=red returns only the 2 red projects", (data(red)["total"] as number), 2);

  const search = await admin.get("/api/projects?search=Deeds");
  equal("?search= matches on name", (data(search)["total"] as number), 1);

  // Pagination and its bound.
  const paged = await admin.get("/api/projects?limit=5&offset=10");
  const pagedBody = data(paged);
  equal("?limit=5&offset=10 returns the last 2 of 12", (pagedBody["items"] as unknown[]).length, 2);
  equal("total still reports the full count", pagedBody["total"], 12);

  const overLimit = await admin.get("/api/projects?limit=99999");
  equal("a limit above the cap is rejected → 400", overLimit.status, 400);

  const negative = await admin.get("/api/projects?offset=-1");
  equal("a negative offset is rejected → 400", negative.status, 400);

  // Detail.
  const id = items[0]!["id"] as string;
  const detail = await admin.get(`/api/projects/${id}`);
  equal("GET /api/projects/:id → 200", detail.status, 200);

  const detailBody = data(detail);
  check("detail includes milestones", Array.isArray(detailBody["milestones"]));
  check("detail includes tasks", Array.isArray(detailBody["tasks"]));
  check("detail includes risks", Array.isArray(detailBody["risks"]));
  check(
    "tasks are capped at the legacy page's 20",
    (detailBody["tasks"] as unknown[]).length <= 20,
  );

  const missing = await admin.get("/api/projects/00000000-0000-4000-8000-000000000000");
  equal("an unknown id → 404", missing.status, 404);

  const malformed = await admin.get("/api/projects/not-a-uuid");
  equal("a malformed id → 400, not a 500", malformed.status, 400);
}

async function testAnyAuthenticatedRole(baseUrl: string): Promise<void> {
  console.log("\n[3] D-2 — every authenticated role reaches these routes");

  // These four routes had no requireRole() and relied on RLS. D-2 makes the
  // gate explicit: authenticated, any role. `viewer` is the weakest role, so
  // it is the one that proves the gate is not accidentally role-restricted.
  const viewer = await signIn(baseUrl, "viewer");

  for (const path of ["/api/projects", "/api/delivery-metrics", "/api/meetings"]) {
    const response = await viewer.get(path);
    equal(`viewer GET ${path} → 200`, response.status, 200);
  }
}

async function testDelivery(baseUrl: string): Promise<void> {
  console.log("\n[4] Delivery metrics");

  const admin = await signIn(baseUrl, "admin");
  const response = await admin.get("/api/delivery-metrics");
  equal("GET /api/delivery-metrics → 200", response.status, 200);

  const body = data(response);
  const items = body["items"] as Record<string, unknown>[];
  equal("the seeded 21 metric rows (3 repos x 7 days)", body["total"], 21);

  const totals = body["totals"] as Record<string, number>;
  check("totals are computed server-side", totals !== undefined);
  check("commits total is positive", (totals?.["commits"] ?? 0) > 0);

  // The project-name join the shim dropped.
  const named = items.find((m) => m["project_name"] !== null);
  check("project_name resolves", named !== undefined);
}

async function testMeetings(baseUrl: string): Promise<void> {
  console.log("\n[5] Meetings");

  const admin = await signIn(baseUrl, "admin");
  const response = await admin.get("/api/meetings");
  equal("GET /api/meetings → 200", response.status, 200);

  const body = data(response);
  const items = body["items"] as Record<string, unknown>[];
  equal("the seeded 4 meetings", body["total"], 4);

  // The nested `meeting_action_items(*)` join the shim dropped — every meeting
  // renders with no action items in the current working tree.
  const totalItems = items.reduce((sum, m) => sum + (m["action_items"] as unknown[]).length, 0);
  equal("all 8 action items are nested under their meetings", totalItems, 8);

  check(
    "attendees is an array of names",
    Array.isArray(items[0]?.["attendees"]) && (items[0]!["attendees"] as unknown[]).length > 0,
  );

  // Newest first.
  const dates = items.map((m) => m["meeting_date"] as string);
  check(
    "ordered newest first",
    dates.every((d, i) => i === 0 || dates[i - 1]! >= d),
    dates.join(", "),
  );
}

/**
 * Department scoping (§4.5, D-5) — the highest-risk rule in the migration.
 *
 * RLS failed closed; a forgotten Mongo filter fails OPEN. These assertions are
 * the merge gate: they prove a finance role cannot see HR or company-wide rows
 * through the API, which is now the only way in.
 */
async function testDepartmentScoping(baseUrl: string): Promise<void> {
  console.log("\n[6] Department scoping — risks and clients (§4.5)");

  const admin = await signIn(baseUrl, "admin");
  const financeOfficer = await signIn(baseUrl, "finance_officer");
  const employee = await signIn(baseUrl, "employee");

  // --- risks ---
  const adminRisks = await admin.get("/api/risks");
  equal("admin GET /api/risks → 200", adminRisks.status, 200);

  const adminBody = data(adminRisks);
  equal("admin sees all 13 seeded items", adminBody["total"], 13);
  equal("admin's scope is null (sees everything)", adminBody["scope"], null);

  const financeRisks = await financeOfficer.get("/api/risks");
  const financeBody = data(financeRisks);
  equal("finance_officer's scope is 'finance'", financeBody["scope"], "finance");

  // The seed tags exactly 4 risk rows 'finance' (migration 0030's backfill).
  equal("finance_officer sees only the 4 finance-tagged items", financeBody["total"], 4);

  const financeItems = financeBody["items"] as Record<string, unknown>[];
  check(
    "every row a finance role sees is tagged finance",
    financeItems.every((r) => r["department"] === "finance"),
    financeItems.map((r) => String(r["department"])).join(", "),
  );
  check(
    "NO untagged (company-wide) rows leak to a scoped role",
    financeItems.every((r) => r["department"] !== null),
  );

  // HR has no tagged rows in the seed. An empty result is CORRECT here
  // (ONBOARDING §7), and is the exact case where a missing filter would
  // instead return everything.
  const hrRisks = await employee.get("/api/risks");
  const hrBody = data(hrRisks);
  equal("an hr-scoped role's scope is 'hr'", hrBody["scope"], "hr");
  equal("an hr-scoped role sees 0 items — correct, not broken", hrBody["total"], 0);

  // --- clients ---
  const adminClients = await admin.get("/api/clients");
  equal("admin sees all 4 clients", (data(adminClients)["total"] as number), 4);

  const financeClients = await financeOfficer.get("/api/clients");
  const financeClientBody = data(financeClients);
  equal("finance_officer sees only the 2 finance-tagged clients", financeClientBody["total"], 2);

  const clientItems = financeClientBody["items"] as Record<string, unknown>[];
  check(
    "every client a finance role sees is tagged finance",
    clientItems.every((c) => c["department"] === "finance"),
  );

  // Linked projects are nested per client.
  const withProjects = clientItems.find((c) => (c["projects"] as unknown[]).length > 0);
  check("linked projects are nested under their client", withProjects !== undefined);

  const hrClients = await employee.get("/api/clients");
  equal("an hr-scoped role sees 0 clients", (data(hrClients)["total"] as number), 0);
}

async function testPeople(baseUrl: string): Promise<void> {
  console.log("\n[7] People & delivery — admin/exec only");

  const admin = await signIn(baseUrl, "admin");
  const response = await admin.get("/api/people/activity");
  equal("admin GET /api/people/activity → 200", response.status, 200);

  const body = data(response);
  const summary = body["summary"] as Record<string, unknown>;
  const people = body["people"] as unknown[];

  equal("all 16 seeded people are returned", people.length, 16);
  equal("utilisation is exactly 78.0 (every seeded row is 390/110)", summary["utilisation_pct"], 78);
  equal("the adapter in use is reported", body["source"], "csv");

  // This page DID have a requireRole, unlike the D-2 four — so a non-exec role
  // must be refused rather than shown an empty list.
  for (const role of ["viewer", "finance_manager", "hr_manager", "employee"] as const) {
    const other = await signIn(baseUrl, role);
    const denied = await other.get("/api/people/activity");
    equal(`${role} GET /api/people/activity → 403`, denied.status, 403);
  }

  const exec = await signIn(baseUrl, "exec");
  equal("exec is allowed → 200", (await exec.get("/api/people/activity")).status, 200);
}

async function testKpiFeed(baseUrl: string): Promise<void> {
  console.log("\n[8] KPI feed — the frozen Group contract (D-13)");

  const anon = new Client(baseUrl);
  equal("unauthenticated → 401", (await anon.get("/api/kpi-feed")).status, 401);

  const admin = await signIn(baseUrl, "admin");
  const response = await admin.get("/api/kpi-feed");
  equal("GET /api/kpi-feed → 200", response.status, 200);

  // The envelope is `{ data: [...] }` — NOT the internal `{ data: { items } }`
  // page shape. This is the external contract and must not drift.
  const rows = response.body["data"] as Record<string, unknown>[];
  check("the body is { data: [...] }, not a paginated envelope", Array.isArray(rows));
  equal("all 12 contract metrics are present", rows.length, 12);

  const first = rows[0]!;
  const keys = Object.keys(first).sort().join(",");
  equal(
    "each row carries exactly the contract's six columns",
    keys,
    "as_of_date,company,metric_name,unit,updated_at,value",
  );

  equal("company is the hard-coded literal", first["company"], "Dokuma");

  // Ordered by metric_name, matching the legacy `.order("metric_name")`.
  const names = rows.map((r) => r["metric_name"] as string);
  check(
    "ordered alphabetically by metric_name",
    names.every((n, i) => i === 0 || names[i - 1]!.localeCompare(n) <= 0),
    names.join(", "),
  );

  // `value` is a JSON number here — the one place a decimal is not a string,
  // because that is what the consumer already receives.
  const counts = rows.filter((r) => r["unit"] === "count");
  check(
    "value is a JSON number, as the existing consumer expects",
    counts.every((r) => typeof r["value"] === "number"),
  );

  const utilisation = rows.find((r) => r["metric_name"] === "team_utilisation_pct");
  equal("team_utilisation_pct is 78 in the feed", utilisation?.["value"], 78);
}

async function testDashboard(baseUrl: string): Promise<void> {
  console.log("\n[9] CEO dashboard — admin/exec only");

  const anon = new Client(baseUrl);
  equal("unauthenticated → 401", (await anon.get("/api/dashboard/ceo")).status, 401);

  const admin = await signIn(baseUrl, "admin");
  const response = await admin.get("/api/dashboard/ceo");
  equal("admin GET /api/dashboard/ceo → 200", response.status, 200);

  // The exact concept-doc figures, which seed.sql's header says must not drift.
  const k = data(response);
  equal("12 active projects", k["active_projects"], 12);
  equal("7 green", k["projects_green"], 7);
  equal("3 amber", k["projects_amber"], 3);
  equal("2 red", k["projects_red"], 2);
  equal("6 critical blockers", k["critical_blockers"], 6);
  equal("3 high-risk projects", k["high_risk_projects"], 3);
  equal("87 tasks due this week", k["tasks_due_this_week"], 87);
  equal("19 overdue tasks", k["overdue_tasks"], 19);
  equal("USD 4.2m pipeline, as an exact string", k["revenue_pipeline_usd"], "4200000.00");
  equal("USD 2.1m contracted", k["contracted_revenue_usd"], "2100000.00");
  equal("USD 480k receivables", k["outstanding_receivables_usd"], "480000.00");
  equal("78.0% utilisation", k["team_utilisation_pct"], "78.0");

  // The dashboard and the Group feed share one definition (migration 0009).
  const feed = await admin.get("/api/kpi-feed");
  const rows = feed.body["data"] as Record<string, unknown>[];
  const feedBlockers = rows.find((r) => r["metric_name"] === "critical_blockers");
  equal(
    "the feed's critical_blockers matches the dashboard's",
    feedBlockers?.["value"],
    k["critical_blockers"],
  );

  // The brief.
  const brief = await admin.get("/api/dashboard/brief");
  equal("GET /api/dashboard/brief → 200", brief.status, 200);
  const b = data(brief);
  check("the seeded brief is returned", typeof b["headline"] === "string");
  check("brief_date is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(String(b["brief_date"])));

  // Upcoming milestones.
  const milestones = await admin.get("/api/dashboard/upcoming-milestones");
  equal("GET /api/dashboard/upcoming-milestones → 200", milestones.status, 200);
  const items = milestones.body["data"] as Record<string, unknown>[];
  check("at most six are returned", items.length <= 6, `got ${items.length}`);
  check(
    "none of them are already done",
    items.every((m) => m["status"] !== "done"),
  );
  check(
    "each carries its project's name",
    items.every((m) => m["project_name"] !== null),
  );

  // Role gate: this is exec-only, so every other role must be refused.
  for (const role of ["viewer", "finance_manager", "hr_manager", "supervisor"] as const) {
    const other = await signIn(baseUrl, role);
    equal(`${role} → 403`, (await other.get("/api/dashboard/ceo")).status, 403);
  }

  const exec = await signIn(baseUrl, "exec");
  equal("exec is allowed → 200", (await exec.get("/api/dashboard/ceo")).status, 200);
}

/**
 * The MFA flow the four finance/HR roles must clear (§4.4).
 *
 * `signIn()` already exercises enroll+verify for every scoped role above; this
 * pins the behaviors those calls depend on, so a regression names itself
 * rather than surfacing as an unrelated 403 somewhere else.
 */
async function testMfaFlow(baseUrl: string): Promise<void> {
  console.log("\n[10] MFA enrollment and challenge");

  const client = new Client(baseUrl);
  const login = await client.post("/api/auth/login", {
    email: "hr_officer@dokuma.local",
    password: PASSWORD,
  });
  equal("an MFA role logs in successfully", login.status, 200);

  // MFA gating is currently off (MFA_ENABLED === false in shared/src/roles.ts),
  // so the role is neither told to enroll nor blocked from the rest of the API.
  // Enrollment below still works as an opt-in, which keeps the endpoints covered.
  equal("and is not gated while MFA is off", data(login)["mfaNext"], null);
  equal("the session reaches other endpoints immediately", (await client.get("/api/projects")).status, 200);

  const enroll = await client.post("/api/auth/mfa/enroll");
  equal("enroll → 200", enroll.status, 200);
  const secret = data(enroll)["secret"] as string;
  check("a base32 secret is returned for manual entry", /^[A-Z2-7]{16,}$/.test(secret));
  check(
    "a QR code is rendered server-side, so the client ships no QR library",
    String(data(enroll)["qrCodeDataUrl"]).startsWith("data:image/"),
  );

  const wrong = await client.post("/api/auth/mfa/enroll/verify", { code: "000000" });
  check("a wrong code is rejected", wrong.status >= 400);

  const verify = await client.post("/api/auth/mfa/enroll/verify", {
    code: authenticator.generate(secret),
  });
  equal("a correct code completes enrollment → 200", verify.status, 200);

  const codes = data(verify)["recoveryCodes"] as string[];
  equal("ten recovery codes are issued, once", codes?.length, 10);

  // The session is now aal2 and everything opens up.
  equal("the verified session reaches other endpoints", (await client.get("/api/projects")).status, 200);

  // A fresh login is no longer forced to challenge, but the enrolled factor is
  // still accepted by the challenge endpoint.
  const second = new Client(baseUrl);
  const relogin = await second.post("/api/auth/login", {
    email: "hr_officer@dokuma.local",
    password: PASSWORD,
  });
  equal("a later login is not forced to verify while MFA is off", data(relogin)["mfaNext"], null);

  const challenge = await second.post("/api/auth/mfa/challenge", {
    code: authenticator.generate(secret),
  });
  equal("the challenge succeeds → 200", challenge.status, 200);
  equal("and the session works", (await second.get("/api/projects")).status, 200);

  // A recovery code is single-use.
  const third = new Client(baseUrl);
  await third.post("/api/auth/login", { email: "hr_officer@dokuma.local", password: PASSWORD });
  const recovered = await third.post("/api/auth/mfa/recover", { recoveryCode: codes[0] });
  equal("a recovery code satisfies the challenge → 200", recovered.status, 200);

  const fourth = new Client(baseUrl);
  await fourth.post("/api/auth/login", { email: "hr_officer@dokuma.local", password: PASSWORD });
  const reused = await fourth.post("/api/auth/mfa/recover", { recoveryCode: codes[0] });
  check("the same recovery code cannot be reused", reused.status >= 400, `got ${reused.status}`);
}

async function testAdmin(baseUrl: string): Promise<void> {
  console.log("\n[11] User management and audit trail");

  const admin = await signIn(baseUrl, "admin");

  // --- access ---
  const viewer = await signIn(baseUrl, "viewer");
  equal("viewer GET /api/admin/users -> 403", (await viewer.get("/api/admin/users")).status, 403);
  equal("viewer GET /api/admin/audit-log -> 403", (await viewer.get("/api/admin/audit-log")).status, 403);

  // The audit trail is deliberately wider than user management (0013).
  const exec = await signIn(baseUrl, "exec");
  equal("exec CAN read the audit trail -> 200", (await exec.get("/api/admin/audit-log")).status, 200);
  equal("but exec CANNOT manage users -> 403", (await exec.get("/api/admin/users")).status, 403);

  // --- list ---
  const list = await admin.get("/api/admin/users");
  equal("admin GET /api/admin/users -> 200", list.status, 200);
  const users = data(list)["items"] as Record<string, unknown>[];
  check("every seeded role is listed", users.length >= 9, `got ${users.length}`);
  check(
    "no password hash is ever serialized",
    users.every((u) => !("passwordHash" in u) && !("mfa" in u)),
  );

  // --- invite ---
  const invited = await admin.post("/api/admin/users", {
    email: "api-test-invitee@dokuma.local",
    fullName: "API Test Invitee",
    role: "viewer",
  });
  equal("invite -> 201", invited.status, 201);
  const link = data(invited)["setPasswordPath"] as string;
  check("a set-password path is returned", link.startsWith("/set-password?token="));

  const duplicate = await admin.post("/api/admin/users", {
    email: "api-test-invitee@dokuma.local",
    fullName: "Dupe",
    role: "viewer",
  });
  equal("inviting the same email twice -> 409", duplicate.status, 409);

  const invalid = await admin.post("/api/admin/users", {
    email: "not-an-email",
    fullName: "X",
    role: "viewer",
  });
  equal("a malformed email -> 400", invalid.status, 400);

  const badRole = await admin.post("/api/admin/users", {
    email: "another@dokuma.local",
    fullName: "X",
    role: "superuser",
  });
  equal("an unknown role -> 400", badRole.status, 400);

  // --- role change ---
  const target = users.find((u) => u["email"] === "viewer@dokuma.local")!;
  const targetId = target["id"] as string;

  const promoted = await admin.request("PATCH", `/api/admin/users/${targetId}/role`, { role: "employee" });
  equal("role change -> 200", promoted.status, 200);
  equal("the new role is returned", data(promoted)["role"], "employee");

  // Restore, so a re-run starts from the same state.
  await admin.request("PATCH", `/api/admin/users/${targetId}/role`, { role: "viewer" });

  const self = users.find((u) => u["email"] === "admin@dokuma.local")!;
  const selfRole = await admin.request("PATCH", `/api/admin/users/${self["id"]}/role`, {
    role: "viewer",
  });
  equal("an admin cannot change their OWN role -> 409", selfRole.status, 409);

  const selfDisable = await admin.request("PATCH", `/api/admin/users/${self["id"]}/disabled`, {
    disabled: true,
  });
  equal("an admin cannot disable THEMSELVES -> 409", selfDisable.status, 409);

  // --- disable / enable ---
  const disabled = await admin.request("PATCH", `/api/admin/users/${targetId}/disabled`, {
    disabled: true,
  });
  equal("disable -> 200", disabled.status, 200);
  check("disabledAt is set", data(disabled)["disabledAt"] !== null);

  // A disabled account cannot sign in.
  const blocked = new Client(baseUrl);
  const blockedLogin = await blocked.post("/api/auth/login", {
    email: "viewer@dokuma.local",
    password: PASSWORD,
  });
  check("a disabled account cannot sign in", blockedLogin.status >= 400, `got ${blockedLogin.status}`);

  const reenabled = await admin.request("PATCH", `/api/admin/users/${targetId}/disabled`, {
    disabled: false,
  });
  equal("re-enable -> 200", reenabled.status, 200);
  check("disabledAt is cleared", data(reenabled)["disabledAt"] === null);

  // --- audit trail reflects all of it ---
  const auditLog = await admin.get("/api/admin/audit-log?limit=100");
  equal("GET /api/admin/audit-log -> 200", auditLog.status, 200);
  const entries = data(auditLog)["items"] as Record<string, unknown>[];

  const actions = new Set(entries.map((e) => e["action"]));
  check("the invite was audited", actions.has("auth.user.invited"));
  check("the role change was audited", actions.has("admin.user.role_changed"));
  check("the disable was audited", actions.has("admin.user.disabled"));
  check("the re-enable was audited", actions.has("admin.user.enabled"));

  // A role change must record BOTH roles, or a reviewer cannot tell an
  // escalation from a demotion.
  const roleEntry = entries.find((e) => e["action"] === "admin.user.role_changed");
  const meta = (roleEntry?.["metadata"] ?? {}) as Record<string, unknown>;
  check("the role change records both from and to", "from" in meta && "to" in meta, JSON.stringify(meta));

  // The IP that services/audit.ts passes must actually persist — the schema
  // was silently dropping it.
  const withIp = entries.find((e) => e["ip"] !== null);
  check("audit rows capture the source IP", withIp !== undefined);

  check("the actor's email is resolved for display", entries.some((e) => e["actor_email"] !== null));

  const filtered = await admin.get("/api/admin/audit-log?action=admin.user.role_changed");
  const filteredItems = data(filtered)["items"] as Record<string, unknown>[];
  check(
    "filtering by action returns only that action",
    filteredItems.length > 0 && filteredItems.every((e) => e["action"] === "admin.user.role_changed"),
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Starting a disposable replica set…");

  const replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.24" },
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });

  let server: Server | undefined;

  try {
    await connectToDatabase(replSet.getUri());

    // Seed the domain data these endpoints read.
    await seedAll({ quiet: true });

    // Test accounts, one per role. The password is always reset, because a
    // stale hash here fails every assertion for a reason unrelated to the API.
    const passwordHash = await hashPassword(PASSWORD);
    for (const role of USER_ROLES) {
      await User.updateOne(
        { email: `${role}@dokuma.local` },
        {
          $set: { passwordHash, role, fullName: `Test ${role}` },
          $setOnInsert: { email: `${role}@dokuma.local` },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));

    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port assigned.");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await testUnauthenticated(baseUrl);
    await testProjects(baseUrl);
    await testAnyAuthenticatedRole(baseUrl);
    await testDelivery(baseUrl);
    await testMeetings(baseUrl);
    await testDepartmentScoping(baseUrl);
    await testPeople(baseUrl);
    await testKpiFeed(baseUrl);
    await testDashboard(baseUrl);
    await testMfaFlow(baseUrl);
    await testAdmin(baseUrl);

    // The Group reporting surface. Passed the harness's own helpers so there
    // stays one counter and one cookie-aware client implementation.
    await testGroupKpis({
      baseUrl,
      check,
      equal,
      signIn,
      anonClient: (url) => new Client(url),
      data,
    });

    console.log(`\n${passed}/${passed + failed} checks passed.`);
    if (failed > 0) console.log(`${failed} FAILED.`);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await disconnectFromDatabase().catch(() => undefined);
    // `.stop()` can reject on Windows if mongod's files are still locked while
    // it exits. The tests have already finished at this point, so a teardown
    // hiccup must not be reported as a test failure.
    await replSet.stop().catch(() => undefined);
  }

  // Set the code rather than calling process.exit(), which would terminate the
  // process before the teardown above has flushed and turn a passing run into
  // a non-zero exit.
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error("api-tests crashed:", error);
  process.exit(1);
});
