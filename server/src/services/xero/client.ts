import { HttpError } from "../../middleware/http-error.js";
import { getAccessToken } from "./auth.js";

/**
 * The Xero API HTTP client.
 *
 * Thin on purpose: it handles auth, rate limits, retries and error shape, and
 * knows nothing about accounting. The resource modules build the URLs and
 * interpret the payloads.
 *
 * Xero's rate limits are hard and per-tenant:
 *   - 60 calls per minute, per tenant
 *   - 5,000 calls per day, per tenant
 *   - 5 concurrent calls per tenant
 *
 * Exceeding them returns 429 with a `Retry-After` header and an
 * `X-Rate-Limit-Problem` header naming which limit was hit. A sync that
 * ignores this does not fail cleanly — it burns the daily quota in minutes and
 * locks out every other integration on the same organisation for the rest of
 * the day, including whatever the finance team uses directly.
 */

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/** Xero's own concurrency ceiling. Exceeding it is an immediate 429. */
const MAX_CONCURRENT = 5;

/**
 * A minimal per-tenant concurrency gate.
 *
 * Not a general-purpose limiter — it exists solely to keep this process from
 * breaching the documented ceiling. Requests queue rather than fail, because
 * a sync that drops pages under load would leave gaps in the ledger that
 * nothing would ever notice.
 */
const inFlight = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

async function acquire(tenantId: string): Promise<void> {
  const current = inFlight.get(tenantId) ?? 0;
  if (current < MAX_CONCURRENT) {
    inFlight.set(tenantId, current + 1);
    return;
  }

  await new Promise<void>((resolve) => {
    const queue = waiting.get(tenantId) ?? [];
    queue.push(resolve);
    waiting.set(tenantId, queue);
  });
  inFlight.set(tenantId, (inFlight.get(tenantId) ?? 0) + 1);
}

function release(tenantId: string): void {
  inFlight.set(tenantId, Math.max(0, (inFlight.get(tenantId) ?? 1) - 1));
  const queue = waiting.get(tenantId);
  const next = queue?.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface XeroRequestOptions {
  method?: "GET" | "POST" | "PUT";
  /** Query parameters. Undefined values are dropped rather than sent empty. */
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /**
   * `If-Modified-Since` for an incremental pull. Xero compares this against
   * `UpdatedDateUTC` server-side and returns only what changed.
   */
  modifiedSince?: Date | null;
  /**
   * Sent as `Idempotency-Key`. Xero collapses repeats of the same key for 24
   * hours, which is what makes a retried push safe.
   */
  idempotencyKey?: string;
}

/** How many times to retry a 429 or a 5xx before giving up. */
const MAX_ATTEMPTS = 4;

/**
 * Calls the Xero Accounting API.
 *
 * Retries on 429 (honouring `Retry-After`) and on 5xx with exponential
 * backoff. Does NOT retry on 4xx other than 429 — a 400 means the request was
 * wrong, and sending it again produces the same 400 while consuming quota.
 */
export async function xeroRequest<T>(
  tenantId: string,
  path: string,
  options: XeroRequestOptions = {},
): Promise<T> {
  await acquire(tenantId);

  try {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Re-read each attempt: a retry after a long backoff may outlive the
      // access token that was valid when the first attempt started.
      const accessToken = await getAccessToken(tenantId);

      const url = new URL(`${XERO_API_BASE}${path}`);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        Accept: "application/json",
      };

      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
      if (options.modifiedSince) {
        // Xero wants this without the milliseconds component.
        headers["If-Modified-Since"] = options.modifiedSince
          .toISOString()
          .replace(/\.\d{3}Z$/, "");
      }

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method: options.method ?? "GET",
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (error) {
        // Network-level failure. Retryable.
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(2 ** attempt * 500);
        continue;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const problem = response.headers.get("x-rate-limit-problem") ?? "unknown";

        /**
         * The daily limit is not worth waiting out — `Retry-After` on a daily
         * breach can be hours, and holding a request open that long is worse
         * than failing with a clear message the sync can report and resume
         * from tomorrow.
         */
        if (problem.toLowerCase().includes("day")) {
          throw new HttpError(
            429,
            "Xero's daily API limit for this organisation has been reached. The sync will resume tomorrow.",
          );
        }

        if (attempt === MAX_ATTEMPTS) {
          throw new HttpError(429, `Xero rate limit (${problem}) persisted after ${MAX_ATTEMPTS} attempts.`);
        }

        // `Retry-After` is in seconds; fall back to backoff if absent.
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
        continue;
      }

      if (response.status >= 500) {
        lastError = new HttpError(502, `Xero returned ${response.status}.`);
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(2 ** attempt * 500);
        continue;
      }

      /**
       * 304 on a conditional GET means nothing changed since the cursor. That
       * is a normal, common outcome for an incremental sync — most runs on
       * most resources return it — so it is signalled as an empty result
       * rather than an error.
       */
      if (response.status === 304) {
        return { Status: "OK", __notModified: true } as T;
      }

      const text = await response.text();

      if (!response.ok) {
        // Xero's validation errors are detailed and name the offending field.
        // Truncated rather than dropped: the detail is what makes a mapping
        // bug findable, but a full payload echo could be large.
        throw new HttpError(
          response.status === 404 ? 404 : 400,
          `Xero request failed (${response.status}): ${text.slice(0, 800)}`,
        );
      }

      return text ? (JSON.parse(text) as T) : ({} as T);
    }

    if (lastError instanceof Error) throw lastError;
    throw new HttpError(502, "Xero request failed after retries.");
  } finally {
    release(tenantId);
  }
}

/**
 * Pages through a Xero collection.
 *
 * Xero returns 100 records per page and signals the end by returning fewer
 * than a full page — there is no total count and no next-page cursor. The
 * `page` parameter is 1-based.
 *
 * `hardPageLimit` bounds a single run. Without it, a first-ever sync of a
 * large organisation can walk thousands of pages, exhaust the daily quota and
 * leave the cursor un-advanced so the next run starts over and does it again.
 * Stopping at the limit leaves the cursor where it was, so the following run
 * resumes rather than restarts.
 */
export async function xeroPaged<TItem>(
  tenantId: string,
  path: string,
  extract: (payload: Record<string, unknown>) => TItem[] | undefined,
  options: XeroRequestOptions & { hardPageLimit?: number } = {},
): Promise<{ items: TItem[]; truncated: boolean }> {
  const pageSize = 100;
  const hardPageLimit = options.hardPageLimit ?? 50;
  const items: TItem[] = [];

  for (let page = 1; page <= hardPageLimit; page += 1) {
    const payload = await xeroRequest<Record<string, unknown>>(tenantId, path, {
      ...options,
      query: { ...options.query, page },
    });

    /**
     * 304 — nothing changed since the cursor. This is the COMPLETE, normal
     * outcome for most runs on most resources, not a partial one.
     *
     * It must return `truncated: false`. Falling through to the `true` at the
     * bottom of the loop would tell the caller more pages remain, so
     * `markFinished` would never advance the cursor again — and the sync would
     * re-request an ever-widening window forever while reporting `status: "ok"`.
     */
    if (payload["__notModified"] === true) {
      return { items, truncated: false };
    }

    const batch = extract(payload) ?? [];
    items.push(...batch);

    if (batch.length < pageSize) {
      return { items, truncated: false };
    }
  }

  // Every page up to the hard limit was full, so there is more behind it. The
  // cursor is deliberately NOT advanced on this outcome; the next run resumes.
  return { items, truncated: true };
}
