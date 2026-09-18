import type { Request, RequestHandler } from "express";
import type { UserRole, CurrentUser } from "@dokuma/shared";
import { departmentScopeForRole, type DepartmentScope } from "@dokuma/shared";
import { User, type UserDocument, type SessionDocument } from "../db/models/index.js";
import { loadSession, touchSession, readSessionToken, clearSessionCookies } from "../services/session.js";
import { isMfaRequiredForRole, hasVerifiedFactor } from "../services/mfa.js";
import { AuthError } from "./http-error.js";

/**
 * Authentication and authorization middleware — the Express replacement for
 * `middleware.ts` + `requireRole()` (inventory §4.2, §4.3).
 *
 * The central behavioral change: the legacy guards *redirected*
 * (`redirect("/login")`, `redirect("/")`, `redirect("/account/mfa/verify")`).
 * An API cannot redirect a fetch meaningfully, so each redirect becomes a
 * status plus a machine-readable reason, and routing becomes the client's job:
 *
 *   redirect("/login")                → 401 { error, reason: "unauthenticated" }
 *   redirect("/")                     → 403 { error, reason: "forbidden" }
 *   redirect("/account/mfa/enroll")   → 403 { error, reason: "mfa_required", next: "enroll" }
 *   redirect("/account/mfa/verify")   → 403 { error, reason: "mfa_required", next: "verify" }
 */

/** The authenticated caller, attached once per request by `requireAuth`. */
export interface AuthContext {
  user: UserDocument;
  session: SessionDocument;
  role: UserRole;
  /**
   * Department scope for this caller (§4.5). Non-null for finance and HR
   * roles; null for admin/exec/viewer, who see everything.
   *
   * Resolved here so no handler recomputes it, and so D-5's "scope is a
   * required argument" has a single source.
   */
  departmentScope: DepartmentScope;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Populates `req.auth`, or 401s.
 *
 * This is the `updateSession()` + `getProfile()` pair collapsed into one step.
 * `getProfile` was React-`cache()`-memoized per request so pages could call it
 * repeatedly for free; attaching to `req` gives the same once-per-request
 * guarantee without the framework.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    if (req.auth) return next();

    const token = readSessionToken(req);
    if (!token) {
      throw new AuthError(401, "Authentication required.", "unauthenticated");
    }

    const session = await loadSession(token);
    if (!session) {
      // The cookie names a session that is gone or expired. Clear it so the
      // browser stops sending it on every subsequent request.
      clearSessionCookies(res);
      throw new AuthError(401, "Your session has expired. Please sign in again.", "unauthenticated");
    }

    const user = await User.findById(session.userId);
    if (!user || user.disabledAt) {
      // The account was deleted or disabled while the session was live. The
      // session outliving the account is exactly what server-side sessions let
      // us catch — a JWT would have stayed valid until its TTL.
      await session.deleteOne();
      clearSessionCookies(res);
      throw new AuthError(401, "Your session is no longer valid.", "unauthenticated");
    }

    await touchSession(session);

    req.auth = {
      user,
      session,
      role: user.role as UserRole,
      departmentScope: departmentScopeForRole(user.role as UserRole),
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Enforces AAL2 for roles in MFA_REQUIRED_ROLES (§4.4).
 *
 * Ports the exact branch from the legacy `requireRole`: if the role needs MFA
 * and the session is not yet aal2, the client is sent to verify when a factor
 * exists and to enroll when it does not. admin/exec are exempt by virtue of
 * not being in MFA_REQUIRED_ROLES.
 */
export const requireMfa: RequestHandler = (req, _res, next) => {
  const auth = requireAuthContext(req);

  if (!isMfaRequiredForRole(auth.role)) return next();
  if (auth.session.aal === "aal2") return next();

  const target = hasVerifiedFactor(auth.user) ? "verify" : "enroll";
  next(
    new AuthError(
      403,
      target === "verify"
        ? "Two-factor verification is required to continue."
        : "Two-factor enrollment is required for your role.",
      "mfa_required",
      target,
    ),
  );
};

/**
 * `requireRole(allowed)` — the direct port of the legacy guard (§4.3, layer 1).
 *
 * Returns middleware that runs the full chain: authenticate, check the role,
 * then enforce MFA. MFA is checked *after* the role so a user who is not
 * allowed here at all gets 403 forbidden rather than being sent to enroll in
 * MFA for a page they still could not see. That is the legacy ordering too.
 *
 * Note this is only layer 1. Layer 2 — the RLS policies — has no Mongo
 * equivalent and must be enforced as mandatory query filters in the data
 * layer (§4.3, D-5). Passing this middleware does NOT mean a handler may read
 * rows unfiltered.
 */
export function requireRole(allowed: readonly UserRole[]): RequestHandler[] {
  const gate: RequestHandler = (req, _res, next) => {
    const auth = requireAuthContext(req);

    if (!allowed.includes(auth.role)) {
      return next(
        new AuthError(403, "You do not have access to this resource.", "forbidden"),
      );
    }

    next();
  };

  return [requireAuth, gate, requireMfa];
}

/**
 * Authenticate with no role restriction — the explicit gate for the four
 * routes that had none and relied on RLS's `current_role() is not null`
 * (§10, D-2). Same effective behavior, now stated rather than incidental.
 */
export const requireAnyRole: RequestHandler[] = [requireAuth, requireMfa];

/**
 * Reads `req.auth`, throwing if the route forgot to mount `requireAuth`.
 *
 * A handler that reaches for the caller's identity and finds none must fail,
 * not treat the request as anonymous — that mistake is how an authorization
 * check silently becomes a no-op.
 */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new Error(
      "req.auth is not populated — this route is missing requireAuth/requireRole.",
    );
  }
  return req.auth;
}

/** Serializes the caller for `GET /api/auth/me`. */
export function toCurrentUser(auth: AuthContext): CurrentUser {
  return {
    id: auth.user.id as string,
    email: auth.user.email,
    fullName: auth.user.fullName ?? null,
    role: auth.role,
    mfaVerified: auth.session.aal === "aal2",
    mfaRequired: isMfaRequiredForRole(auth.role),
  };
}
