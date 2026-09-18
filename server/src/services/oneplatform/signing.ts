import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * `OP-HMAC-SHA256-V1` request signing for the Group platform's ingest API.
 *
 * Transcribed from §7 of the KPI & Ingestion Specification. The specification
 * recommends copying its reference implementation rather than writing this from
 * scratch; that file is not in this repository, so this is written directly
 * against the stated canonical form, with the two documented traps encoded as
 * types rather than left to a caller to remember:
 *
 *   1. The timestamp is a 10-digit EPOCH INTEGER, not ISO-8601.
 *   2. The signature carries a `v1=` prefix. Bare hex is rejected.
 *
 * ---------------------------------------------------------------------------
 * The serialise-once rule
 * ---------------------------------------------------------------------------
 * The specification names re-serialising the body after signing as "the single
 * most common bug": the hash covers the bytes on the wire and is verified
 * before anything parses them, so `JSON.stringify` must run ONCE and that exact
 * string must be both hashed and sent.
 *
 * This module makes that structurally impossible to get wrong. `signRequest()`
 * takes and returns the body as a `string`, and returns it alongside the
 * headers, so the only body a caller can send is the one that was hashed. It
 * never accepts an object — an object would have to be stringified somewhere,
 * and "somewhere" is where the bug lives.
 */

export const SIGNING_SCHEME = "OP-HMAC-SHA256-V1";

/** §7: `opk_` + exactly 20 characters of A–Z2–7 (Crockford-ish base32). */
const KEY_ID_RE = /^opk_[A-Z2-7]{20}$/;

/** §7: 16–64 characters of `A–Za–z0–9_-`. A UUID fits. */
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface SigningCredentials {
  keyId: string;
  secret: string;
}

export interface SignedRequest {
  /** Ready to spread into `fetch`'s `headers`. */
  headers: Record<string, string>;
  /** The EXACT bytes that were hashed. Send this, never a re-encoding. */
  body: string;
  /** Echoed into the dispatch log so a request can be traced after the fact. */
  nonce: string;
  timestamp: string;
}

export class SigningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningConfigError";
  }
}

/**
 * Validates a key id's shape.
 *
 * §7 notes all four headers are regex-checked BEFORE anything else, so a
 * malformed key id fails with `MISSING_AUTH_HEADER` even when the signature
 * would have been correct. Catching it here turns a confusing 401 from a
 * remote server into a clear local error at configuration time.
 */
export function assertValidKeyId(keyId: string): void {
  if (!KEY_ID_RE.test(keyId)) {
    throw new SigningConfigError(
      "OP_INGEST_KEY_ID must be 'opk_' followed by exactly 20 characters of A-Z2-7.",
    );
  }
}

/**
 * The canonical string — six lines joined with `\n`, no trailing newline (§7).
 *
 *   OP-HMAC-SHA256-V1
 *   POST
 *   /ingest/v1/operational-readings
 *   1789704000
 *   9f2c1b7e-...
 *   <sha256 hex of the raw request body bytes>
 *
 * Exported for the offline verification script, which asserts this function
 * reproduces the specification's worked example byte for byte. A signing
 * implementation that is never checked against a known vector is a signing
 * implementation nobody can trust.
 */
export function canonicalString(params: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHashHex: string;
}): string {
  return [
    SIGNING_SCHEME,
    params.method.toUpperCase(),
    params.path,
    params.timestamp,
    params.nonce,
    params.bodyHashHex,
  ].join("\n");
}

/** sha256 of the raw body bytes, lowercase hex. */
export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Signs a request.
 *
 * `path` must include any query string — §7 states the signed path carries it,
 * so signing a bare path and fetching one with `?foo=bar` produces a signature
 * the server will not reproduce.
 */
export function signRequest(params: {
  method: string;
  path: string;
  body: string;
  credentials: SigningCredentials;
  /** Injectable for the test vector; defaults to now. */
  timestamp?: string;
  nonce?: string;
}): SignedRequest {
  const { credentials } = params;
  assertValidKeyId(credentials.keyId);

  if (!credentials.secret) {
    throw new SigningConfigError("OP_INGEST_SECRET is empty.");
  }

  if (!params.path.startsWith("/")) {
    throw new SigningConfigError(`Signed path must be absolute, got '${params.path}'.`);
  }

  // Epoch SECONDS, as a 10-digit integer string. Not milliseconds, not ISO.
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = params.nonce ?? randomUUID();

  if (!/^\d{10}$/.test(timestamp)) {
    throw new SigningConfigError(`Timestamp must be 10 epoch seconds, got '${timestamp}'.`);
  }
  if (!NONCE_RE.test(nonce)) {
    throw new SigningConfigError(`Nonce must be 16-64 chars of [A-Za-z0-9_-], got '${nonce}'.`);
  }

  const bodyHashHex = hashBody(params.body);
  const canonical = canonicalString({
    method: params.method,
    path: params.path,
    timestamp,
    nonce,
    bodyHashHex,
  });

  const mac = createHmac("sha256", credentials.secret).update(canonical, "utf8").digest("hex");

  return {
    headers: {
      "content-type": "application/json",
      "x-op-key-id": credentials.keyId,
      "x-op-timestamp": timestamp,
      "x-op-nonce": nonce,
      // The `v1=` prefix is mandatory (§7). Bare hex is rejected.
      "x-op-signature": `v1=${mac}`,
    },
    // Returned rather than re-derived, so the caller physically cannot send
    // different bytes from the ones that were hashed.
    body: params.body,
    nonce,
    timestamp,
  };
}

/**
 * Constant-time comparison of two `v1=`-prefixed signatures.
 *
 * Not needed to SEND, but this platform may one day receive a signed callback,
 * and a signature compared with `===` leaks its bytes through timing. Provided
 * here so that verification, if it is ever added, has no reason to reach for
 * the naive comparison.
 */
export function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal; compare lengths first and return a constant-time result.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
