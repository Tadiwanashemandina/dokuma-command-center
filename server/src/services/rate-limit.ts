import { RateLimitWindow } from "../db/models/index.js";

/**
 * Fixed-window rate limiting, ported from `lib/rate-limit.ts` (inventory §4.6).
 *
 * The legacy module had three backends chosen at import time: Mongo TTL →
 * Upstash → in-memory. Only the Mongo one survives here. The inventory's
 * reasoning: it is already correct, already fixed-window, and already the
 * highest-priority backend whenever `MONGODB_URI` is set — which, in Express,
 * is always. Dropping Upstash removes a vendor and the fixed-vs-sliding
 * inconsistency between backends in one step.
 *
 * Limits are unchanged: login 5/60s, kpi-feed 30/60s.
 */

export interface RateLimitResult {
  success: boolean;
  /** Attempts left in this window. 0 once blocked. */
  remaining: number;
  /** Seconds until the window rolls over — the value for `Retry-After`. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
  /** Clears a key's counter. Used to forgive an IP after a *successful* login. */
  reset(identifier: string): Promise<void>;
}

function createMongoRateLimiter(
  prefix: string,
  maxRequests: number,
  windowMs: number,
): RateLimiter {
  const keyFor = (identifier: string, windowStart: number) =>
    `${prefix}:${identifier}:${windowStart}`;

  return {
    async limit(identifier) {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const windowEnd = windowStart + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));

      const record = await RateLimitWindow.findOneAndUpdate(
        { _id: keyFor(identifier, windowStart) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowEnd) } },
        { upsert: true, returnDocument: "after", lean: true },
      );

      // A failed upsert must fail closed. The legacy version defaulted to
      // `maxRequests + 1` for the same reason: if we cannot count, we block.
      const count = record?.count ?? maxRequests + 1;

      return {
        success: count <= maxRequests,
        remaining: Math.max(0, maxRequests - count),
        retryAfterSeconds,
      };
    },

    async reset(identifier) {
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      await RateLimitWindow.deleteOne({ _id: keyFor(identifier, windowStart) });
    },
  };
}

/** 5 attempts per 60s, per IP and (separately) per account. Unchanged from §4.6. */
export const loginRateLimit = createMongoRateLimiter("login", 5, 60_000);

/** 30 per 60s. The Group contract is frozen as-is (§10, D-13). */
export const kpiFeedRateLimit = createMongoRateLimiter("kpi-feed", 30, 60_000);

/** 10 TOTP guesses per 60s. New in this phase — a 6-digit code needs it. */
export const mfaChallengeRateLimit = createMongoRateLimiter("mfa-challenge", 10, 60_000);

/**
 * Client IP for rate-limit keying.
 *
 * `app.set("trust proxy", 1)` means Express has already parsed
 * `x-forwarded-for` into `req.ip`, so we read that rather than the raw header —
 * the legacy code split the header by hand and took the first entry, which is
 * the same value but trusts the *whole* chain rather than one proxy hop.
 * Falls back to "unknown", matching §4.6.
 */
export function clientIp(req: { ip?: string }): string {
  return req.ip ?? "unknown";
}
