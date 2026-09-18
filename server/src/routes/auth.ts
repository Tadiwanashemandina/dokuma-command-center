import { Router, type Request, type Response, type NextFunction } from "express";
import type { UserRole } from "@dokuma/shared";
import { roleHomePath, ADMIN_ONLY } from "@dokuma/shared";
import { User, AUDIT_ACTIONS } from "../db/models/index.js";
import { audit } from "../services/audit.js";
import { attemptLogin } from "../services/login.js";
import { hashPassword, verifyPassword } from "../services/password.js";
import {
  issueSession,
  revokeSession,
  revokeAllSessions,
  elevateSession,
  readSessionToken,
  clearSessionCookies,
} from "../services/session.js";
import {
  generateSecret,
  buildEnrollment,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
  isMfaRequiredForRole,
  hasVerifiedFactor,
} from "../services/mfa.js";
import { mfaChallengeRateLimit, loginRateLimit, clientIp } from "../services/rate-limit.js";
import { requireAuth, requireRole, requireAuthContext, toCurrentUser } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { createInvitedUser, inspectPasswordSetToken, redeemPasswordSetToken } from "../services/invite.js";
import {
  inviteUserSchema,
  setPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  mfaRecoverySchema,
  changePasswordSchema,
} from "./auth.schemas.js";

/**
 * Authentication endpoints (inventory §3.1, §4.2, §4.4).
 *
 * Replaces `POST /api/auth/login`, `POST /api/auth/signout`, the Supabase MFA
 * calls, and `middleware.ts`'s implicit session refresh. `loginAction` (the
 * Server Action) is not ported — §10, D-1 keeps one login path, and the page
 * already used the route.
 */

export const authRouter = Router();

/** Wraps an async handler so a rejection reaches the error middleware. */
function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

authRouter.post(
  "/login",
  handle(async (req, res) => {
    const { email, password, next: nextPath } = loginSchema.parse(req.body);

    const outcome = await attemptLogin(req, email, password);

    if (!outcome.ok) {
      if (outcome.retryAfterSeconds !== undefined) {
        res.set("Retry-After", String(outcome.retryAfterSeconds));
      }
      res.status(outcome.status).json({ error: outcome.message });
      return;
    }

    const { user, aal, mfaNext } = outcome;
    const role = user.role as UserRole;

    await issueSession(res, req, user.id as string, aal);

    res.status(200).json({
      data: {
        user: {
          id: user.id as string,
          email: user.email,
          fullName: user.fullName ?? null,
          role,
          mfaVerified: false,
          mfaRequired: isMfaRequiredForRole(role),
        },
        /**
         * Where the client should go next. `mfaNext` wins over the requested
         * path: a Finance/HR user is not allowed anywhere until they reach
         * aal2, which is the legacy redirect-to-enroll/verify behavior (§4.4).
         */
        next: mfaNext
          ? `/account/mfa/${mfaNext}`
          : (nextPath ?? roleHomePath(role)),
        mfaNext,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

/**
 * Not behind `requireAuth`: signing out must work even when the session is
 * already expired or unrecognized. It clears the cookies either way, so the
 * browser is never left holding a token it will keep sending.
 */
authRouter.post(
  "/logout",
  handle(async (req, res) => {
    const token = readSessionToken(req);

    if (token && req.auth) {
      await audit(req, {
        action: AUDIT_ACTIONS.LOGOUT,
        entityType: "auth",
        entityId: req.auth.user.id as string,
        actorId: req.auth.user.id as string,
        actorRole: req.auth.role,
      });
    }

    await revokeSession(res, token);
    res.status(200).json({ data: { ok: true } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

/**
 * The client's session bootstrap — the `getProfile()` analogue. A 401 here is
 * how the SPA learns it is signed out, so `<RequireAuth>` can route to /login.
 */
authRouter.get(
  "/me",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);

    res.status(200).json({
      data: {
        ...toCurrentUser(auth),
        // Present so the client can show "verify" vs "enroll" without a
        // second request, mirroring what login returned.
        mfaNext:
          isMfaRequiredForRole(auth.role) && auth.session.aal !== "aal2"
            ? hasVerifiedFactor(auth.user)
              ? "verify"
              : "enroll"
            : null,
        homePath: roleHomePath(auth.role),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/sessions/revoke-all
// ---------------------------------------------------------------------------

authRouter.post(
  "/sessions/revoke-all",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const revoked = await revokeAllSessions(auth.user.id as string);

    await audit(req, {
      action: AUDIT_ACTIONS.SESSION_REVOKED_ALL,
      entityType: "auth",
      entityId: auth.user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { revoked },
    });

    // Includes the caller's own session, by design — "sign out everywhere"
    // that leaves the current browser signed in is not what it says.
    clearSessionCookies(res);
    res.status(200).json({ data: { revoked } });
  }),
);

// ---------------------------------------------------------------------------
// MFA — §4.4
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/mfa/enroll — begins enrollment.
 *
 * Writes `mfa.pendingSecret` and returns the QR. Re-calling this overwrites
 * any enrollment already in progress, which is the intended way to restart
 * after losing a half-finished setup. Note what is NOT needed: the legacy
 * enroll page had to delete stale unverified Supabase factors first, because
 * `listFactors()` hid them from `.totp` but the API still counted them. With
 * pending and verified as separate fields, there is nothing stale to clear.
 */
authRouter.post(
  "/mfa/enroll",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);

    if (hasVerifiedFactor(auth.user)) {
      throw new HttpError(
        409,
        "Two-factor authentication is already enabled. Reset it before enrolling again.",
      );
    }

    const secret = generateSecret();
    auth.user.mfa.pendingSecret = secret;
    await auth.user.save();

    const { otpauthUrl, qrCodeDataUrl } = await buildEnrollment(auth.user.email, secret);

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_ENROLL_STARTED,
      entityType: "auth",
      entityId: auth.user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
    });

    res.status(200).json({
      data: {
        // The secret is returned once, for manual entry when the QR cannot be
        // scanned. It is already in `pendingSecret`; showing it here leaks
        // nothing the enrolling user does not already hold.
        secret,
        otpauthUrl,
        qrCodeDataUrl,
      },
    });
  }),
);

/**
 * POST /api/auth/mfa/enroll/verify — completes enrollment.
 *
 * Promotes `pendingSecret` to `secret` on a correct code and returns the
 * recovery codes, which are shown exactly once.
 */
authRouter.post(
  "/mfa/enroll/verify",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { code } = mfaVerifySchema.parse(req.body);

    const pending = auth.user.mfa.pendingSecret;
    if (!pending) {
      throw new HttpError(400, "Start two-factor enrollment before verifying a code.");
    }

    const limit = await mfaChallengeRateLimit.limit(`enroll:${auth.user.id as string}`);
    if (!limit.success) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }

    if (!verifyTotp(pending, code)) {
      await audit(req, {
        action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
        entityType: "auth",
        entityId: auth.user.id as string,
        actorId: auth.user.id as string,
        actorRole: auth.role,
        metadata: { stage: "enroll" },
      });
      throw new HttpError(400, "That code is not correct. Please try again.");
    }

    const recoveryCodes = generateRecoveryCodes();

    auth.user.mfa.secret = pending;
    auth.user.mfa.pendingSecret = null;
    auth.user.mfa.verifiedAt = new Date();
    auth.user.mfa.recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);
    await auth.user.save();

    // Enrolling proves possession of the factor right now, so this session
    // earns aal2 without a second challenge.
    await elevateSession(auth.session);

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_ENROLL_VERIFIED,
      entityType: "auth",
      entityId: auth.user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
    });

    res.status(200).json({
      data: {
        // Plaintext, once, never retrievable again — only hashes are stored.
        recoveryCodes,
        next: roleHomePath(auth.role),
      },
    });
  }),
);

/**
 * POST /api/auth/mfa/challenge — the per-session TOTP check that promotes
 * aal1 → aal2. This is what `/account/mfa/verify` posts to.
 */
authRouter.post(
  "/mfa/challenge",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { code } = mfaVerifySchema.parse(req.body);

    const secret = auth.user.mfa.secret;
    if (!secret) {
      throw new HttpError(400, "Two-factor authentication is not set up for this account.");
    }

    // Keyed on both user and IP: a 6-digit code is guessable at volume, and
    // this is the one check standing between aal1 and Finance/HR data.
    const limit = await mfaChallengeRateLimit.limit(
      `challenge:${auth.user.id as string}:${clientIp(req)}`,
    );
    if (!limit.success) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }

    if (!verifyTotp(secret, code)) {
      await audit(req, {
        action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
        entityType: "auth",
        entityId: auth.user.id as string,
        actorId: auth.user.id as string,
        actorRole: auth.role,
        metadata: { stage: "challenge" },
      });
      throw new HttpError(400, "That code is not correct. Please try again.");
    }

    await elevateSession(auth.session);

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_SUCCEEDED,
      entityType: "auth",
      entityId: auth.user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
    });

    res.status(200).json({ data: { mfaVerified: true, next: roleHomePath(auth.role) } });
  }),
);

/**
 * POST /api/auth/mfa/recover — spends a single-use recovery code to reach
 * aal2 when the authenticator device is gone.
 */
authRouter.post(
  "/mfa/recover",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { recoveryCode } = mfaRecoverySchema.parse(req.body);

    if (!auth.user.mfa.secret) {
      throw new HttpError(400, "Two-factor authentication is not set up for this account.");
    }

    const limit = await mfaChallengeRateLimit.limit(
      `recover:${auth.user.id as string}:${clientIp(req)}`,
    );
    if (!limit.success) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }

    const { matched, remaining } = await consumeRecoveryCode(
      auth.user.mfa.recoveryCodeHashes,
      recoveryCode,
    );

    if (!matched) {
      await audit(req, {
        action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
        entityType: "auth",
        entityId: auth.user.id as string,
        actorId: auth.user.id as string,
        actorRole: auth.role,
        metadata: { stage: "recovery" },
      });
      throw new HttpError(400, "That recovery code is not valid.");
    }

    auth.user.mfa.recoveryCodeHashes = remaining;
    await auth.user.save();
    await elevateSession(auth.session);

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_RECOVERY_USED,
      entityType: "auth",
      entityId: auth.user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { remaining: remaining.length },
    });

    res.status(200).json({
      data: {
        mfaVerified: true,
        remainingRecoveryCodes: remaining.length,
        next: roleHomePath(auth.role),
      },
    });
  }),
);

/**
 * POST /api/auth/mfa/reset — removes the factor so a new device can enroll.
 *
 * Requires the current password: without it, an unattended logged-in browser
 * is enough to strip the second factor off a Finance account, which would make
 * MFA decorative.
 */
authRouter.post(
  "/mfa/reset",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { currentPassword } = changePasswordSchema
      .pick({ currentPassword: true })
      .parse(req.body);

    const user = await User.findById(auth.user.id as string).select("+passwordHash");
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new HttpError(403, "That password is not correct.");
    }

    user.mfa.secret = null;
    user.mfa.pendingSecret = null;
    user.mfa.verifiedAt = null;
    user.mfa.recoveryCodeHashes = [];
    await user.save();

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_RESET,
      entityType: "auth",
      entityId: user.id as string,
      actorId: user.id as string,
      actorRole: auth.role,
    });

    // Every other session for this user drops back to needing enrollment; the
    // cleanest way to express that is to end them all.
    await revokeAllSessions(user.id as string);
    clearSessionCookies(res);

    res.status(200).json({ data: { ok: true, next: "/login" } });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/password
// ---------------------------------------------------------------------------

authRouter.post(
  "/password",
  requireAuth,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await User.findById(auth.user.id as string).select("+passwordHash");
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new HttpError(403, "That password is not correct.");
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    await audit(req, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: "auth",
      entityId: user.id as string,
      actorId: user.id as string,
      actorRole: auth.role,
    });

    // Changing a password is how someone responds to a suspected compromise,
    // so every existing session dies — including this one. The client signs
    // back in with the new password.
    await revokeAllSessions(user.id as string);
    clearSessionCookies(res);

    res.status(200).json({ data: { ok: true, next: "/login" } });
  }),
);

// ---------------------------------------------------------------------------
// Account invites — POST /api/auth/invite (admin only)
// ---------------------------------------------------------------------------

/**
 * Creates an account with no usable password and returns a one-time
 * set-password link.
 *
 * The link is returned in the response rather than emailed: the Resend domain
 * is not DNS-verified (ONBOARDING §5), so an email path would fail silently
 * today. Handing the admin the URL keeps the flow honest — they can see
 * exactly what they are sending.
 */
authRouter.post(
  "/invite",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = inviteUserSchema.parse(req.body);

    const { user, token, expiresAt } = await createInvitedUser({
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      createdBy: auth.user.id as string,
    });

    await audit(req, {
      action: AUDIT_ACTIONS.USER_INVITED,
      entityType: "users",
      entityId: user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email, role: input.role },
    });

    res.status(201).json({
      data: {
        user: { id: user.id as string, email: user.email, fullName: user.fullName, role: user.role },
        // Relative, so it works against whatever origin serves the client.
        setPasswordPath: `/set-password?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/auth/set-password — validate a link before showing the form
// ---------------------------------------------------------------------------

/**
 * Public by necessity: the whole point is that the holder has no session yet.
 * Rate-limited by IP so the token space cannot be swept, and every failure
 * returns the same message so a near-miss is indistinguishable from a miss.
 */
authRouter.get(
  "/set-password",
  handle(async (req, res) => {
    const { success, retryAfterSeconds } = await loginRateLimit.limit(`set-password:${clientIp(req)}`);
    if (!success) {
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }

    const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
    const details = await inspectPasswordSetToken(token);

    res.status(200).json({ data: { email: details.email, purpose: details.purpose } });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/set-password — redeem the link
// ---------------------------------------------------------------------------

authRouter.post(
  "/set-password",
  handle(async (req, res) => {
    const { success, retryAfterSeconds } = await loginRateLimit.limit(`set-password:${clientIp(req)}`);
    if (!success) {
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }

    const input = setPasswordSchema.parse(req.body);
    const details = await redeemPasswordSetToken(input.token, input.password);

    // Any session that existed under the old credential is killed. For an
    // invite there are none; for a reset this is the point of the exercise.
    await revokeAllSessions(details.userId);

    await audit(req, {
      action: AUDIT_ACTIONS.PASSWORD_SET_VIA_TOKEN,
      entityType: "users",
      entityId: details.userId,
      actorId: details.userId,
      actorRole: null,
      metadata: { purpose: details.purpose },
    });

    // Deliberately does NOT sign them in. Redeeming a link proves possession
    // of the link, not of the account — they sign in with the password they
    // just chose, which is also the first test that it works.
    res.status(200).json({ data: { email: details.email } });
  }),
);
