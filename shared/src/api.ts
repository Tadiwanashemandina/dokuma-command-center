/**
 * The API response envelope shared by the Express server and the Vite client.
 *
 * Inventory §3.2: every endpoint returns either a success payload or a
 * consistent error shape. Status codes carry the meaning (401/403/429/400);
 * the body carries a human-readable message and, for validation failures,
 * the per-field detail zod produced.
 */

/** Successful response body. */
export interface ApiSuccess<T> {
  data: T;
}

/** A single field-level validation failure, flattened from a zod issue. */
export interface ApiFieldError {
  path: string;
  message: string;
}

/** Error response body. */
export interface ApiError {
  error: string;
  /** Present only on 400 validation failures. */
  fields?: ApiFieldError[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError(body: unknown): body is ApiError {
  return typeof body === "object" && body !== null && "error" in body;
}

/**
 * Error codes the client branches on. Kept as a union rather than free-form
 * strings so a renamed code is a compile error, not a silent behavior change.
 */
export const API_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

/** Shape returned by GET /api/auth/me — the client's session bootstrap. */
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  role: import("./roles.js").UserRole;
  /** True once the caller has satisfied the TOTP challenge (AAL2 equivalent). */
  mfaVerified: boolean;
  /** True when this caller's role requires a verified TOTP factor. */
  mfaRequired: boolean;
}

/**
 * Error body returned by the auth middleware on 401/403.
 *
 * The legacy app redirected server-side (`redirect("/login")`,
 * `redirect("/account/mfa/verify")`). An API cannot redirect a fetch
 * meaningfully, so the destination travels as data and the client routes on it:
 *
 *   401 unauthenticated          → /login
 *   403 forbidden                → the user's role home
 *   403 mfa_required + "enroll"  → /account/mfa/enroll
 *   403 mfa_required + "verify"  → /account/mfa/verify
 */
export interface AuthErrorBody extends ApiError {
  reason: "unauthenticated" | "forbidden" | "mfa_required";
  /** Present only when `reason` is "mfa_required". */
  next?: "enroll" | "verify";
}

/** Body of a successful POST /api/auth/login. */
export interface LoginResponse {
  user: CurrentUser;
  /** Where the client should navigate. MFA takes priority over the requested path. */
  next: string;
  /** Non-null when this role must complete MFA before proceeding. */
  mfaNext: "enroll" | "verify" | null;
}

/** Body of GET /api/auth/me — CurrentUser plus what the client needs to route. */
export interface SessionResponse extends CurrentUser {
  mfaNext: "enroll" | "verify" | null;
  homePath: string;
}

/** Body of a successful POST /api/auth/mfa/enroll. */
export interface MfaEnrollResponse {
  /** For manual entry when the QR code cannot be scanned. */
  secret: string;
  otpauthUrl: string;
  /** `data:image/png;base64,...`, ready for an <img src>. */
  qrCodeDataUrl: string;
}

/** Body of a successful POST /api/auth/mfa/enroll/verify. */
export interface MfaEnrollVerifyResponse {
  /** Plaintext, returned exactly once — only hashes are stored server-side. */
  recoveryCodes: string[];
  next: string;
}

/** Shape returned by GET /api/health. */
export interface HealthResponse {
  status: "ok";
  uptime: number;
  timestamp: string;
}
