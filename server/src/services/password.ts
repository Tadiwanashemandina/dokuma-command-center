import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";

/**
 * Password hashing (inventory §4.2).
 *
 * Argon2id, not the `scryptSync` the shim used. Three reasons:
 *   - `scryptSync` blocks the event loop; every concurrent login serializes
 *     behind it. `argon2` hashes on libuv's threadpool.
 *   - Argon2id is memory-hard against GPU attack in a way scrypt's default
 *     parameters (the shim passed none) are not.
 *   - The encoded hash carries its own parameters, so raising the cost later
 *     does not invalidate existing hashes.
 *
 * Parameters follow OWASP's Password Storage Cheat Sheet for Argon2id:
 * 19 MiB, 2 iterations, parallelism 1.
 */

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must
 * deny the login, not 500 and leak that the account exists.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash should be re-hashed at next successful login,
 * because HASH_OPTIONS has been raised since it was written.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A dummy hash, verified against when no user matches the submitted email.
 *
 * Without it, a missing account returns in microseconds while a real one takes
 * ~50ms, and that difference enumerates valid emails regardless of how generic
 * the error message is (§4.2 requires generic failure messages; this is the
 * other half of the same requirement).
 *
 * Computed once at startup from a random string nobody can submit.
 */
let dummyHash: Promise<string> | null = null;

export function burnPasswordTime(password: string): Promise<boolean> {
  dummyHash ??= argon2.hash(
    `dummy:${Math.random()}:${Date.now()}`,
    HASH_OPTIONS,
  );
  return dummyHash.then((hash) => verifyPassword(hash, password));
}

/** Constant-time comparison for non-password secrets (recovery codes, tokens). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
