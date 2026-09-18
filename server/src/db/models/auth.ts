import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { uuidRef, timestampOptions } from "../types.js";
import type { UserDoc } from "./core.js";

/**
 * Authentication-owned models: sessions and rate-limit windows.
 *
 * Neither has a Postgres counterpart in the migration set — Supabase Auth
 * owned sessions, and `rate_limit_windows` was created by the in-tree shim
 * rather than a migration. They live here rather than in core.ts because
 * nothing outside the auth layer reads them.
 */

// ---------------------------------------------------------------------------
// Sessions — §4.2
// ---------------------------------------------------------------------------

/**
 * Server-side opaque sessions.
 *
 * The cookie carries a random token and nothing else; every claim — role, AAL,
 * expiry — is read from this collection per request. That costs one indexed
 * lookup, and buys three things a JWT cannot:
 *
 *   1. Revocation is a delete, effective on the next request, rather than at
 *      the end of an access token's TTL.
 *   2. A role change takes effect immediately. Role drives every authorization
 *      check in §4.3, so a stale role inside a token is a live authz bug.
 *   3. MFA step-up (§4.4) is a field update, not a token re-issue.
 *
 * `_id` is the SHA-256 of the cookie token, never the token itself, so a
 * leaked database dump yields no usable session cookies. Hashing with SHA-256
 * rather than Argon2 is correct here: the token is already 256 bits of
 * entropy, so there is nothing to brute-force and nothing a slow hash defends.
 */
const sessionSchema = new Schema(
  {
    /** SHA-256 hex of the cookie token. */
    _id: { type: String, required: true },

    userId: uuidRef("User", { required: true, index: true }),

    /**
     * Assurance level, mirroring Supabase's AAL. `aal1` is password-only;
     * `aal2` means this session passed a TOTP challenge. Roles in
     * MFA_REQUIRED_ROLES must reach aal2 before `requireRole` admits them.
     */
    aal: { type: String, enum: ["aal1", "aal2"], default: "aal1" },

    /** Idle expiry, pushed forward on use. */
    expiresAt: { type: Date, required: true },

    /**
     * Hard ceiling, fixed at login and never extended. Without it, an attacker
     * holding a stolen cookie renews it indefinitely just by using it.
     */
    absoluteExpiresAt: { type: Date, required: true },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { ...timestampOptions, _id: false },
);

/**
 * Mongo reaps idle-expired rows on its own. This is a safety net for sessions
 * nothing ever revisits, not the enforcement path — the TTL monitor runs about
 * once a minute, so `loadSession` still checks `expiresAt` itself rather than
 * trusting a row's absence.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_sessions_expires_at" });

export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session: Model<SessionDoc> = model<SessionDoc>("Session", sessionSchema, "sessions");

/**
 * Hydrated aliases for the two documents the auth layer mutates in place
 * (`session.save()`, `user.save()`). The plain `*Doc` types describe the shape
 * of the data; these describe a live Mongoose document.
 */
export type SessionDocument = HydratedDocument<SessionDoc>;
export type UserDocument = HydratedDocument<UserDoc>;

// ---------------------------------------------------------------------------
// Rate limiting — §4.6
// ---------------------------------------------------------------------------

/**
 * Fixed-window counters, ported from `lib/rate-limit.ts`.
 *
 * The legacy module chose between three backends at import time (Mongo TTL →
 * Upstash → in-memory). Only the Mongo one survives: it was already the
 * highest-priority backend whenever MONGODB_URI was set, which in Express is
 * always. Dropping Upstash removes a vendor and the fixed-vs-sliding
 * inconsistency between backends in one step.
 *
 * `_id` is `${prefix}:${identifier}:${windowStart}`, which makes the increment
 * a single upsert with no read-modify-write race.
 */
const rateLimitWindowSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { _id: false, versionKey: false },
);

rateLimitWindowSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "ttl_rate_limit_windows_expires_at" },
);

export type RateLimitWindowDoc = InferSchemaType<typeof rateLimitWindowSchema>;
export const RateLimitWindow: Model<RateLimitWindowDoc> = model<RateLimitWindowDoc>(
  "RateLimitWindow",
  rateLimitWindowSchema,
  "rate_limit_windows",
);

// ---------------------------------------------------------------------------
// Password-set tokens — account invites and password resets
// ---------------------------------------------------------------------------

/**
 * One-time tokens that let someone set a password without knowing the old one.
 *
 * Supabase Auth provided this (invite links, recovery emails); nothing
 * replaced it when Supabase went, so an admin could only create an account by
 * choosing a password on the user's behalf and sending it to them — over
 * whatever channel, with no expiry and no forced rotation.
 *
 * Same storage shape as a session, for the same reasons: `_id` is the SHA-256
 * of the token, so the database never holds anything replayable, and the raw
 * token exists only in the link. A short TTL bounds the window in which a
 * leaked link is useful.
 */
const passwordSetTokenSchema = new Schema(
  {
    /** SHA-256 hex of the token in the link. */
    _id: { type: String, required: true },

    userId: uuidRef("User", { required: true, index: true }),

    /**
     * `invite` for a brand-new account, `reset` for an existing one. Only the
     * wording differs today, but an audit row that cannot tell a first-time
     * setup from a credential reset is much less useful during an incident.
     */
    purpose: { type: String, required: true, enum: ["invite", "reset"] },

    expiresAt: { type: Date, required: true },

    /** Set when redeemed. A used token is kept, not deleted, so the audit
     * trail shows when it was consumed rather than merely that it vanished. */
    usedAt: { type: Date, default: null },

    /** Who issued it — null for a self-service reset request. */
    createdBy: uuidRef("User", { required: false }),
  },
  { ...timestampOptions, _id: false },
);

/**
 * Reaps tokens a week past expiry rather than at expiry, so a redeemed or
 * expired token still explains itself if someone asks why a link failed.
 */
passwordSetTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60, name: "ttl_password_set_tokens_expires_at" },
);

export type PasswordSetTokenDoc = InferSchemaType<typeof passwordSetTokenSchema>;
export const PasswordSetToken: Model<PasswordSetTokenDoc> = model<PasswordSetTokenDoc>(
  "PasswordSetToken",
  passwordSetTokenSchema,
  "password_set_tokens",
);

// ---------------------------------------------------------------------------
// Audit action vocabulary — §4.7
// ---------------------------------------------------------------------------

/**
 * The authentication slice of the `audit_log.action` vocabulary. A const
 * object rather than free-form strings, so a typo is a compile error instead
 * of a row nobody can query.
 */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCEEDED: "auth.login.succeeded",
  LOGIN_FAILED: "auth.login.failed",
  LOGIN_RATE_LIMITED: "auth.login.rate_limited",
  LOGIN_LOCKED: "auth.login.locked",
  LOGOUT: "auth.logout",
  SESSION_REVOKED_ALL: "auth.session.revoked_all",
  MFA_ENROLL_STARTED: "auth.mfa.enroll_started",
  MFA_ENROLL_VERIFIED: "auth.mfa.enroll_verified",
  MFA_CHALLENGE_SUCCEEDED: "auth.mfa.challenge_succeeded",
  MFA_CHALLENGE_FAILED: "auth.mfa.challenge_failed",
  MFA_RECOVERY_USED: "auth.mfa.recovery_used",
  MFA_RESET: "auth.mfa.reset",
  PASSWORD_CHANGED: "auth.password.changed",
  /** An admin created an account and issued a set-password link. */
  USER_INVITED: "auth.user.invited",
  /** A set-password link was redeemed. */
  PASSWORD_SET_VIA_TOKEN: "auth.password.set_via_token",
  /** An admin reissued a set-password link for an existing account. */
  PASSWORD_RESET_ISSUED: "auth.password.reset_issued",

  // Administrative changes to an account. Each of these alters what somebody
  // can see or do, which is exactly what an audit trail exists to record.
  USER_ROLE_CHANGED: "admin.user.role_changed",
  USER_DISABLED: "admin.user.disabled",
  USER_ENABLED: "admin.user.enabled",
  USER_UNLOCKED: "admin.user.unlocked",
} as const;
