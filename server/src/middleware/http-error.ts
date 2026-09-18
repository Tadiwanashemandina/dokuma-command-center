/**
 * `HttpError` and its auth-flavored subclass, in their own module so that
 * `error.ts` (which renders them) and `auth.ts` (which throws them) do not
 * import each other. Everything else imports from here.
 */

/** An error carrying an intended HTTP status. Services throw these. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * An auth failure carrying the reason code the client routes on.
 *
 * The legacy guards redirected; an API cannot, so the destination travels as
 * data instead (inventory §4.3, §4.4):
 *
 *   redirect("/login")                → 401 reason: "unauthenticated"
 *   redirect("/")                     → 403 reason: "forbidden"
 *   redirect("/account/mfa/enroll")   → 403 reason: "mfa_required", next: "enroll"
 *   redirect("/account/mfa/verify")   → 403 reason: "mfa_required", next: "verify"
 */
export class AuthError extends HttpError {
  constructor(
    status: number,
    message: string,
    readonly reason: "unauthenticated" | "forbidden" | "mfa_required",
    readonly next?: "enroll" | "verify",
  ) {
    super(status, message);
    this.name = "AuthError";
  }
}
