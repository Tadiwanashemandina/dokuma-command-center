import { z } from "zod";
import { USER_ROLES } from "@dokuma/shared";

/**
 * Request validation for the auth endpoints.
 *
 * Every schema is `.strict()`: an unexpected key is a 400, not silently
 * dropped. That turns a client sending `{email, password, role: "admin"}` into
 * an immediate, visible error rather than something a handler might one day
 * spread into a document.
 */

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    // No max/complexity rules on *login* — the stored password was validated
    // when it was set, and rejecting a long password here only ever breaks a
    // legitimate passphrase. The Argon2 cost is bounded by the 1mb body limit.
    password: z.string().min(1, "Enter your password."),
    /**
     * Post-login destination, echoed back for the client to navigate to.
     * Constrained to a site-relative path: reflecting an arbitrary URL makes
     * this an open redirect, and "//evil.com" is protocol-relative, so a bare
     * startsWith("/") check is not enough.
     */
    next: z
      .string()
      .regex(/^\/(?!\/)[\w\-./?=&%#]*$/, "Invalid redirect target.")
      .optional(),
  })
  .strict();

export const mfaVerifySchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  })
  .strict();

export const mfaRecoverySchema = z
  .object({
    recoveryCode: z.string().trim().min(1, "Enter a recovery code."),
  })
  .strict();

/**
 * Password change. The current password is required even though the caller is
 * already authenticated — it is what stops someone using an unattended logged-in
 * browser from locking the real owner out of their account.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters.")
      // Length is the requirement that actually matters. Composition rules
      // ("one uppercase, one symbol") push people toward "Password1!" and are
      // explicitly discouraged by NIST SP 800-63B, so there are none here.
      .max(256, "Use at most 256 characters."),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type MfaRecoveryInput = z.infer<typeof mfaRecoverySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Account invites and set-password links
// ---------------------------------------------------------------------------

/** Admin-issued invite. The role list comes from @dokuma/shared, so an
 *  invalid role is a 400 rather than a document the enum rejects later. */
export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  fullName: z.string().trim().min(1, "Enter a name.").max(200),
  role: z.enum(USER_ROLES),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/**
 * Redeeming a set-password link. The same 12-character minimum as
 * `changePasswordSchema`, and for the same reason — length is what matters,
 * composition rules are counterproductive (NIST SP 800-63B).
 */
export const setPasswordSchema = z.object({
  token: z.string().min(1, "This link is missing its token."),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(256, "Use at most 256 characters."),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
