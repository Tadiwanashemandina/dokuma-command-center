import { isApiError, type ApiError } from "@dokuma/shared";

/**
 * The single fetch wrapper every client request goes through.
 *
 * Paths are always relative ("/api/..."), so the browser talks to its own
 * origin: the Vite proxy forwards to Express in development, and the hosting
 * origin serves it in production. No API base URL is compiled into the bundle,
 * and no credential ever reaches client code — the session lives in an
 * httpOnly cookie the browser attaches on its own (inventory §10, D-4).
 */

const API_PREFIX = "/api";

/** Set by `issueSession`; read here and echoed back for double-submit CSRF. */
const CSRF_COOKIE = "dokuma_csrf";
const CSRF_HEADER = "X-CSRF-Token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: ApiError["fields"],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** The session is gone or was never established. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but this role may not do this. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Per-field validation detail, keyed by field name, for form display. */
  get fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const field of this.fields ?? []) {
      result[field.path] ??= field.message;
    }
    return result;
  }
}

/**
 * Called when any request comes back 401, so the app can drop its cached user
 * and send the browser to /login. Set once by the auth provider; kept as a
 * module-level hook rather than a React context so that non-component callers
 * (React Query's retry logic, for instance) can trigger it too.
 */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Picks the message to show for a failed response.
 *
 * Our API always answers with `{ error }` (shared/src/api.ts), and that
 * message is written for the user, so it wins whenever it is present. What is
 * left is the case where the response did not come from the API at all — an
 * empty or HTML body from the dev proxy, a load balancer, or a gateway,
 * because the server is down or restarting. "Request failed (500)" tells the
 * user nothing they can act on, so those get a message that does.
 */
function errorMessageFor(status: number, body: unknown): string {
  if (isApiError(body)) return body.error;

  if (status >= 500) {
    return "The server is not responding. It may be restarting — please try again in a moment.";
  }
  if (status === 404) {
    return "That endpoint does not exist. This part of the app may not be available yet.";
  }
  return `Request failed (${status})`;
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * Skips the automatic 401 handler. Used by the session bootstrap itself,
   * where a 401 is the expected "not signed in" answer rather than an
   * expired session worth redirecting on.
   */
  allowUnauthenticated?: boolean;
}

export async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const { allowUnauthenticated = false, ...requestInit } = init;
  const method = (requestInit.method ?? "GET").toUpperCase();

  const headers = new Headers(requestInit.headers);
  /**
   * A FormData body must NOT get an explicit Content-Type.
   *
   * multipart/form-data carries a generated boundary token in its header, and
   * only the browser knows what it is. Setting `multipart/form-data` by hand —
   * or, as this did before, defaulting to `application/json` — produces a
   * header without a boundary, and the server cannot parse a single field. The
   * upload then fails with "no file was uploaded" for a request that plainly
   * contains one.
   */
  const isFormData = typeof FormData !== "undefined" && requestInit.body instanceof FormData;
  if (requestInit.body !== undefined && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Double-submit CSRF: echo the cookie the server set. An attacker on another
  // origin can make the browser *send* that cookie but cannot *read* it to
  // build this header.
  if (!SAFE_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set(CSRF_HEADER, token);
  }

  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      // The session is an httpOnly cookie, so every request must carry
      // credentials for the server to see it at all.
      credentials: "include",
      ...requestInit,
      headers,
    });
  } catch {
    // fetch() rejects only on a network-level failure, which is worth
    // distinguishing from a server error the user could act on.
    throw new ApiRequestError(0, "Could not reach the server. Check your connection and try again.");
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Left as null: a non-JSON body did not come from our API, and the
      // error path below decides what to say about it.
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !allowUnauthenticated) {
      onUnauthenticated?.();
    }

    const fields = isApiError(body) ? body.fields : undefined;
    throw new ApiRequestError(response.status, errorMessageFor(response.status, body), fields);
  }

  // Successful responses are wrapped as `{ data: T }` (shared/src/api.ts).
  // Unwrapping here means no call site has to reach through the envelope.
  if (body !== null && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }

  return body as T;
}

/** Convenience wrappers so call sites read as verbs, not fetch options. */
export const api = {
  get: <T>(path: string, init?: ApiFetchOptions) => apiFetch<T>(path, { ...init, method: "GET" }),

  post: <T>(path: string, payload?: unknown, init?: ApiFetchOptions) =>
    apiFetch<T>(path, {
      ...init,
      method: "POST",
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),

  patch: <T>(path: string, payload?: unknown, init?: ApiFetchOptions) =>
    apiFetch<T>(path, {
      ...init,
      method: "PATCH",
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),

  delete: <T>(path: string, init?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...init, method: "DELETE" }),

  /**
   * POST a multipart body — file uploads.
   *
   * The FormData is passed through untouched so the browser sets
   * `Content-Type` with its own boundary; see the note in `apiFetch`. CSRF and
   * credentials are handled exactly as for any other mutating request.
   */
  postForm: <T>(path: string, body: FormData, init?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...init, method: "POST", body }),
};
