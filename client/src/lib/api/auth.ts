import type { CurrentUser } from "@dokuma/shared";
import { ApiRequestError, api } from "@/lib/api-client";

/**
 * Typed client functions for /api/auth.
 *
 * These replace the Supabase browser client and the two Next route handlers
 * (`app/api/auth/login`, `app/api/auth/signout`) that the login page and the
 * sidebar called directly. Nothing here touches a credential: the session is
 * an httpOnly cookie the browser manages, so this module only ever exchanges
 * JSON with our own origin.
 */

/** Where the server says to go after a successful login. */
export interface LoginResult {
  user: CurrentUser;
  /**
   * The server decides this, not the client. An MFA-required role is sent to
   * enroll/verify regardless of the `next` they asked for (§4.4).
   */
  next: string;
  mfaNext: "enroll" | "verify" | null;
}

export function login(input: {
  email: string;
  password: string;
  next?: string;
}): Promise<LoginResult> {
  return api.post<LoginResult>("/auth/login", input, { allowUnauthenticated: true });
}

export function logout(): Promise<{ ok: true }> {
  // Not behind requireAuth server-side: signing out must work even when the
  // session has already expired, so the browser is never left holding a token.
  return api.post<{ ok: true }>("/auth/logout", undefined, { allowUnauthenticated: true });
}

/**
 * `GET /api/auth/me` — the current user plus the two things the client would
 * otherwise have to recompute: whether an MFA step is outstanding, and which
 * route this role lands on.
 */
export interface SessionUser extends CurrentUser {
  /** Non-null when this role must complete an MFA step before going anywhere. */
  mfaNext: "enroll" | "verify" | null;
  /** `roleHomePath(role)`, resolved server-side so the client never guesses. */
  homePath: string;
}

/**
 * The session bootstrap. Returns null rather than throwing on 401, because
 * "not signed in" is a normal answer here — it is what every first page load
 * gets before login.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    return await api.get<SessionUser>("/auth/me", { allowUnauthenticated: true });
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnauthenticated) {
      return null;
    }
    throw error;
  }
}

/* --------------------------------------------------------------------- *
 * MFA
 * --------------------------------------------------------------------- */

export interface MfaEnrollResult {
  /** The base32 secret, shown for manual entry when a camera is unavailable. */
  secret: string;
  /** The `otpauth://` URI the QR code encodes. */
  otpauthUrl: string;
  /** A data: URL the server already rendered, so the client ships no QR lib. */
  qrCodeDataUrl: string;
}

export function enrollMfa(): Promise<MfaEnrollResult> {
  return api.post<MfaEnrollResult>("/auth/mfa/enroll");
}

export interface MfaVerifyResult {
  user: CurrentUser;
  /** Shown exactly once, at enrollment. */
  recoveryCodes?: string[];
  next: string;
}

/** Confirms a freshly enrolled factor with a first TOTP code. */
export function verifyMfaEnrollment(code: string): Promise<MfaVerifyResult> {
  return api.post<MfaVerifyResult>("/auth/mfa/enroll/verify", { code });
}

/** Satisfies the TOTP challenge for an already-enrolled factor. */
export function challengeMfa(code: string): Promise<MfaVerifyResult> {
  return api.post<MfaVerifyResult>("/auth/mfa/challenge", { code });
}

/** Uses a single-use recovery code in place of a TOTP code. */
export function recoverMfa(recoveryCode: string): Promise<MfaVerifyResult> {
  return api.post<MfaVerifyResult>("/auth/mfa/recover", { recoveryCode });
}

/* --------------------------------------------------------------------- *
 * Account invites and set-password links
 * --------------------------------------------------------------------- */

export interface InvitedUser {
  user: { id: string; email: string; fullName: string | null; role: string };
  /** Relative path, so it works against whatever origin serves the client. */
  setPasswordPath: string;
  expiresAt: string;
}

/** Admin-only. Creates an account and returns its one-time set-password link. */
export function inviteUser(input: {
  email: string;
  fullName: string;
  role: string;
}): Promise<InvitedUser> {
  return api.post<InvitedUser>("/auth/invite", input);
}

export interface SetPasswordTarget {
  email: string;
  purpose: "invite" | "reset";
}

/**
 * Validates a link before showing the form, so an expired token produces a
 * clear message rather than a failure after the user has typed a password.
 */
export function inspectSetPasswordToken(token: string): Promise<SetPasswordTarget> {
  return api.get<SetPasswordTarget>(`/auth/set-password?token=${encodeURIComponent(token)}`, {
    allowUnauthenticated: true,
  });
}

export function setPassword(input: { token: string; password: string }): Promise<{ email: string }> {
  return api.post<{ email: string }>("/auth/set-password", input, { allowUnauthenticated: true });
}
