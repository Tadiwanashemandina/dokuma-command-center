import type { RequestHandler } from "express";
import { CSRF_COOKIE } from "../services/session.js";
import { safeEqual } from "../services/password.js";
import { HttpError } from "./error.js";

/**
 * CSRF protection appropriate to the cookie strategy (inventory §4.2 brief).
 *
 * The session cookie is `sameSite: "strict"`, which already means a browser
 * will not attach it to any cross-site request — that is the primary defense
 * and it is strong. This module is the second layer, for the cases SameSite
 * alone does not cover:
 *
 *   - Older browsers that ignore or mis-implement SameSite.
 *   - A same-site but untrusted origin (a subdomain takeover), which SameSite
 *     treats as trusted because it works on registrable domains, not origins.
 *
 * Mechanism: double-submit. `issueSession` sets a non-httpOnly `dokuma_csrf`
 * cookie; the client reads it and echoes it in `X-CSRF-Token`. An attacker on
 * another origin can cause the cookie to be *sent* but cannot *read* it to
 * construct the matching header, because the same-origin policy stops them.
 *
 * The token is per-session and not rotated per request: rotation breaks
 * concurrent requests (a dashboard fires several at once, and each would
 * invalidate the others' token) for no gain against this threat model.
 */

const HEADER = "x-csrf-token";

/**
 * Methods that cannot change state, and so need no token. Per RFC 9110 these
 * are the safe methods; a handler that mutates on GET is the bug to fix, not a
 * reason to widen this list.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireCsrfToken: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken: unknown = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(HEADER);

  // No CSRF cookie means no session was ever issued to this browser, so there
  // is no authenticated state for an attacker to ride. `requireAuth` is what
  // rejects these; failing here too would just produce a confusing 403 on
  // every unauthenticated POST, including login.
  if (typeof cookieToken !== "string" || cookieToken.length === 0) return next();

  if (typeof headerToken !== "string" || !safeEqual(cookieToken, headerToken)) {
    return next(
      new HttpError(
        403,
        "Invalid or missing CSRF token. Reload the page and try again.",
      ),
    );
  }

  next();
};
