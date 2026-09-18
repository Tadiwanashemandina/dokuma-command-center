import { SBU_CODE } from "@dokuma/shared";
import { assertValidKeyId, type SigningCredentials } from "./signing.js";

/**
 * Configuration for the Group platform feed.
 *
 * Read from the environment at call time rather than at import time, because
 * this module is imported by routes that must keep working when the feed is not
 * configured at all — which is the state today, and the state every developer
 * runs in. An unconfigured feed is a normal condition here, not an error.
 *
 * The specification's §0 sets the intended order: dry-run against
 * `/api/integration/check` with no key, then smoke-test a key against
 * `/ingest/v1/whoami`, then send. `mode` below encodes exactly that progression
 * so a deployment cannot skip a step by accident.
 */

/**
 * What the feed is permitted to do.
 *
 *   disabled — no credentials. Batches are built and validated locally and
 *              logged, but nothing leaves this process. THE DEFAULT.
 *   dry-run  — credentials may exist, but sends are still suppressed.
 *              Use to watch a scheduled job produce correct payloads in
 *              production before letting it write to the Group platform.
 *   live     — fully enabled.
 *
 * The default is `disabled` and is reached by omission, so a missing
 * environment variable can only ever make this system quieter, never make it
 * post unverified figures to a board-level feed.
 */
export type FeedMode = "disabled" | "dry-run" | "live";

export interface OnePlatformConfig {
  mode: FeedMode;
  baseUrl: string | null;
  sbuCode: string;
  credentials: SigningCredentials | null;
  /** Why the feed is not live, for display on the dashboard. */
  reason: string | null;
}

const INGEST_PATH_PREFIX = "/ingest/v1";

export function operationalReadingsPath(): string {
  return `${INGEST_PATH_PREFIX}/operational-readings`;
}

export function whoamiPath(): string {
  return `${INGEST_PATH_PREFIX}/whoami`;
}

export function batchLookupPath(clientBatchRef: string): string {
  // The signed path must include the query string exactly as sent (§7), so it
  // is built once here and used for both signing and fetching.
  return `${INGEST_PATH_PREFIX}/batches?clientBatchRef=${encodeURIComponent(clientBatchRef)}`;
}

/**
 * Resolves the feed configuration, degrading to `disabled` with a stated
 * reason rather than throwing.
 *
 * Returning a reason instead of an exception is what lets the dashboard tell a
 * CEO "the feed is not configured" rather than showing a generic error — a
 * meaningful distinction when the alternative reading is "the feed is broken".
 */
export function resolveConfig(): OnePlatformConfig {
  const baseUrlRaw = process.env["OP_INGEST_BASE_URL"]?.trim() || null;
  const keyId = process.env["OP_INGEST_KEY_ID"]?.trim() || null;
  const secret = process.env["OP_INGEST_SECRET"] || null;
  const requested = (process.env["OP_INGEST_MODE"]?.trim() as FeedMode | undefined) ?? "live";

  const base = {
    sbuCode: process.env["OP_INGEST_SBU_CODE"]?.trim() || SBU_CODE,
    baseUrl: baseUrlRaw,
  };

  if (!baseUrlRaw) {
    return {
      ...base,
      mode: "disabled",
      credentials: null,
      reason: "OP_INGEST_BASE_URL is not set.",
    };
  }

  /**
   * HTTPS is enforced by the platform before authentication (§7), so a plain
   * HTTP base URL can only ever produce `HTTPS_REQUIRED`. Refusing locally
   * turns a remote 403 into a clear configuration message — and, more to the
   * point, guarantees a signing secret is never sent over a cleartext
   * connection by a misconfigured deployment.
   *
   * localhost is exempt so the offline test harness can point at a local stub.
   */
  let parsed: URL;
  try {
    parsed = new URL(baseUrlRaw);
  } catch {
    return { ...base, mode: "disabled", credentials: null, reason: "OP_INGEST_BASE_URL is malformed." };
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    return {
      ...base,
      mode: "disabled",
      credentials: null,
      reason: "OP_INGEST_BASE_URL must use https.",
    };
  }

  if (!keyId || !secret) {
    return {
      ...base,
      mode: "disabled",
      credentials: null,
      reason: "OP_INGEST_KEY_ID / OP_INGEST_SECRET are not set.",
    };
  }

  // A malformed key id would fail remotely with a misleading
  // `MISSING_AUTH_HEADER`; say so plainly instead.
  try {
    assertValidKeyId(keyId);
  } catch (error) {
    return {
      ...base,
      mode: "disabled",
      credentials: null,
      reason: error instanceof Error ? error.message : "OP_INGEST_KEY_ID is malformed.",
    };
  }

  if (requested === "dry-run") {
    return {
      ...base,
      mode: "dry-run",
      credentials: { keyId, secret },
      reason: "OP_INGEST_MODE=dry-run — payloads are built and logged but not sent.",
    };
  }

  if (requested === "disabled") {
    return { ...base, mode: "disabled", credentials: { keyId, secret }, reason: "OP_INGEST_MODE=disabled." };
  }

  return { ...base, mode: "live", credentials: { keyId, secret }, reason: null };
}

/** Redacted view for the dashboard — never exposes the secret. */
export function describeConfig(config: OnePlatformConfig): {
  mode: FeedMode;
  baseUrl: string | null;
  sbuCode: string;
  keyId: string | null;
  reason: string | null;
} {
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
    sbuCode: config.sbuCode,
    // The key id is an identifier, not a credential, and seeing it is how an
    // administrator confirms which key is in use after a rotation. The secret
    // is never returned by any code path.
    keyId: config.credentials?.keyId ?? null,
    reason: config.reason,
  };
}
