/**
 * Cross-role authorization tests over HTTP — the rewrite of
 * `scripts/rls-tests.mjs` that inventory §4.3 / D-5 requires as a merge gate.
 *
 * Why this exists in this shape: Postgres RLS failed *closed*. A policy that
 * was never written meant no rows came back. Mongo has no equivalent, so every
 * one of those policies becomes a filter in application code — and a forgotten
 * filter fails *open*. The old suite proved the policies held by querying
 * PostgREST directly as each role. There is no direct-from-browser database
 * access any more, so the equivalent proof is made against the HTTP API, which
 * is now the only way in.
 *
 * This file covers the authentication and session layer that Phase "Auth"
 * delivers. The per-resource row-scoping checks (the §4.3 table: employees,
 * leave_requests, approvals, notifications, department scoping) are added as
 * each module's endpoints land — the list at the bottom of this file tracks
 * which are still outstanding, so an unported policy is visible rather than
 * silently absent.
 *
 *   npm run test:auth --workspace @dokuma/server
 *
 * Requires a running MongoDB (MONGODB_URI) and the seeded accounts from
 * `seed-users.ts`. Boots the Express app in-process on an ephemeral port, so
 * it needs no separately running server.
 */

import type { Server } from "node:http";
import { createApp } from "../app.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { User } from "../db/models/index.js";
import { hashPassword } from "../services/password.js";
import { env } from "../config/env.js";
import { USER_ROLES, type UserRole } from "@dokuma/shared";

const PASSWORD = "DokumaTest123!";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// A minimal cookie-aware HTTP client, so each role gets its own session jar.
// ---------------------------------------------------------------------------

class Client {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  /** The CSRF cookie value, which the double-submit check compares against. */
  private get csrf(): string | undefined {
    return this.cookies.get("dokuma_csrf");
  }

  get hasSessionCookie(): boolean {
    return this.cookies.has("dokuma_session");
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { omitCsrf?: boolean; csrfOverride?: string } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const cookieHeader = [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const token = options.csrfOverride ?? this.csrf;
    if (token && !options.omitCsrf) headers["X-CSRF-Token"] = token;

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
      // An empty value is the server clearing the cookie.
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await response.text();
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown, options?: { omitCsrf?: boolean; csrfOverride?: string }) =>
    this.request("POST", path, body, options);
}

function data(response: { body: Record<string, unknown> }): Record<string, unknown> {
  return (response.body["data"] ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await connectToDatabase();

  // Seed fresh accounts. Unlike seed-users.ts this always resets the password,
  // because a stale password here means every assertion below fails for a
  // reason that has nothing to do with authorization.
  const passwordHash = await hashPassword(PASSWORD);
  for (const role of USER_ROLES) {
    await User.updateOne(
      { email: `${role}@dokuma.local` },
      {
        $set: {
          passwordHash,
          role,
          fullName: `Test ${role}`,
          failedLoginCount: 0,
          lockedUntil: null,
          disabledAt: null,
        },
        $setOnInsert: { email: `${role}@dokuma.local` },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  const login = async (role: UserRole) => {
    const client = new Client(baseUrl);
    const response = await client.post("/api/auth/login", {
      email: `${role}@dokuma.local`,
      password: PASSWORD,
    });
    return { client, response };
  };

  try {
    // -----------------------------------------------------------------------
    console.log("\n== Unauthenticated access is refused (§4.2) ==");
    {
      const anon = new Client(baseUrl);

      const me = await anon.get("/api/auth/me");
      check("GET /auth/me without a session is 401", me.status === 401);
      check(
        "401 carries reason 'unauthenticated' for the client to route on",
        me.body["reason"] === "unauthenticated",
      );

      const health = await anon.get("/api/health");
      check("GET /health stays public", health.status === 200);

      const forged = new Client(baseUrl);
      await forged.request("GET", "/api/health"); // establish no cookies
      const bad = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: "dokuma_session=" + "f".repeat(64) },
      });
      check("a forged session cookie is rejected", bad.status === 401);
    }

    // -----------------------------------------------------------------------
    console.log("\n== Login (§4.2, §4.6) ==");
    {
      const { client, response } = await login("admin");
      check("valid credentials return 200", response.status === 200);
      check("a session cookie is set", client.hasSessionCookie);
      check(
        "the response carries the user's role",
        (data(response)["user"] as Record<string, unknown> | undefined)?.["role"] === "admin",
      );

      const me = await client.get("/api/auth/me");
      check("the session authenticates a subsequent request", me.status === 200);
      check("GET /auth/me returns the right identity", data(me)["email"] === "admin@dokuma.local");
    }

    {
      const anon = new Client(baseUrl);
      const wrong = await anon.post("/api/auth/login", {
        email: "admin@dokuma.local",
        password: "not-the-password",
      });
      check("a wrong password is 401", wrong.status === 401);
      check("no session cookie is issued on failure", !anon.hasSessionCookie);

      const unknown = await new Client(baseUrl).post("/api/auth/login", {
        email: "nobody@dokuma.local",
        password: "whatever",
      });
      check("an unknown email is also 401", unknown.status === 401);
      check(
        "both failures return an identical message (no account enumeration)",
        wrong.body["error"] === unknown.body["error"],
      );
    }

    {
      const malformed = await new Client(baseUrl).post("/api/auth/login", {
        email: "not-an-email",
        password: "x",
      });
      check("a malformed email is a 400 validation error", malformed.status === 400);
      check("validation failures carry per-field detail", Array.isArray(malformed.body["fields"]));
    }

    // -----------------------------------------------------------------------
    console.log("\n== Session lifecycle (§4.2) ==");
    {
      const { client } = await login("admin");
      const logout = await client.post("/api/auth/logout");
      check("logout returns 200", logout.status === 200);
      check("logout clears the session cookie", !client.hasSessionCookie);

      const after = await client.get("/api/auth/me");
      check("the session is dead after logout", after.status === 401);
    }

    {
      // A revoked session must stop working immediately — this is the property
      // a stateless JWT could not provide, and the reason for the D-4 design.
      const { client } = await login("exec");
      const before = await client.get("/api/auth/me");
      check("exec session works before revocation", before.status === 200);

      const revoke = await client.post("/api/auth/sessions/revoke-all");
      check("revoke-all returns 200", revoke.status === 200);

      const after = await client.get("/api/auth/me");
      check("revocation takes effect on the very next request", after.status === 401);
    }

    // -----------------------------------------------------------------------
    console.log("\n== CSRF double-submit (§4.2) ==");
    {
      const { client } = await login("admin");

      const noToken = await client.post("/api/auth/sessions/revoke-all", undefined, {
        omitCsrf: true,
      });
      check("a mutating request without the CSRF header is 403", noToken.status === 403);

      const wrongToken = await client.post("/api/auth/sessions/revoke-all", undefined, {
        csrfOverride: "f".repeat(64),
      });
      check("a mismatched CSRF token is 403", wrongToken.status === 403);

      const safe = await client.get("/api/auth/me");
      check("safe methods are unaffected by CSRF", safe.status === 200);
    }

    // -----------------------------------------------------------------------
    // MFA is currently disabled (MFA_ENABLED === false in shared/src/roles.ts),
    // so *no* role is gated. These checks assert the disabled state; restore
    // the "is directed to MFA enrollment" expectations when the flag flips back.
    console.log("\n== MFA disabled: no role is gated (§4.4) ==");
    for (const role of [
      "finance_officer",
      "finance_manager",
      "hr_officer",
      "hr_manager",
      "admin",
      "exec",
    ] as const) {
      const { client, response } = await login(role);
      check(`${role} can authenticate`, response.status === 200);
      check(`${role} reaches the app without MFA`, data(response)["mfaNext"] === null);

      const me = await client.get("/api/auth/me");
      check(`${role} reports mfaRequired false while MFA is off`, data(me)["mfaRequired"] === false);
    }

    // -----------------------------------------------------------------------
    // The enroll/challenge/recover endpoints stay live even with gating off, so
    // this block still exercises them end to end — it is what proves the
    // machinery is intact for when MFA_ENABLED flips back to true. Only the
    // *routing* assertions changed: logins no longer carry an mfaNext.
    console.log("\n== MFA enrollment flow, opt-in while gating is off (§4.4) ==");
    {
      const { client } = await login("finance_officer");

      const enroll = await client.post("/api/auth/mfa/enroll");
      check("enrollment starts and returns a secret", typeof data(enroll)["secret"] === "string");
      check(
        "enrollment returns a scannable QR",
        String(data(enroll)["qrCodeDataUrl"] ?? "").startsWith("data:image/png;base64,"),
      );

      const badCode = await client.post("/api/auth/mfa/enroll/verify", { code: "000000" });
      check("a wrong enrollment code is rejected", badCode.status === 400);

      const stillUnverified = await client.get("/api/auth/me");
      check(
        "a failed verification does not promote the session",
        data(stillUnverified)["mfaVerified"] === false,
      );

      // Complete enrollment with a genuine code derived from the issued secret.
      const { authenticator } = await import("otplib");
      const secret = String(data(enroll)["secret"]);
      const verified = await client.post("/api/auth/mfa/enroll/verify", {
        code: authenticator.generate(secret),
      });
      check("a correct code completes enrollment", verified.status === 200);
      check(
        "recovery codes are issued exactly once",
        Array.isArray(data(verified)["recoveryCodes"]) &&
          (data(verified)["recoveryCodes"] as string[]).length === 10,
      );

      const elevated = await client.get("/api/auth/me");
      check("the session is now mfaVerified (aal2)", data(elevated)["mfaVerified"] === true);
      check("mfaNext is cleared once verified", data(elevated)["mfaNext"] === null);

      // With gating off a later login is no longer *sent* to verify, but the
      // factor is still on the user and the challenge endpoint still honours it.
      const second = await login("finance_officer");
      check(
        "a later login is not forced to verify while MFA is off",
        data(second.response)["mfaNext"] === null,
      );

      const challenge = await second.client.post("/api/auth/mfa/challenge", {
        code: authenticator.generate(secret),
      });
      check("the TOTP challenge promotes the new session", challenge.status === 200);
      check(
        "the challenged session is mfaVerified",
        data(await second.client.get("/api/auth/me"))["mfaVerified"] === true,
      );

      // Recovery codes are single-use.
      const third = await login("finance_officer");
      const codes = data(verified)["recoveryCodes"] as string[];
      const recover = await third.client.post("/api/auth/mfa/recover", {
        recoveryCode: codes[0],
      });
      check("a recovery code reaches aal2", recover.status === 200);
      check("nine recovery codes remain", data(recover)["remainingRecoveryCodes"] === 9);

      const fourth = await login("finance_officer");
      const replay = await fourth.client.post("/api/auth/mfa/recover", {
        recoveryCode: codes[0],
      });
      check("a spent recovery code cannot be replayed", replay.status === 400);
    }

    // -----------------------------------------------------------------------
    console.log("\n== Account state (§4.2) ==");
    {
      await User.updateOne({ email: "viewer@dokuma.local" }, { $set: { disabledAt: new Date() } });
      const disabled = await new Client(baseUrl).post("/api/auth/login", {
        email: "viewer@dokuma.local",
        password: PASSWORD,
      });
      check("a disabled account cannot log in", disabled.status === 401);
      await User.updateOne({ email: "viewer@dokuma.local" }, { $set: { disabledAt: null } });
    }

    // -----------------------------------------------------------------------
    console.log(`\n${passed} passed, ${failed} failed\n`);

    if (failed === 0) {
      console.log("Still to be added as their endpoints land (inventory §4.3):");
      console.log("  - employees / leave_requests / performance / training row scoping");
      console.log("  - approvals compound $or, notifications user_id filter");
      console.log("  - department scoping on risks_issues_decisions and clients (§4.5)");
      console.log("  - finance and HR role gates on their module endpoints\n");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectFromDatabase();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|serverSelectionTimeout|failed to connect/i.test(message)) {
    console.error(
      `\nCannot reach MongoDB at ${env.MONGODB_URI}.\n` +
        `These tests need a live database. Start one with:\n` +
        `  docker run -d -p 27017:27017 mongo:7\n`,
    );
    process.exit(2);
  }
  console.error("auth-tests crashed:", error);
  process.exit(1);
});
