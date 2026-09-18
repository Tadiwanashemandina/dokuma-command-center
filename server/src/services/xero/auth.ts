import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { XeroConnection } from "../../db/models/index.js";
import { HttpError } from "../../middleware/http-error.js";
import { env } from "../../config/env.js";
import { resolveXeroConfig, type XeroConfig } from "./config.js";

/**
 * Xero OAuth 2.0 — the authorization-code flow, token refresh, and tenant
 * resolution.
 *
 * Implemented directly against Xero's token endpoint rather than through
 * `xero-node`'s `XeroClient` session helpers. The SDK's helpers assume they
 * own an Express session object and store the token set in it; this
 * application stores the grant in Mongo (so a scheduled job with no HTTP
 * request can refresh it) and serves the API with its own session layer. Using
 * both would mean two places believe they own the token.
 *
 * The one thing in this file that is easy to get wrong and expensive to
 * discover: **Xero rotates the refresh token on every refresh and invalidates
 * the previous one.** If a refresh succeeds at Xero and the new token is lost
 * before it is persisted, the connection is permanently dead and the only
 * remedy is a human re-authorising through the browser. Every code path that
 * obtains a new refresh token therefore writes it before doing anything else
 * with the response.
 */

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

/**
 * Refresh this many seconds before the access token actually expires.
 *
 * A token that expires mid-request produces a 401 from a call that looked
 * valid when it started. Sixty seconds covers the round trip plus clock skew
 * between this host and Xero's.
 */
const ACCESS_TOKEN_SKEW_SECONDS = 60;

// ---------------------------------------------------------------------------
// State parameter
// ---------------------------------------------------------------------------

/**
 * The OAuth `state` parameter, signed rather than stored.
 *
 * `state` exists to bind the callback to the browser that started the flow —
 * without it, an attacker can feed their own authorization code to a logged-in
 * admin's callback URL and connect THEIR Xero organisation to this system.
 * That is CSRF against the connect flow, and the consequence is a finance
 * module silently syncing someone else's ledger.
 *
 * Signing it with the session secret and embedding the initiating user's id
 * means the callback can verify both facts without a server-side store: it was
 * issued by us, and it was issued for this user.
 */
export function createOAuthState(userId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now().toString();
  const payload = `${userId}.${nonce}.${issuedAt}`;
  const signature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/** Ten minutes. Long enough to authorise, short enough to be worth replaying. */
const STATE_TTL_MS = 10 * 60 * 1000;

export function verifyOAuthState(state: string, expectedUserId: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 4) return false;

  const [userId, nonce, issuedAt, signature] = parts as [string, string, string, string];
  const payload = `${userId}.${nonce}.${issuedAt}`;
  const expected = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");

  // Constant-time: a length mismatch is checked first because timingSafeEqual
  // throws on differing lengths rather than returning false.
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  if (userId !== expectedUserId) return false;

  const age = Date.now() - Number(issuedAt);
  return Number.isFinite(age) && age >= 0 && age < STATE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(config: XeroConfig, state: string): string {
  if (!config.clientId || !config.redirectUri) {
    throw new HttpError(503, config.reason ?? "Xero is not configured.");
  }

  const url = new URL(XERO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/** HTTP Basic, as Xero's token endpoint requires for a confidential client. */
function basicAuthHeader(config: XeroConfig): string {
  const raw = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function postToken(
  config: XeroConfig,
  body: Record<string, string>,
): Promise<XeroTokenResponse> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();

  if (!response.ok) {
    /**
     * Xero's OAuth errors are specific and actionable — `invalid_grant` means
     * re-authorise, `unauthorized_client` means the redirect URI does not match
     * the portal — so the error CODE is worth surfacing. A generic "Xero
     * returned 400" sends someone hunting through logs for something the
     * response already said.
     *
     * The raw body is NOT surfaced. It is echoed into `XeroSyncState.lastError`
     * and `XeroConnection.statusReason`, both of which `GET /api/xero/status`
     * returns to any FINANCE_READ user, and a token-endpoint body can contain
     * request context that has no business on a finance officer's screen. Only
     * the recognised `error` code crosses that boundary; the full body goes to
     * stderr, where an operator with log access can see it.
     */
    console.error("[xero] token request failed", response.status, text.slice(0, 2000));

    let code = "unknown_error";
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && /^[a-z_]{1,64}$/.test(parsed.error)) {
        code = parsed.error;
      }
    } catch {
      // A non-JSON body is not from the OAuth endpoint's error contract.
    }

    throw new HttpError(502, `Xero token request failed (${response.status}): ${code}`);
  }

  return JSON.parse(text) as XeroTokenResponse;
}

interface XeroTenant {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
}

/** The organisations this grant covers. */
async function fetchTenants(accessToken: string): Promise<XeroTenant[]> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new HttpError(
      502,
      `Xero connections request failed (${response.status}).`,
    );
  }

  return (await response.json()) as XeroTenant[];
}

/**
 * Completes the authorization-code exchange and stores one connection per
 * tenant the user granted.
 *
 * A single grant can cover several organisations — Xero's consent screen lets
 * the user tick more than one. Each becomes its own connection row sharing the
 * same refresh token, because that is what Xero issues: one token, many
 * tenants. Refreshing any of them rotates the token for all, which is why
 * `refreshAccessToken` writes the new token to every row that carried the old
 * one.
 */
export async function completeAuthorization(
  code: string,
  connectedBy: string,
): Promise<{ tenantId: string; tenantName: string }[]> {
  const config = resolveXeroConfig();
  if (config.mode === "disabled") {
    throw new HttpError(503, config.reason ?? "Xero is not configured.");
  }
  if (!config.redirectUri) {
    throw new HttpError(503, "XERO_REDIRECT_URI is not set.");
  }

  const token = await postToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  const tenants = await fetchTenants(token.access_token);
  if (tenants.length === 0) {
    throw new HttpError(
      400,
      "The Xero authorization granted access to no organisations.",
    );
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const scopes = token.scope ? token.scope.split(" ") : [...config.scopes];

  for (const tenant of tenants) {
    await XeroConnection.updateOne(
      { tenantId: tenant.tenantId },
      {
        $set: {
          tenantName: tenant.tenantName,
          tenantType: tenant.tenantType,
          refreshToken: token.refresh_token,
          accessToken: token.access_token,
          accessTokenExpiresAt: expiresAt,
          scopes,
          status: "active",
          statusReason: null,
          connectedBy,
          lastRefreshedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  return tenants.map((t) => ({ tenantId: t.tenantId, tenantName: t.tenantName }));
}

// ---------------------------------------------------------------------------
// Access token resolution
// ---------------------------------------------------------------------------

/**
 * Returns a usable access token for `tenantId`, refreshing if needed.
 *
 * This is the only function the API client calls. Everything about token
 * lifetime lives here so no caller has to reason about expiry.
 *
 * On `invalid_grant` the connection is marked `expired` with a reason rather
 * than left looking healthy. That state is what the settings screen renders as
 * "reauthorise required" — a connection that silently fails every sync while
 * still displaying as connected is the failure mode this avoids.
 */
export async function getAccessToken(tenantId: string): Promise<string> {
  const connection = await XeroConnection.findOne({ tenantId })
    // Both are `select: false`, so they must be asked for explicitly.
    .select("+refreshToken +accessToken")
    .exec();

  if (!connection) {
    throw new HttpError(400, `No Xero connection for tenant ${tenantId}.`);
  }
  if (connection.status !== "active") {
    throw new HttpError(
      503,
      `Xero connection is ${connection.status}: ${connection.statusReason ?? "reauthorise required"}.`,
    );
  }

  const expiresAt = connection.accessTokenExpiresAt ?? null;
  const stillValid =
    connection.accessToken != null &&
    expiresAt !== null &&
    expiresAt.getTime() - ACCESS_TOKEN_SKEW_SECONDS * 1000 > Date.now();

  if (stillValid && connection.accessToken) return connection.accessToken;

  return refreshAccessToken(tenantId);
}

/**
 * Exchanges the stored refresh token for a new token pair.
 *
 * The write ordering here is the whole point of the function. Xero invalidates
 * the old refresh token the moment it issues a new one, so the new one is
 * persisted BEFORE the access token is returned to the caller. If this process
 * dies immediately after the HTTP call, the worst case is an unused access
 * token — not an orphaned connection that can never be refreshed again.
 *
 * The update targets every row holding the old refresh token, because one
 * grant can cover several tenants and they share it.
 */
export async function refreshAccessToken(tenantId: string): Promise<string> {
  const config = resolveXeroConfig();
  if (config.mode === "disabled") {
    throw new HttpError(503, config.reason ?? "Xero is not configured.");
  }

  const connection = await XeroConnection.findOne({ tenantId })
    .select("+refreshToken")
    .exec();

  if (!connection) {
    throw new HttpError(400, `No Xero connection for tenant ${tenantId}.`);
  }

  const oldRefreshToken = connection.refreshToken;

  let token: XeroTokenResponse;
  try {
    token = await postToken(config, {
      grant_type: "refresh_token",
      refresh_token: oldRefreshToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // `invalid_grant` is terminal: the refresh token is gone and no retry will
    // bring it back. Record that distinctly from a transient network failure,
    // because the remedies differ (reauthorise vs. wait).
    if (message.includes("invalid_grant")) {
      await XeroConnection.updateMany(
        { refreshToken: oldRefreshToken },
        {
          $set: {
            status: "expired",
            statusReason:
              "Xero rejected the refresh token. Reconnect to restore the integration.",
          },
        },
      );
    }

    throw error;
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  /**
   * Persisted before the token is handed back — see the note above — and
   * conditioned on the OLD token still being the stored one.
   *
   * That filter is a compare-and-swap. Two concurrent refreshes (the cron and
   * a manual sync, say) both send the same old token; Xero honours the first
   * and rejects the second with `invalid_grant`. But if the second's write
   * landed unconditionally it would overwrite the first's valid token with its
   * own failed one — and an unconditional write of a *stale* success has the
   * same effect. Matching on `refreshToken: oldRefreshToken` means a writer
   * whose view is stale updates nothing.
   *
   * `matchedCount === 0` therefore means another refresh won the race and a
   * newer token is already stored. That is a success for the caller's purpose:
   * the access token in hand is valid, and the connection is healthy.
   */
  const result = await XeroConnection.updateMany(
    { refreshToken: oldRefreshToken },
    {
      $set: {
        refreshToken: token.refresh_token,
        accessToken: token.access_token,
        accessTokenExpiresAt: expiresAt,
        status: "active",
        statusReason: null,
        lastRefreshedAt: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) {
    console.warn(
      `[xero] refresh for ${tenantId} raced another refresh; the newer token was kept.`,
    );
  }

  return token.access_token;
}

/**
 * Forgets a connection.
 *
 * Deletes the row rather than flagging it, so the refresh token stops existing
 * here. Note this does NOT revoke the grant at Xero — that is done from Xero's
 * own connected-apps screen, and the route tells the user so. Claiming to have
 * revoked something we did not would be worse than saying nothing.
 */
export async function disconnect(tenantId: string): Promise<boolean> {
  const result = await XeroConnection.deleteOne({ tenantId });
  return result.deletedCount > 0;
}
