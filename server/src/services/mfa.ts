import { authenticator } from "otplib";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import QRCode from "qrcode";
import { MFA_REQUIRED_ROLES, type UserRole } from "@dokuma/shared";
import type { UserDocument } from "../db/models/index.js";
import { env } from "../config/env.js";

/**
 * TOTP multi-factor auth (inventory §4.4), replacing Supabase's MFA API.
 *
 * The Supabase quirk SECURITY.md documents — `listFactors().totp` contains only
 * *verified* factors, unverified ones appear only in `.all`, so the enroll page
 * had to clear stale unverified factors before re-enrolling — does not survive
 * the port. It was an artifact of that API's shape. Here the state is explicit
 * on the User model: `mfa.pendingSecret` is an enrollment in progress,
 * `mfa.secret` is a verified factor, and starting a new enrollment simply
 * overwrites `pendingSecret`. There is no stale-factor cleanup to forget.
 */

// A one-step window either side: a 30s period is unforgiving when the phone's
// clock drifts a few seconds. Supabase allowed the same tolerance.
authenticator.options = { window: 1 };

/** Roles that must hold a verified factor. admin/exec deliberately exempt (§4.4). */
export function isMfaRequiredForRole(role: UserRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** True once a *verified* factor exists — the `hasVerifiedTotpFactor` analogue. */
export function hasVerifiedFactor(user: UserDocument): boolean {
  return Boolean(user.mfa?.secret);
}

export function generateSecret(): string {
  return authenticator.generateSecret();
}

/** `otpauth://` URI for the authenticator app, plus a QR rendering of it. */
export async function buildEnrollment(
  email: string,
  secret: string,
): Promise<{ otpauthUrl: string; qrCodeDataUrl: string }> {
  const otpauthUrl = authenticator.keyuri(email, env.MFA_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrCodeDataUrl };
}

/** Verifies a 6-digit code against a secret. Never throws on malformed input. */
export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

/**
 * Recovery codes — the escape hatch when the authenticator device is lost.
 *
 * Returned in plaintext exactly once, at enrollment, and stored only as Argon2
 * hashes: a recovery code bypasses the second factor, so it is a password
 * equivalent and gets password-equivalent storage.
 */
const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    // 10 hex chars, split for legibility: "a1b2c-3d4e5".
    const raw = randomBytes(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => argon2.hash(code)));
}

/**
 * Consumes a recovery code if it matches. Returns the remaining hashes, with
 * the used one removed — single-use is the point.
 *
 * Every candidate is checked even after a match, so the time taken does not
 * reveal which code matched or how many remain.
 */
export async function consumeRecoveryCode(
  storedHashes: string[],
  submitted: string,
): Promise<{ matched: boolean; remaining: string[] }> {
  const normalized = submitted.trim().toLowerCase();
  const results = await Promise.all(
    storedHashes.map((hash) => argon2.verify(hash, normalized).catch(() => false)),
  );

  const matchIndex = results.indexOf(true);
  if (matchIndex === -1) return { matched: false, remaining: storedHashes };

  return {
    matched: true,
    remaining: storedHashes.filter((_, index) => index !== matchIndex),
  };
}
