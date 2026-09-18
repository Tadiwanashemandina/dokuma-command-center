/**
 * Xero integration configuration.
 *
 * Follows the same fail-closed shape as `oneplatform/config.ts`, and for the
 * same reason: an unconfigured integration is a normal condition (it is the
 * state every developer runs in), so it must degrade to a stated reason rather
 * than throw at import time and take the whole finance module down with it.
 *
 * Read at call time, never cached at module scope — a deployment that sets the
 * variables after boot should not need a restart to pick them up.
 */

/**
 * What the integration is permitted to do.
 *
 *   disabled  — no credentials. No OAuth flow, no sync, no push. THE DEFAULT.
 *   read-only — pull from Xero, but never write to it. Batches destined for
 *               Xero are built and logged, then dropped.
 *   live      — pull and push.
 *
 * The default is reached by omission, so a missing variable can only make this
 * system quieter — never make it write entries into somebody's real accounting
 * ledger. `read-only` exists so a deployment can run the sync in production and
 * watch it reconcile correctly for a period before enabling the push.
 */
export type XeroMode = "disabled" | "read-only" | "live";

export interface XeroConfig {
  mode: XeroMode;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  scopes: string[];
  /** Why the integration is not live, for the settings screen. */
  reason: string | null;
}

/**
 * The scopes this integration needs, and nothing more.
 *
 *   offline_access        — required for a refresh token. Without it the
 *                           connection dies after 30 minutes and no scheduled
 *                           sync can ever run.
 *   accounting.transactions — bank transactions, both read and write. This is
 *                           the one write scope, and it is what the push needs.
 *   accounting.contacts.read — contact names for invoices and counterparties.
 *   accounting.reports.read  — P&L and Balance Sheet.
 *   accounting.settings.read — the chart of accounts, to link bank accounts.
 *
 * Deliberately NOT requested: `accounting.attachments`, `payroll.*`,
 * `files.*`, or any `.write` scope beyond transactions. A scope that is not
 * granted cannot be misused by a bug here, and Xero shows the full list to the
 * person authorising — asking for payroll access to sync a bank feed is how an
 * integration loses a finance team's trust.
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.transactions",
  "accounting.contacts.read",
  "accounting.reports.read",
  "accounting.settings.read",
] as const;

/** The read-only scope set, used when `XERO_MODE=read-only`. */
const XERO_SCOPES_READ_ONLY = [
  "offline_access",
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.reports.read",
  "accounting.settings.read",
] as const;

export function resolveXeroConfig(): XeroConfig {
  const clientId = process.env["XERO_CLIENT_ID"]?.trim() || null;
  const clientSecret = process.env["XERO_CLIENT_SECRET"] || null;
  const redirectUriRaw = process.env["XERO_REDIRECT_URI"]?.trim() || null;
  const requested = (process.env["XERO_MODE"]?.trim() as XeroMode | undefined) ?? "live";

  const disabled = (reason: string): XeroConfig => ({
    mode: "disabled",
    clientId,
    clientSecret: null,
    redirectUri: redirectUriRaw,
    scopes: [],
    reason,
  });

  if (!clientId || !clientSecret) {
    return disabled("XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set.");
  }

  if (!redirectUriRaw) {
    return disabled("XERO_REDIRECT_URI is not set.");
  }

  /**
   * The redirect URI must be https, and must match the one registered in the
   * Xero developer portal exactly.
   *
   * Enforcing https here rather than letting Xero reject it turns a confusing
   * `unauthorized_client` at the end of the consent flow into a clear message
   * before the flow starts. localhost is exempt — Xero itself permits
   * `http://localhost` for development, and the offline test harness needs it.
   */
  let parsed: URL;
  try {
    parsed = new URL(redirectUriRaw);
  } catch {
    return disabled("XERO_REDIRECT_URI is malformed.");
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    return disabled("XERO_REDIRECT_URI must use https.");
  }

  if (requested === "disabled") {
    return { ...disabled("XERO_MODE=disabled."), clientSecret: null };
  }

  const scopes =
    requested === "read-only" ? [...XERO_SCOPES_READ_ONLY] : [...XERO_SCOPES];

  return {
    mode: requested === "read-only" ? "read-only" : "live",
    clientId,
    clientSecret,
    redirectUri: redirectUriRaw,
    scopes,
    reason:
      requested === "read-only"
        ? "XERO_MODE=read-only — Xero is pulled from, but never written to."
        : null,
  };
}

/** True when the integration may write to Xero. */
export function canPushToXero(config: XeroConfig): boolean {
  return config.mode === "live";
}

/** Redacted view for the settings screen — never exposes the client secret. */
export function describeXeroConfig(config: XeroConfig): {
  mode: XeroMode;
  clientId: string | null;
  redirectUri: string | null;
  scopes: string[];
  reason: string | null;
} {
  return {
    mode: config.mode,
    // The client id is a public identifier (it appears in the consent URL the
    // browser is sent to), not a credential. The secret is never returned by
    // any code path.
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    reason: config.reason,
  };
}
