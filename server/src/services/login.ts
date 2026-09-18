import type { Request } from "express";
import { createHash } from "node:crypto";
import type { UserRole } from "@dokuma/shared";
import { User, AUDIT_ACTIONS, type UserDocument } from "../db/models/index.js";
import { audit } from "./audit.js";
import { loginRateLimit, clientIp } from "./rate-limit.js";
import { verifyPassword, hashPassword, needsRehash, burnPasswordTime } from "./password.js";
import { isMfaRequiredForRole, hasVerifiedFactor } from "./mfa.js";

/**
 * The login attempt pipeline (inventory §4.2, §4.6, §4.7).
 *
 * Two rules shape everything here:
 *
 *   1. **Every failure looks identical.** Same message, same status, and
 *      roughly the same latency, whether the email is unknown, the password is
 *      wrong, or the account is locked. Anything else enumerates accounts.
 *   2. **Failures are counted twice** — once per IP and once per account.
 *      IP-only lets one attacker spread a password-spray across a botnet;
 *      account-only lets them lock every user out on purpose. Both together
 *      cover both attacks, which is what §4.6's "by IP and account identifier"
 *      asks for.
 */

/** The single message every failure returns. Never varies. */
export const GENERIC_LOGIN_FAILURE = "Invalid email or password.";

const MAX_ACCOUNT_FAILURES = 10;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

export type LoginOutcome =
  | { ok: true; user: UserDocument; aal: "aal1" | "aal2"; mfaNext: "enroll" | "verify" | null }
  | { ok: false; status: 401 | 429; message: string; retryAfterSeconds?: number };

/**
 * The account-side rate limit key.
 *
 * Hashed rather than stored raw so the `rate_limit_windows` collection — which
 * is world-readable to anyone with DB access and has a short TTL, so it gets
 * less scrutiny than `users` — does not become a list of email addresses that
 * someone tried to log into.
 */
function accountKey(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32);
}

export async function attemptLogin(
  req: Request,
  rawEmail: string,
  password: string,
): Promise<LoginOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const ip = clientIp(req);

  // --- Rate limit: IP, then account -----------------------------------------

  const ipLimit = await loginRateLimit.limit(`ip:${ip}`);
  if (!ipLimit.success) {
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_RATE_LIMITED,
      entityType: "auth",
      actorRole: "anonymous",
      metadata: { scope: "ip", email },
    });
    return {
      ok: false,
      status: 429,
      message: "Too many sign-in attempts. Please wait a minute and try again.",
      retryAfterSeconds: ipLimit.retryAfterSeconds,
    };
  }

  const accountLimit = await loginRateLimit.limit(`account:${accountKey(email)}`);
  if (!accountLimit.success) {
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_RATE_LIMITED,
      entityType: "auth",
      actorRole: "anonymous",
      metadata: { scope: "account", email },
    });
    return {
      ok: false,
      status: 429,
      message: "Too many sign-in attempts. Please wait a minute and try again.",
      retryAfterSeconds: accountLimit.retryAfterSeconds,
    };
  }

  // --- Identify -------------------------------------------------------------

  // `+passwordHash` because the field is `select: false` on the model.
  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user) {
    // Verify against a dummy hash anyway. Returning here immediately would
    // make an unknown email measurably faster than a known one, which
    // enumerates accounts no matter how generic the message is.
    await burnPasswordTime(password);
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: "auth",
      actorRole: "anonymous",
      metadata: { email, cause: "unknown_email" },
    });
    return { ok: false, status: 401, message: GENERIC_LOGIN_FAILURE };
  }

  const now = new Date();

  if (user.disabledAt) {
    await burnPasswordTime(password);
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: "auth",
      entityId: user.id as string,
      actorId: user.id as string,
      actorRole: user.role as UserRole,
      metadata: { email, cause: "disabled" },
    });
    return { ok: false, status: 401, message: GENERIC_LOGIN_FAILURE };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordTime(password);
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: "auth",
      entityId: user.id as string,
      actorId: user.id as string,
      actorRole: user.role as UserRole,
      metadata: { email, cause: "locked" },
    });
    // Deliberately the generic 401, not "your account is locked": telling an
    // attacker they found a real account is the whole thing we are avoiding.
    return { ok: false, status: 401, message: GENERIC_LOGIN_FAILURE };
  }

  // --- Verify ---------------------------------------------------------------

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const failures = user.failedLoginCount + 1;
    user.failedLoginCount = failures;

    if (failures >= MAX_ACCOUNT_FAILURES) {
      user.lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MS);
      user.failedLoginCount = 0;
      await audit(req, {
        action: AUDIT_ACTIONS.LOGIN_LOCKED,
        entityType: "auth",
        entityId: user.id as string,
        actorId: user.id as string,
        actorRole: user.role as UserRole,
        metadata: { email, lockedUntil: user.lockedUntil.toISOString() },
      });
    }

    await user.save();
    await audit(req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: "auth",
      entityId: user.id as string,
      actorId: user.id as string,
      actorRole: user.role as UserRole,
      metadata: { email, cause: "bad_password", failures },
    });

    return { ok: false, status: 401, message: GENERIC_LOGIN_FAILURE };
  }

  // --- Success --------------------------------------------------------------

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = now;

  // Transparently upgrade a hash written under weaker parameters. We have the
  // plaintext exactly here and nowhere else, so this is the only chance.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(password);
  }

  await user.save();

  // A successful login forgives this IP's counter, so one person fat-fingering
  // a password four times then succeeding does not leave the next colleague
  // behind the same NAT with a single attempt left.
  await loginRateLimit.reset(`ip:${ip}`);
  await loginRateLimit.reset(`account:${accountKey(email)}`);

  const role = user.role as UserRole;
  const mfaNext = isMfaRequiredForRole(role)
    ? hasVerifiedFactor(user)
      ? ("verify" as const)
      : ("enroll" as const)
    : null;

  await audit(req, {
    action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
    entityType: "auth",
    entityId: user.id as string,
    actorId: user.id as string,
    actorRole: role,
    metadata: { email, mfaNext },
  });

  // A session always starts at aal1. Only a passed TOTP challenge promotes it,
  // including for roles that do not require MFA — "aal2" must mean "proved a
  // second factor", never "did not need to".
  return { ok: true, user, aal: "aal1", mfaNext };
}
