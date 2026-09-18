import { api } from "@/lib/api-client";

/**
 * Typed client for /api/xero.
 *
 * Nothing here ever handles a token. The OAuth grant lives server-side in
 * `xero_connections` with both token fields marked `select: false`, and the
 * only thing that crosses to the browser is a consent URL to navigate to. A
 * refresh token reaching client code would be readable by any script on the
 * page and would grant standing access to the organisation's accounts.
 */

export type XeroMode = "disabled" | "read-only" | "live";

export interface XeroConfigView {
  mode: XeroMode;
  /** A public identifier that appears in the consent URL — not a credential. */
  client_id: string | null;
  redirect_uri: string | null;
  scopes: string[];
  /** Why it is not live. Shown verbatim; it is written to be actionable. */
  reason: string | null;
}

export interface XeroConnectionView {
  tenant_id: string;
  tenant_name: string;
  tenant_type: string | null;
  status: "active" | "expired" | "revoked";
  status_reason: string | null;
  scopes: string[];
  last_refreshed_at: string | null;
}

export type XeroResource =
  | "accounts"
  | "bank-transactions"
  | "invoices"
  | "contacts"
  | "profit-and-loss"
  | "balance-sheet";

export interface XeroSyncStateView {
  tenant_id: string;
  resource: XeroResource;
  status: "idle" | "running" | "ok" | "failed";
  last_run_at: string | null;
  last_success_at: string | null;
  last_modified_since: string | null;
  last_error: string | null;
  last_created: number;
  last_updated: number;
  last_skipped: number;
}

export interface XeroStatus {
  config: XeroConfigView;
  /** False in `read-only` and `disabled`. Gate the push controls on this. */
  can_push: boolean;
  connections: XeroConnectionView[];
  sync: XeroSyncStateView[];
}

export function getXeroStatus(): Promise<XeroStatus> {
  return api.get<XeroStatus>("/xero/status");
}

/**
 * Starts the OAuth flow.
 *
 * Returns a URL to navigate to rather than following a redirect: this is
 * called with `fetch`, and a 302 would be followed by the fetch itself,
 * landing Xero's consent HTML in a JSON parser. Assign the result to
 * `window.location.href`.
 */
export function beginXeroConnect(): Promise<{ authorization_url: string }> {
  return api.post<{ authorization_url: string }>("/xero/connect", {});
}

/**
 * Completes the OAuth flow with the code and state from the callback URL.
 *
 * `state` must be passed through exactly as received — the server verifies it
 * against the current session, which is what stops an attacker connecting
 * their own Xero organisation to this system.
 */
export function completeXeroConnect(
  code: string,
  state: string,
): Promise<{ connected: { tenantId: string; tenantName: string }[] }> {
  return api.post<{ connected: { tenantId: string; tenantName: string }[] }>(
    "/xero/callback",
    { code, state },
  );
}

export function disconnectXero(
  tenantId: string,
): Promise<{ disconnected: boolean; note: string }> {
  return api.delete<{ disconnected: boolean; note: string }>(
    `/xero/connections/${encodeURIComponent(tenantId)}`,
  );
}

export interface SyncOutcome {
  resource: XeroResource;
  created: number;
  updated: number;
  skipped: number;
  /** More pages remained behind the per-run page limit; run again to continue. */
  truncated: boolean;
}

export interface SyncResult {
  outcomes: SyncOutcome[];
  /**
   * Per-resource failures. A run where three resources succeeded and one
   * failed returns 200 with this populated — partial failure is data, not an
   * error status, so the successes are not hidden.
   */
  errors: { resource: XeroResource; message: string }[];
  company_totals: {
    asOfDate: string;
    outstandingReceivables: string;
    invoiceCount: number;
  };
}

export function syncXero(
  tenantId: string,
  resources?: XeroResource[],
): Promise<SyncResult> {
  return api.post<SyncResult>(
    `/xero/connections/${encodeURIComponent(tenantId)}/sync`,
    resources ? { resources } : {},
  );
}

export interface PushResult {
  transaction_id: string;
  /** `skipped` is normal, not a failure — already pushed, or came from Xero. */
  status: "sent" | "skipped" | "failed";
  xero_transaction_id: string | null;
  reason: string | null;
}

export function pushTransactionToXero(
  tenantId: string,
  transactionId: string,
): Promise<PushResult> {
  return api.post<PushResult>(
    `/xero/connections/${encodeURIComponent(tenantId)}/push/${transactionId}`,
    {},
  );
}

export function pushAllToXero(
  tenantId: string,
  limit = 100,
): Promise<{ sent: number; failed: number; skipped: number; results: PushResult[] }> {
  return api.post<{ sent: number; failed: number; skipped: number; results: PushResult[] }>(
    `/xero/connections/${encodeURIComponent(tenantId)}/push`,
    { limit },
  );
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface ProfitAndLoss {
  id: string;
  type: "profit-and-loss";
  period_start: string | null;
  period_end: string | null;
  revenue: string | null;
  gross_profit: string | null;
  net_profit: string | null;
  currency: string;
  fetched_at: string | null;
}

export interface BalanceSheet {
  id: string;
  type: "balance-sheet";
  as_at: string | null;
  total_assets: string | null;
  total_liabilities: string | null;
  net_assets: string | null;
  currency: string;
  fetched_at: string | null;
}

/**
 * Reads the stored snapshot by default; `refresh` re-fetches from Xero.
 *
 * Null means "no snapshot for this period yet", which is deliberately distinct
 * from a statement whose figures are zero. Render the two differently.
 */
export function getProfitAndLoss(
  tenantId: string,
  options: { period_start?: string; period_end?: string; refresh?: boolean } = {},
): Promise<ProfitAndLoss | null> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<ProfitAndLoss | null>(
    `/xero/connections/${encodeURIComponent(tenantId)}/profit-and-loss${query ? `?${query}` : ""}`,
  );
}

export function getBalanceSheet(
  tenantId: string,
  options: { period_end?: string; refresh?: boolean } = {},
): Promise<BalanceSheet | null> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<BalanceSheet | null>(
    `/xero/connections/${encodeURIComponent(tenantId)}/balance-sheet${query ? `?${query}` : ""}`,
  );
}
