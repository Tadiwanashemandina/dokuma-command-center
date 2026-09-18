import "dotenv/config";
import { z } from "zod";

/**
 * Server-only environment. Nothing in this module may be imported by client/ —
 * it reads MongoDB credentials and session secrets. Vite never resolves this
 * file (it lives outside the client root and is not exposed via VITE_*).
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Origin allowed to send credentialed requests. The Vite dev server. */
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),

  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
  MONGODB_DATABASE: z.string().min(1).default("dokuma"),

  /**
   * Signing secret for the session cookie. Required in production; a
   * development default keeps the scaffold runnable before auth lands.
   */
  SESSION_SECRET: z.string().min(1).default("dev-only-insecure-session-secret"),

  /**
   * Idle timeout: a session dies this long after its last request.
   * Matches the 7-day `dokuma_local_session` maxAge the shim used
   * (inventory §4.2) so existing expectations carry over.
   */
  SESSION_IDLE_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),

  /**
   * Absolute lifetime: a session dies this long after login regardless of
   * activity, so a stolen cookie cannot be renewed indefinitely. No analogue
   * in the shim — this is new, and deliberately so.
   */
  SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().positive().default(24 * 30),

  /** Issuer label shown in the authenticator app during TOTP enrollment. */
  MFA_ISSUER: z.string().min(1).default("Dokuma Command Centre"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid server environment:\n${detail}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

if (isProduction && env.SESSION_SECRET === "dev-only-insecure-session-secret") {
  throw new Error("SESSION_SECRET must be set to a real value in production.");
}
