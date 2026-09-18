/**
 * Offline verification of the auth primitives — everything that can be proven
 * without a database connection.
 *
 * The database-dependent behavior (login pipeline, session lifecycle, role
 * gating, the §4.3 cross-role matrix) is covered by the HTTP-level suite that
 * replaces `scripts/rls-tests.mjs` (D-5). This script exists so the crypto and
 * schema layers can be checked on a machine with no mongod, which is where the
 * subtle mistakes tend to hide anyway.
 *
 *   npx tsx server/src/scripts/verify-auth-offline.ts
 */

import {
  hashPassword,
  verifyPassword,
  needsRehash,
  burnPasswordTime,
  safeEqual,
} from "../services/password.js";
import {
  generateSecret,
  verifyTotp,
  buildEnrollment,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
  isMfaRequiredForRole,
} from "../services/mfa.js";
import { authenticator } from "otplib";
import {
  USER_ROLES,
  MFA_REQUIRED_ROLES,
  MFA_POLICY_ROLES,
  departmentScopeForRole,
  roleHomePath,
} from "@dokuma/shared";
import { loginSchema, changePasswordSchema, mfaVerifySchema } from "../routes/auth.schemas.js";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  console.log("\n== Password hashing (§4.2) ==");

  const hash = await hashPassword("correct horse battery staple");
  check("produces an argon2id hash", hash.startsWith("$argon2id$"));
  check("correct password verifies", await verifyPassword(hash, "correct horse battery staple"));
  check("wrong password is rejected", !(await verifyPassword(hash, "wrong password")));
  check(
    "malformed hash returns false rather than throwing",
    !(await verifyPassword("not-a-hash", "anything")),
  );
  check("needsRehash is false at current parameters", !needsRehash(hash));
  check("two hashes of the same password differ (salted)", hash !== (await hashPassword("correct horse battery staple")));
  check("burnPasswordTime resolves false", (await burnPasswordTime("anything")) === false);

  console.log("\n== Constant-time comparison ==");
  check("identical strings match", safeEqual("abc123", "abc123"));
  check("differing strings do not match", !safeEqual("abc123", "abc124"));
  check("differing lengths do not throw", !safeEqual("abc", "abcdef"));

  // -------------------------------------------------------------------------
  console.log("\n== TOTP (§4.4) ==");

  const secret = generateSecret();
  const validCode = authenticator.generate(secret);
  check("a freshly generated code verifies", verifyTotp(secret, validCode));
  check("a wrong code is rejected", !verifyTotp(secret, "000000"));
  check("a code from another secret is rejected", !verifyTotp(generateSecret(), validCode));
  check("whitespace in a submitted code is tolerated", verifyTotp(secret, ` ${validCode} `));
  check("malformed input returns false rather than throwing", !verifyTotp(secret, "abc"));

  const enrollment = await buildEnrollment("finance_officer@dokuma.local", secret);
  check("otpauth URI is well formed", enrollment.otpauthUrl.startsWith("otpauth://totp/"));
  check("otpauth URI carries the secret", enrollment.otpauthUrl.includes(secret));
  check("QR renders as a data URL", enrollment.qrCodeDataUrl.startsWith("data:image/png;base64,"));

  // -------------------------------------------------------------------------
  console.log("\n== Recovery codes (§4.4) ==");

  const codes = generateRecoveryCodes();
  check("ten codes are issued", codes.length === 10);
  check("codes are unique", new Set(codes).size === codes.length);
  check("codes are formatted xxxxx-xxxxx", codes.every((c) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)));

  const hashes = await hashRecoveryCodes(codes);
  check("stored as hashes, never plaintext", hashes.every((h) => h.startsWith("$argon2")));
  check("no stored hash equals its code", hashes.every((h, i) => h !== codes[i]));

  const firstUse = await consumeRecoveryCode(hashes, codes[0]!);
  check("a valid code matches", firstUse.matched);
  check("a consumed code is removed", firstUse.remaining.length === 9);

  const replay = await consumeRecoveryCode(firstUse.remaining, codes[0]!);
  check("a consumed code cannot be reused (single-use)", !replay.matched);
  check("a failed attempt consumes nothing", replay.remaining.length === 9);

  const wrong = await consumeRecoveryCode(firstUse.remaining, "aaaaa-bbbbb");
  check("an invalid code is rejected", !wrong.matched);

  const cased = await consumeRecoveryCode(firstUse.remaining, codes[1]!.toUpperCase());
  check("codes are case-insensitive on entry", cased.matched);

  // -------------------------------------------------------------------------
  console.log("\n== Role policy (§4.1, §4.4, §4.5) ==");

  check("nine roles defined", USER_ROLES.length === 9);

  // MFA is currently disabled (MFA_ENABLED === false in shared/src/roles.ts).
  // The policy list is still asserted so that flipping the flag back on
  // restores exactly the four Finance/HR roles it always covered.
  check(
    "the MFA policy still names exactly the four Finance/HR roles",
    MFA_POLICY_ROLES.length === 4 &&
      ["finance_officer", "finance_manager", "hr_officer", "hr_manager"].every((r) =>
        (MFA_POLICY_ROLES as readonly string[]).includes(r),
      ),
  );
  check("MFA is disabled, so no role requires it", MFA_REQUIRED_ROLES.length === 0);
  check("admin is not asked for MFA", !isMfaRequiredForRole("admin"));
  check("exec is not asked for MFA", !isMfaRequiredForRole("exec"));
  check("finance_officer is not asked for MFA while disabled", !isMfaRequiredForRole("finance_officer"));

  check("finance roles scope to finance", departmentScopeForRole("finance_manager") === "finance");
  check("hr roles scope to hr", departmentScopeForRole("hr_officer") === "hr");
  check("employee scopes to hr", departmentScopeForRole("employee") === "hr");
  check("admin has no scope (sees everything)", departmentScopeForRole("admin") === null);
  check("exec has no scope", departmentScopeForRole("exec") === null);
  check("viewer has no scope", departmentScopeForRole("viewer") === null);

  check("D-14 preserved: viewer lands on /projects", roleHomePath("viewer") === "/projects");
  check("exec lands on /", roleHomePath("exec") === "/");
  check("finance_officer lands on /finance", roleHomePath("finance_officer") === "/finance");
  check("hr_manager lands on /hr", roleHomePath("hr_manager") === "/hr");

  // -------------------------------------------------------------------------
  console.log("\n== Request validation ==");

  check("valid login parses", loginSchema.safeParse({ email: "a@b.com", password: "x" }).success);
  check(
    "email is lowercased on parse",
    loginSchema.parse({ email: "A@B.COM", password: "x" }).email === "a@b.com",
  );
  check("invalid email rejected", !loginSchema.safeParse({ email: "nope", password: "x" }).success);
  check(
    "unexpected keys rejected (strict)",
    !loginSchema.safeParse({ email: "a@b.com", password: "x", role: "admin" }).success,
  );
  check(
    "relative next path accepted",
    loginSchema.safeParse({ email: "a@b.com", password: "x", next: "/finance" }).success,
  );
  check(
    "open redirect to absolute URL rejected",
    !loginSchema.safeParse({ email: "a@b.com", password: "x", next: "https://evil.com" }).success,
  );
  check(
    "protocol-relative open redirect rejected",
    !loginSchema.safeParse({ email: "a@b.com", password: "x", next: "//evil.com" }).success,
  );

  check("6-digit MFA code accepted", mfaVerifySchema.safeParse({ code: "123456" }).success);
  check("5-digit MFA code rejected", !mfaVerifySchema.safeParse({ code: "12345" }).success);
  check("non-numeric MFA code rejected", !mfaVerifySchema.safeParse({ code: "abcdef" }).success);

  check(
    "12-character password accepted",
    changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "abcdefghijkl" }).success,
  );
  check(
    "11-character password rejected",
    !changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "abcdefghijk" }).success,
  );

  // -------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("verification crashed:", error);
  process.exit(1);
});
