import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Undo2 } from "lucide-react";
import { FINANCE_WRITE, type TransactionSummary } from "@dokuma/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError, TableSkeleton } from "@/components/query-states";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { CsvExportButton } from "@/components/finance/csv-export-button";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import {
  createTransaction,
  listAccounts,
  listTransactions,
  reverseTransaction,
  type CreateTransactionBody,
} from "@/lib/api/finance";

/**
 * The ledger.
 *
 * Amounts are exact decimal strings from the API to the cell. Nothing on this
 * page calls `Number()` on one, nothing totals a column, and the create form
 * uses a text input rather than `type="number"` — a number input hands back a
 * float, which is how "1250.50" becomes 1250.4999999999998 before it has left
 * the browser.
 *
 * Direction is carried by `type`, never by the sign of the amount. A debit is
 * shown with a leading minus for readability, but no signed value is ever
 * stored or computed; the server's `check (amount > 0)` is the source of truth.
 */

/** Mirrors `positiveMoneyString` in shared/src/finance.ts. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
/** Mirrors `percentString` — 0–100 with at most two decimals. */
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

interface Filters {
  account_id: string;
  from: string;
  to: string;
  type: "" | "debit" | "credit";
}

const EMPTY_FILTERS: Filters = { account_id: "", from: "", to: "", type: "" };

export function FinanceTransactionsPage() {
  useDocumentTitle("Transactions");

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWrite = user !== null && FINANCE_WRITE.includes(user.role);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<TransactionSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: () => listAccounts() });

  const transactions = useQuery({
    // Every filter is in the key — otherwise a filter change reads a cached
    // page built under the previous filters.
    queryKey: ["finance", "transactions", filters, offset],
    queryFn: () =>
      listTransactions({
        account_id: filters.account_id || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        type: filters.type || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });

  const rows = transactions.data?.items ?? [];

  const updateFilter = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    // A narrower result set makes the current offset meaningless.
    setOffset(0);
  };

  const onMutationError = (caught: unknown) =>
    setActionError(
      caught instanceof ApiRequestError ? caught.message : "That action failed. Try again.",
    );

  const invalidateLedger = () =>
    queryClient.invalidateQueries({ queryKey: ["finance", "transactions"] });

  const create = useMutation({
    mutationFn: createTransaction,
    async onSuccess() {
      setCreateOpen(false);
      setActionError(null);
      await invalidateLedger();
      // A new transaction moves an account balance, so the overview's cash
      // position is stale too.
      await queryClient.invalidateQueries({ queryKey: ["finance", "cash-position"] });
      await queryClient.invalidateQueries({ queryKey: ["finance", "accounts"] });
    },
    onError: onMutationError,
  });

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reverseTransaction(id, reason),
    async onSuccess() {
      setReverseTarget(null);
      setActionError(null);
      // A reversal writes a contra row AND moves the balance: both the ledger
      // and the overview's cash position have to be re-read.
      await invalidateLedger();
      await queryClient.invalidateQueries({ queryKey: ["finance", "cash-position"] });
      await queryClient.invalidateQueries({ queryKey: ["finance", "accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["finance", "company-totals"] });
    },
    onError(caught) {
      setReverseTarget(null);
      onMutationError(caught);
    },
  });

  const csvRows = useMemo(
    () =>
      rows.map((row) => [
        row.date,
        row.account_name ?? "",
        row.type,
        // The exact decimal, unsigned — direction is in the type column, as it
        // is in the database.
        row.amount,
        row.counterparty ?? "",
        row.description ?? "",
        row.reference_no ?? "",
        row.source,
        statusLabel(row),
      ]),
    [rows],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every ledger entry, with its source and reversal history.
          </p>
        </div>
        {canWrite && (
          <Button
            className="rounded-xl bg-navy hover:bg-navy/90"
            onClick={() => {
              setActionError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New transaction
          </Button>
        )}
      </div>

      <FinanceSubnav />

      {actionError && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {actionError}
        </p>
      )}

      {/* ---- Filters ---- */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="filter-account">Account</Label>
            <select
              id="filter-account"
              value={filters.account_id}
              onChange={(e) => updateFilter({ account_id: e.target.value })}
              className="h-10 min-w-[200px] rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">All accounts</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-from">From</Label>
            <Input
              id="filter-from"
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter({ from: e.target.value })}
              className="w-[165px] rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-to">To</Label>
            <Input
              id="filter-to"
              type="date"
              value={filters.to}
              onChange={(e) => updateFilter({ to: e.target.value })}
              className="w-[165px] rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-type">Type</Label>
            <select
              id="filter-type"
              value={filters.type}
              onChange={(e) => updateFilter({ type: e.target.value as Filters["type"] })}
              className="h-10 w-[140px] rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">All types</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setOffset(0);
              }}
            >
              Clear
            </Button>
            <CsvExportButton
              filename="transactions"
              headers={[
                "Date",
                "Account",
                "Type",
                "Amount",
                "Counterparty",
                "Description",
                "Reference",
                "Source",
                "Status",
              ]}
              rows={csvRows}
              disabled={transactions.isPending || Boolean(transactions.error)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ---- Ledger ---- */}
      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {transactions.isPending && <TableSkeleton columns={canWrite ? 10 : 9} />}

          {transactions.error && (
            <div className="p-4">
              <QueryError
                error={transactions.error}
                onRetry={() => void transactions.refetch()}
                resource="transactions"
              />
            </div>
          )}

          {!transactions.isPending && !transactions.error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isReversal = row.reverses_transaction_id !== null;
                  // The server answers 409 for both cases, so the control is
                  // hidden rather than offered and then refused.
                  const canReverse = canWrite && !row.is_reversed && !isReversal;

                  return (
                    <TableRow key={row.id} className={row.is_reversed ? "opacity-60" : undefined}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.date)}
                      </TableCell>
                      <TableCell className="text-foreground">{row.account_name ?? "—"}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{row.type}</TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right font-medium tabular-nums",
                          row.type === "debit" ? "text-status-red" : "text-status-green",
                        )}
                      >
                        {/* The minus is presentational. `row.amount` is always
                            the unsigned exact decimal the server stored. */}
                        {row.type === "debit" ? "−" : ""}
                        {formatMoney(row.amount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.counterparty ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {row.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.reference_no ?? "—"}</TableCell>
                      <TableCell>
                        {row.source === "xero-sync" ? (
                          <Badge className="rounded-full border-0 bg-steel/15 text-steel hover:bg-steel/15">
                            Xero
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{row.source}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.is_reversed && (
                            <Badge className="rounded-full border-0 bg-status-red/15 text-status-red hover:bg-status-red/15">
                              Reversed
                            </Badge>
                          )}
                          {isReversal && (
                            <Badge className="rounded-full border-0 bg-status-amber/15 text-status-amber hover:bg-status-amber/15">
                              Reversal
                            </Badge>
                          )}
                          {row.is_dlap && (
                            <Badge className="rounded-full border-0 bg-gold/15 text-gold hover:bg-gold/15">
                              DLAP
                            </Badge>
                          )}
                          {!row.is_reversed && !isReversal && !row.is_dlap && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          {canReverse && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reverse this transaction"
                              onClick={() => {
                                setActionError(null);
                                setReverseTarget(row);
                              }}
                            >
                              <Undo2 className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Reverse</span>
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={canWrite ? 10 : 9}
                      className="text-center text-muted-foreground"
                    >
                      No transactions match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        total={transactions.data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="transactions"
      />

      {canWrite && (
        <>
          <CreateTransactionDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            accounts={accounts.data ?? []}
            submitting={create.isPending}
            onSubmit={(body) => create.mutate(body)}
          />

          <ReverseDialog
            target={reverseTarget}
            onOpenChange={(open) => !open && setReverseTarget(null)}
            submitting={reverse.isPending}
            onSubmit={(reason) =>
              reverseTarget && reverse.mutate({ id: reverseTarget.id, reason })
            }
          />
        </>
      )}
    </div>
  );
}

function statusLabel(row: TransactionSummary): string {
  const parts: string[] = [];
  if (row.is_reversed) parts.push("Reversed");
  if (row.reverses_transaction_id !== null) parts.push("Reversal");
  if (row.is_dlap) parts.push("DLAP");
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

function CreateTransactionDialog({
  open,
  onOpenChange,
  accounts,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  submitting: boolean;
  onSubmit: (body: CreateTransactionBody) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [isDlap, setIsDlap] = useState(false);
  const [dlapSharePct, setDlapSharePct] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setAccountId("");
    setDate(new Date().toISOString().slice(0, 10));
    setType("debit");
    setAmount("");
    setCategory("");
    setCounterparty("");
    setDescription("");
    setReferenceNo("");
    setIsDlap(false);
    setDlapSharePct("");
    setErrors({});
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = () => {
    const found: Record<string, string> = {};

    if (!accountId) found.account_id = "Choose an account.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = "Enter a date.";

    // Validated as a string against the same regex the server uses. Parsing to
    // a number to check "> 0" would be the very float round-trip this input is
    // shaped to avoid, so the zero test is done on the digits.
    const trimmedAmount = amount.trim();
    if (!AMOUNT_PATTERN.test(trimmedAmount)) {
      found.amount = "Enter an amount with at most 2 decimal places, e.g. 1250.50.";
    } else if (/^0+(\.0{1,2})?$/.test(trimmedAmount)) {
      found.amount = "Amount must be greater than 0.";
    }

    // Mirrors the server's cross-field rule so the user gets an inline error
    // rather than a 400 from the round trip.
    const trimmedPct = dlapSharePct.trim();
    if (isDlap && trimmedPct === "") {
      found.dlap_share_pct = "A DLAP transaction requires a share percentage.";
    } else if (trimmedPct !== "") {
      if (!isDlap) {
        found.dlap_share_pct = "A DLAP share percentage requires the DLAP box to be checked.";
      } else if (!PERCENT_PATTERN.test(trimmedPct) || Number(trimmedPct) > 100) {
        found.dlap_share_pct = "Enter a percentage between 0 and 100.";
      }
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    onSubmit({
      account_id: accountId,
      date,
      type,
      amount: trimmedAmount,
      category: category.trim() || null,
      counterparty: counterparty.trim() || null,
      description: description.trim() || null,
      reference_no: referenceNo.trim() || null,
      is_dlap: isDlap,
      dlap_share_pct: isDlap ? trimmedPct : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
          <DialogDescription>
            The amount is always positive — direction is set by debit or credit. To correct a posted
            entry, reverse it rather than entering a negative one.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tx-account">Account</Label>
            <select
              id="tx-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Select an account…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
            <FieldError message={errors.account_id} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Date</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl"
              />
              <FieldError message={errors.date} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-type">Type</Label>
              <select
                id="tx-type"
                value={type}
                onChange={(e) => setType(e.target.value as "debit" | "credit")}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="debit">Debit (money out)</option>
                <option value="credit">Credit (money in)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-amount">Amount</Label>
            {/*
              A text input, NOT type="number". A number input returns
              `valueAsNumber`-shaped strings through a float, and the browser's
              own spinner/locale handling can turn "1250.50" into something the
              exact-decimal contract rejects. Held as a string end to end.
            */}
            <Input
              id="tx-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1250.50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-xl tabular-nums"
            />
            <FieldError message={errors.amount} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-counterparty">Counterparty</Label>
              <Input
                id="tx-counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-category">Category</Label>
              <Input
                id="tx-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-reference">Reference no.</Label>
            <Input
              id="tx-reference"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-description">Description</Label>
            <Textarea
              id="tx-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="tx-dlap"
                checked={isDlap}
                onCheckedChange={(checked) => {
                  const next = checked === true;
                  setIsDlap(next);
                  if (!next) setDlapSharePct("");
                }}
              />
              <Label htmlFor="tx-dlap" className="font-normal">
                This is a DLAP transaction
              </Label>
            </div>

            {isDlap && (
              <div className="space-y-1.5">
                <Label htmlFor="tx-dlap-pct">Dokuma share %</Label>
                <Input
                  id="tx-dlap-pct"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="50"
                  value={dlapSharePct}
                  onChange={(e) => setDlapSharePct(e.target.value)}
                  className="rounded-xl tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  Required for a DLAP row — a blank share silently reports the partner as owed
                  nothing.
                </p>
              </div>
            )}
            <FieldError message={errors.dlap_share_pct} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl bg-navy hover:bg-navy/90" disabled={submitting}>
              {submitting ? "Saving…" : "Create transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reverse
// ---------------------------------------------------------------------------

function ReverseDialog({
  target,
  onOpenChange,
  submitting,
  onSubmit,
}: {
  target: TransactionSummary | null;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setReason("");
      setError(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this transaction?</DialogTitle>
          <DialogDescription>
            {target
              ? `A contra entry for ${formatMoney(target.amount)} will be posted against ${
                  target.account_name ?? "this account"
                }. The original stays on the ledger, marked reversed — nothing is deleted.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = reason.trim();
            if (trimmed.length < 1) {
              setError("A reason is required for every reversal.");
              return;
            }
            setError(null);
            onSubmit(trimmed);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Textarea
              id="reverse-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why was the original wrong?"
              className="rounded-xl"
            />
            {/* The reason is the only record of why the entry was wrong; it is
                written into the reversal's description. */}
            <FieldError message={error ?? undefined} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl bg-navy hover:bg-navy/90" disabled={submitting}>
              {submitting ? "Reversing…" : "Reverse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-status-red">
      {message}
    </p>
  );
}
