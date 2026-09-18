import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  PauseCircle,
  PlugZap,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";
import { FINANCE_APPROVE } from "@dokuma/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-states";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import {
  beginXeroConnect,
  completeXeroConnect,
  disconnectXero,
  getXeroStatus,
  pushAllToXero,
  syncXero,
  type PushResult,
  type SyncResult,
  type XeroConnectionView,
  type XeroMode,
  type XeroSyncStateView,
} from "@/lib/api/xero";

/**
 * Xero integration status and controls.
 *
 * Modelled on the Group Reporting page for the same reason that page exists:
 * an integration's figures mean nothing without the state of the pipe carrying
 * them. A read-only connection and a live one produce identical-looking data
 * until someone tries to push, so the mode is stated in words at the top rather
 * than implied by which buttons happen to be enabled.
 *
 * Nothing here handles a token. The OAuth grant lives server-side; the only
 * thing that crosses to the browser is a consent URL to navigate to.
 */

const XERO_KEY = ["xero", "status"] as const;

const MODE_STYLES: Record<XeroMode, { chip: string; wrap: string; icon: typeof PlugZap; label: string }> = {
  live: {
    chip: "bg-status-green/15 text-status-green",
    wrap: "border-status-green/40 bg-status-green/5",
    icon: CheckCircle2,
    label: "Live",
  },
  "read-only": {
    chip: "bg-status-amber/15 text-status-amber",
    wrap: "border-status-amber/40 bg-status-amber/5",
    icon: AlertTriangle,
    label: "Read-only",
  },
  disabled: {
    chip: "bg-muted text-muted-foreground",
    wrap: "border-border bg-muted/40",
    icon: PauseCircle,
    label: "Disabled",
  },
};

const CONNECTION_STYLES: Record<string, string> = {
  active: "bg-status-green/15 text-status-green hover:bg-status-green/15",
  expired: "bg-status-red/15 text-status-red hover:bg-status-red/15",
  revoked: "bg-muted text-muted-foreground",
};

const SYNC_STYLES: Record<string, string> = {
  ok: "bg-status-green/15 text-status-green hover:bg-status-green/15",
  failed: "bg-status-red/15 text-status-red hover:bg-status-red/15",
  running: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  idle: "bg-muted text-muted-foreground",
};

export function XeroSettingsPage() {
  useDocumentTitle("Xero Integration");

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const canManage = user !== null && FINANCE_APPROVE.includes(user.role);

  const [callbackState, setCallbackState] = useState<
    { kind: "ok"; message: string } | { kind: "error"; message: string } | null
  >(null);
  const [syncResult, setSyncResult] = useState<{ tenantId: string; result: SyncResult } | null>(null);
  const [pushResult, setPushResult] = useState<
    { tenantId: string; sent: number; failed: number; skipped: number; results: PushResult[] } | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<XeroConnectionView | null>(null);
  const [disconnectNote, setDisconnectNote] = useState<string | null>(null);

  const status = useQuery({ queryKey: XERO_KEY, queryFn: getXeroStatus });

  const onActionError = (caught: unknown) =>
    setActionError(
      caught instanceof ApiRequestError ? caught.message : "That action failed. Try again.",
    );

  // ---- OAuth callback --------------------------------------------------
  const code = searchParams.get("code");
  const oauthState = searchParams.get("state");

  /**
   * An authorization code is single-use. React 18 mounts effects twice in
   * development StrictMode, and a user refreshing the callback URL would replay
   * a spent code and see a spurious failure — so the exchange is fired at most
   * once per code, and the params are stripped from the URL as soon as it is
   * sent.
   */
  const exchanged = useRef<string | null>(null);

  const complete = useMutation({
    mutationFn: ({ code: c, state: s }: { code: string; state: string }) =>
      completeXeroConnect(c, s),
    async onSuccess(result) {
      const names = result.connected.map((c) => c.tenantName).join(", ");
      setCallbackState({
        kind: "ok",
        message: result.connected.length
          ? `Connected to ${names}.`
          : "Xero returned no organisations for this grant.",
      });
      await queryClient.invalidateQueries({ queryKey: XERO_KEY });
    },
    onError(caught) {
      setCallbackState({
        kind: "error",
        message:
          caught instanceof ApiRequestError
            ? caught.message
            : "Could not complete the Xero connection.",
      });
    },
  });

  useEffect(() => {
    if (!code || !oauthState) return;
    if (exchanged.current === code) return;
    exchanged.current = code;

    complete.mutate({ code, state: oauthState });

    // Clear the spent code from the address bar immediately, so a refresh does
    // not attempt to redeem it a second time.
    navigate(location.pathname, { replace: true });
    // `complete` and `navigate` are stable enough for this one-shot exchange;
    // the ref is what actually guards against a repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, oauthState]);

  // ---- Mutations -------------------------------------------------------

  const connect = useMutation({
    mutationFn: beginXeroConnect,
    onSuccess(result) {
      // A full navigation, not a router push: the consent page is Xero's.
      window.location.href = result.authorization_url;
    },
    onError: onActionError,
  });

  const sync = useMutation({
    mutationFn: (tenantId: string) => syncXero(tenantId),
    async onSuccess(result, tenantId) {
      setActionError(null);
      setSyncResult({ tenantId, result });
      await queryClient.invalidateQueries({ queryKey: XERO_KEY });
    },
    onError(caught) {
      setSyncResult(null);
      onActionError(caught);
    },
  });

  const push = useMutation({
    mutationFn: (tenantId: string) => pushAllToXero(tenantId),
    async onSuccess(result, tenantId) {
      setActionError(null);
      setPushResult({ tenantId, ...result });
      await queryClient.invalidateQueries({ queryKey: XERO_KEY });
    },
    onError(caught) {
      setPushResult(null);
      onActionError(caught);
    },
  });

  const disconnect = useMutation({
    mutationFn: (tenantId: string) => disconnectXero(tenantId),
    async onSuccess(result) {
      setConfirmDisconnect(null);
      setActionError(null);
      setDisconnectNote(result.note);
      await queryClient.invalidateQueries({ queryKey: XERO_KEY });
    },
    onError(caught) {
      setConfirmDisconnect(null);
      onActionError(caught);
    },
  });

  // ---- Render ----------------------------------------------------------

  const data = status.data;
  const mode = data?.config.mode ?? "disabled";
  const modeStyle = MODE_STYLES[mode];
  const ModeIcon = modeStyle.icon;

  return (
    <div className="space-y-6">
      <FinanceSubnav />

      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Xero Integration</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The state of the connection to Xero, what each resource last synced, and the controls to
          connect, sync and push. Credentials never reach this page — the OAuth grant is held
          server-side.
        </p>
      </div>

      {/* ---- OAuth callback outcome ------------------------------------- */}
      {complete.isPending && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Completing the Xero connection…
        </p>
      )}

      {callbackState && (
        <p
          role={callbackState.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            callbackState.kind === "error"
              ? "bg-status-red/10 text-status-red"
              : "bg-status-green/10 text-status-green",
          )}
        >
          {callbackState.message}
        </p>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {actionError}
        </p>
      )}

      {status.error && (
        <QueryError
          error={status.error}
          onRetry={() => void status.refetch()}
          resource="the Xero integration status"
        />
      )}

      {status.isPending && !status.error && (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading Xero status…</span>
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      )}

      {data && (
        <>
          {/* ---- 1. Configuration --------------------------------------- */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-lg text-foreground">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3",
                  modeStyle.wrap,
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                    modeStyle.chip,
                  )}
                >
                  <ModeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {modeStyle.label}
                </span>

                <p className="text-sm text-muted-foreground">
                  {mode === "live" ? (
                    <>
                      Xero is connected for both reading and writing. Transactions recorded here can
                      be pushed to Xero.
                    </>
                  ) : (
                    /*
                      The reason is rendered verbatim. It is written server-side
                      to name the exact missing setting — "XERO_CLIENT_ID is not
                      set" — and paraphrasing it here would replace an actionable
                      instruction with a vague one.
                    */
                    <span className="text-foreground">
                      {data.config.reason ?? "Xero is not fully configured."}
                    </span>
                  )}
                </p>
              </div>

              {mode === "read-only" && (
                <p className="text-sm text-muted-foreground">
                  Data can be pulled from Xero, but nothing will be written back. Push controls are
                  hidden until the integration is live.
                </p>
              )}

              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Redirect URI</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">
                    {data.config.redirect_uri ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Client ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">
                    {/* A public identifier that appears in the consent URL — not
                        a credential. No secret is ever shown or requested. */}
                    {data.config.client_id ?? "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Scopes</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {data.config.scopes.length > 0 ? (
                      data.config.scopes.map((scope) => (
                        <code
                          key={scope}
                          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {scope}
                        </code>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              {canManage && (
                <div>
                  <Button
                    className="rounded-xl"
                    disabled={mode === "disabled" || connect.isPending}
                    onClick={() => {
                      setActionError(null);
                      connect.mutate();
                    }}
                  >
                    <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {connect.isPending ? "Opening Xero…" : "Connect to Xero"}
                  </Button>
                  {mode === "disabled" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Connecting is unavailable until the configuration above is resolved.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {disconnectNote && (
            <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              {/* Verbatim: it explains that access must ALSO be revoked in Xero
                  itself, which a user will otherwise assume was done here. */}
              {disconnectNote}
            </p>
          )}

          {/* ---- 2. Connections ----------------------------------------- */}
          <section className="space-y-3">
            <h2 className="font-serif text-lg text-foreground">Connected organisations</h2>

            {data.connections.length === 0 ? (
              <Card className="rounded-2xl">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No Xero organisation is connected.
                  {mode === "disabled"
                    ? " Resolve the configuration above before connecting."
                    : canManage
                      ? " Use “Connect to Xero” above to authorise one."
                      : " A finance manager can authorise one."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {data.connections.map((connection) => (
                  <ConnectionCard
                    key={connection.tenant_id}
                    connection={connection}
                    canManage={canManage}
                    canPush={data.can_push}
                    syncPending={sync.isPending && sync.variables === connection.tenant_id}
                    pushPending={push.isPending && push.variables === connection.tenant_id}
                    onSync={() => {
                      setActionError(null);
                      sync.mutate(connection.tenant_id);
                    }}
                    onPush={() => {
                      setActionError(null);
                      push.mutate(connection.tenant_id);
                    }}
                    onDisconnect={() => setConfirmDisconnect(connection)}
                    syncResult={
                      syncResult?.tenantId === connection.tenant_id ? syncResult.result : null
                    }
                    pushResult={pushResult?.tenantId === connection.tenant_id ? pushResult : null}
                    onReconnect={() => {
                      setActionError(null);
                      connect.mutate();
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---- 3. Sync status ----------------------------------------- */}
          <section className="space-y-3">
            <h2 className="font-serif text-lg text-foreground">Sync status</h2>

            <Card className="rounded-2xl">
              <CardContent className="p-0">
                {data.sync.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last success</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                        <TableHead className="text-right">Updated</TableHead>
                        <TableHead className="text-right">Skipped</TableHead>
                        <TableHead>Last error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.sync.map((row: XeroSyncStateView) => (
                        <TableRow key={`${row.tenant_id}-${row.resource}`}>
                          <TableCell className="font-medium text-foreground">
                            {row.resource}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn(
                                "rounded-full border-0 capitalize",
                                SYNC_STYLES[row.status] ?? "bg-muted text-muted-foreground",
                              )}
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.last_success_at ? formatDateTime(row.last_success_at) : "never"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.last_created}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.last_updated}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.last_skipped}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "max-w-xs",
                              row.last_error ? "text-status-red" : "text-muted-foreground",
                            )}
                          >
                            {row.last_error ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">
                    No resource has been synced yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      {/* ---- Disconnect confirmation ------------------------------------- */}
      <Dialog open={confirmDisconnect !== null} onOpenChange={() => setConfirmDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {confirmDisconnect?.tenant_name}?</DialogTitle>
            <DialogDescription>
              This removes the stored grant for this organisation. Syncing and pushing stop
              immediately, and reconnecting requires going through Xero&apos;s consent screen again.
              Data already synced into Dokuma is kept.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setConfirmDisconnect(null)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-status-red text-white hover:bg-status-red/90"
              disabled={disconnect.isPending}
              onClick={() =>
                confirmDisconnect && disconnect.mutate(confirmDisconnect.tenant_id)
              }
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConnectionCard({
  connection,
  canManage,
  canPush,
  syncPending,
  pushPending,
  onSync,
  onPush,
  onDisconnect,
  onReconnect,
  syncResult,
  pushResult,
}: {
  connection: XeroConnectionView;
  canManage: boolean;
  canPush: boolean;
  syncPending: boolean;
  pushPending: boolean;
  onSync: () => void;
  onPush: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  syncResult: SyncResult | null;
  pushResult: { sent: number; failed: number; skipped: number; results: PushResult[] } | null;
}) {
  const expired = connection.status === "expired";

  return (
    <Card
      className={cn(
        "rounded-2xl",
        // An expired grant is not a cosmetic difference: nothing will sync
        // until it is re-authorised, so the card carries the alarm itself
        // rather than relying on a small badge among several.
        expired && "border-status-red/50 bg-status-red/5",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="font-serif text-lg text-foreground">
            {connection.tenant_name}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {connection.tenant_type ?? "organisation"} · Last refreshed{" "}
            {connection.last_refreshed_at ? formatDateTime(connection.last_refreshed_at) : "never"}
          </p>
        </div>
        <Badge
          className={cn(
            "rounded-full border-0 capitalize",
            CONNECTION_STYLES[connection.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {connection.status}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {connection.status_reason && (
          <p className={cn("text-sm", expired ? "text-status-red" : "text-muted-foreground")}>
            {connection.status_reason}
          </p>
        )}

        {expired && (
          <div className="space-y-2 rounded-xl border border-status-red/40 bg-background/60 px-3 py-2">
            <p className="text-sm text-status-red">
              This connection has expired. No data is syncing and nothing can be pushed until it is
              re-authorised.
            </p>
            {canManage && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={onReconnect}>
                <PlugZap className="mr-2 h-4 w-4" aria-hidden="true" /> Reconnect
              </Button>
            )}
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={syncPending || expired}
              onClick={onSync}
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", syncPending && "animate-spin")}
                aria-hidden="true"
              />
              {syncPending ? "Syncing…" : "Sync now"}
            </Button>

            {/*
              Push only when the server says the integration can write. In
              read-only or disabled mode `can_push` is false and the control is
              absent rather than disabled-with-a-tooltip, because there is no
              action the user can take on this page to enable it.
            */}
            {canPush && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={pushPending || expired}
                onClick={onPush}
              >
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                {pushPending ? "Pushing…" : "Push to Xero"}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-status-red hover:text-status-red"
              onClick={onDisconnect}
            >
              <Unplug className="mr-2 h-4 w-4" aria-hidden="true" /> Disconnect
            </Button>
          </div>
        )}

        {syncResult && <SyncOutcomePanel result={syncResult} />}
        {pushResult && <PushOutcomePanel result={pushResult} />}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * The outcome of one sync run.
 *
 * `errors` can be non-empty on a 200: a run where three resources succeeded and
 * one failed is a partial failure, and reporting it as a plain success is how
 * a missing resource goes unnoticed for weeks. So the failures are stated first
 * and the whole panel takes the alarm styling whenever any exist.
 */
function SyncOutcomePanel({ result }: { result: SyncResult }) {
  const failed = result.errors.length > 0;
  const truncated = result.outcomes.filter((o) => o.truncated);

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border px-3 py-2 text-sm",
        failed ? "border-status-red/40 bg-status-red/5" : "border-border bg-muted/40",
      )}
      role="status"
    >
      <p className={cn("font-medium", failed ? "text-status-red" : "text-foreground")}>
        {failed
          ? `Sync finished with ${result.errors.length} failed resource${result.errors.length === 1 ? "" : "s"}.`
          : "Sync completed."}
      </p>

      {failed && (
        <ul className="space-y-1 text-xs text-status-red">
          {result.errors.map((e) => (
            <li key={e.resource}>
              <span className="font-medium">{e.resource}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}

      {result.outcomes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {result.outcomes.map((o) => (
            <li key={o.resource}>
              <span className="font-medium text-foreground">{o.resource}</span> — {o.created}{" "}
              created, {o.updated} updated, {o.skipped} skipped
              {o.truncated && <span className="text-status-amber"> · more pages remain</span>}
            </li>
          ))}
        </ul>
      )}

      {truncated.length > 0 && (
        <p className="text-xs text-status-amber">
          {truncated.length} resource{truncated.length === 1 ? "" : "s"} hit the per-run page limit.
          Run the sync again to continue from where it stopped.
        </p>
      )}
    </div>
  );
}

/**
 * The outcome of a bulk push.
 *
 * `skipped` is explained rather than counted silently: it is the normal result
 * for a transaction that was already pushed or that originated in Xero, and a
 * large skipped count with zero failures is a healthy run, not a broken one.
 */
function PushOutcomePanel({
  result,
}: {
  result: { sent: number; failed: number; skipped: number; results: PushResult[] };
}) {
  const failures = result.results.filter((r) => r.status === "failed");

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border px-3 py-2 text-sm",
        result.failed > 0 ? "border-status-red/40 bg-status-red/5" : "border-border bg-muted/40",
      )}
      role="status"
    >
      <p className={cn("font-medium", result.failed > 0 ? "text-status-red" : "text-foreground")}>
        {result.sent} sent · {result.failed} failed · {result.skipped} skipped
      </p>

      <p className="text-xs text-muted-foreground">
        Skipped transactions are not failures — they were already pushed, or they originated in
        Xero and pushing them back would duplicate the entry.
      </p>

      {failures.length > 0 && (
        <ul className="space-y-1 text-xs text-status-red">
          {failures.map((f) => (
            <li key={f.transaction_id}>
              <span className="font-mono">{f.transaction_id}</span>
              {f.reason ? `: ${f.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
