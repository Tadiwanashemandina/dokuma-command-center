import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { Session, type SessionDocument } from "../db/models/index.js";
import { env, isProduction } from "../config/env.js";

/**
 * Server-side opaque session management (inventory §4.2).
 *
 * The cookie holds a 32-byte random token. The database stores only its
 * SHA-256, so a leaked dump yields no usable cookies — the same reasoning that
 * makes us hash passwords, applied to bearer tokens. SHA-256 (not Argon2) is
 * correct here: the token is already 256 bits of entropy, so there is nothing
 * to brute-force and nothing for a slow hash to defend.
 */

export const SESSION_COOKIE = "dokuma_session";

/** CSRF double-submit companion. Readable by script *by design* — see csrf.ts. */
export const CSRF_COOKIE = "dokuma_csrf";

const HOUR_MS = 60 * 60 * 1000;

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cookie options for the session cookie.
 *
 * `httpOnly: true` is the change signed off as D-4 (§10). The legacy
 * `hardenCookieOptions` set `httpOnly: false` because the browser Supabase
 * client had to read the cookie for `signInWithPassword`, sign-out and the
 * Finance realtime subscription. This phase removes that client, so the
 * trade-off has no remaining justification and script can no longer read the
 * session. `secure` and `sameSite: "strict"` carry over unchanged.
 */
function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * The CSRF cookie is deliberately NOT httpOnly: the client has to read it to
 * echo it back in a header. That is the whole double-submit mechanism, and it
 * is safe because the value authorizes nothing on its own — it is only ever
 * compared against the header on the same request.
 */
function csrfCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeMs,
  };
}

export interface IssuedSession {
  session: SessionDocument;
  token: string;
  csrfToken: string;
}

/** Creates a session row and writes both cookies. */
export async function issueSession(
  res: Response,
  req: Request,
  userId: string,
  aal: "aal1" | "aal2",
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const now = Date.now();

  const idleMs = env.SESSION_IDLE_TTL_HOURS * HOUR_MS;
  const absoluteMs = env.SESSION_ABSOLUTE_TTL_HOURS * HOUR_MS;

  const session = await Session.create({
    _id: tokenDigest(token),
    userId,
    aal,
    expiresAt: new Date(now + idleMs),
    absoluteExpiresAt: new Date(now + absoluteMs),
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    lastUsedAt: new Date(),
  });

  // The session cookie must not outlive the absolute ceiling, or the browser
  // keeps sending a token the server will always reject.
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(Math.min(idleMs, absoluteMs)));
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions(Math.min(idleMs, absoluteMs)));

  return { session, token, csrfToken };
}

/**
 * Loads a live session by cookie token, or null.
 *
 * Both expiry checks happen here rather than relying on the TTL index: Mongo's
 * TTL monitor runs roughly once a minute, so an expired row can outlive its
 * `expiresAt` by that much. Authentication cannot depend on a reaper's schedule.
 */
export async function loadSession(token: string): Promise<SessionDocument | null> {
  const now = new Date();
  const session = await Session.findById(tokenDigest(token));

  if (!session) return null;

  if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
    await session.deleteOne();
    return null;
  }

  return session;
}

/**
 * Slides the idle window forward, clamped to the absolute ceiling.
 *
 * Written at most once a minute per session: without the throttle every
 * authenticated request becomes a write, which on a dashboard that fans out to
 * a dozen endpoints per page is a dozen pointless writes.
 */
export async function touchSession(session: SessionDocument): Promise<void> {
  const now = Date.now();

  if (now - session.lastUsedAt.getTime() < 60_000) return;

  const slidTo = new Date(
    Math.min(now + env.SESSION_IDLE_TTL_HOURS * HOUR_MS, session.absoluteExpiresAt.getTime()),
  );

  session.expiresAt = slidTo;
  session.lastUsedAt = new Date(now);
  await session.save();
}

/** Promotes a session to aal2 once a TOTP challenge succeeds (§4.4). */
export async function elevateSession(session: SessionDocument): Promise<void> {
  session.aal = "aal2";
  await session.save();
}

/** Revokes one session and clears its cookies. */
export async function revokeSession(res: Response, token: string | undefined): Promise<void> {
  if (token) await Session.deleteOne({ _id: tokenDigest(token) });
  clearSessionCookies(res);
}

/**
 * Revokes every session a user holds. Called on password change and MFA reset,
 * where the point is to evict whoever else might be holding a cookie.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { deletedCount } = await Session.deleteMany({ userId });
  return deletedCount ?? 0;
}

export function clearSessionCookies(res: Response): void {
  // Options must match those the cookie was set with, or the browser keeps it.
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(0), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, { ...csrfCookieOptions(0), maxAge: undefined });
}

export function readSessionToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
