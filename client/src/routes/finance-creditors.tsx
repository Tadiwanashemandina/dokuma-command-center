import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  CREDITOR_STATUSES,
  FINANCE_APPROVE,
  FINANCE_WRITE,
  type CreditorStatus,
} from "@dokuma/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QueryError, TableSkeleton } from "@/components/query-states";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { CsvExportButton } from "@/components/finance/csv-export-button";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { createCreditor, listCreditors, updateCreditorStatus } from "@/lib/api/finance";

/**
 * Creditors — who the company owes, and how overdue it is.
 *
 * Three things here are load-bearing rather than cosmetic:
 *
 *  1. `amount_owed` is an exact decimal STRING and is never converted. It is
 *     displayed with `formatMoney` and exported verbatim; nothing on this page
 *     adds two amounts, because any total belongs on the server.
 *  2. Overdue is decided by comparing `YYYY-MM-DD` strings, not `Date` objects.
 *     `new Date("2026-09-18")` parses as UTC midnight and then renders in local
 *     time, so west of Greenwich a creditor due today reads as overdue. String
 *     comparison on a fixed-width date format is both correct and cheaper.
 *  3. A row with a `xero_invoice_id` is owned by Xero. The server answers 409
 *     to a status edit on one, because the next sync would silently revert it,
 *     so the control is disabled with the reason attached rather than offered
 *     and then rejected.
 */

const STATUS_LABELS: Record<CreditorStatus, string> = {
  outstanding: "Outstanding",
  partially_paid: "Partially paid",
  paid: "Paid",
};

const STATUS_STYLES: Record<CreditorStatus, string> = {
  outstanding: "bg-status-red/15 text-status-red hover:bg-status-red/15",
  partially_paid: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  paid: "bg-status-green/15 text-status-green hover:bg-status-green/15",
};

/** Today as `YYYY-MM-DD` in the viewer's own calendar. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Overdue = a due date strictly before today, on a row that is not settled.
 * Both sides are `YYYY-MM-DD`, so a lexicographic comparison is a calendar
 * comparison — no timezone is involved and no day can shift.
 */
function isOverdue(dueDate: string | null, status: CreditorStatus): boolean {
  if (dueDate === null || status === "paid") return false;
  return dueDate.slice(0, 10) < todayIso();
}

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

type StatusFilter = CreditorStatus | "all";

export function FinanceCreditorsPage() {
  useDocumentTitle("Creditors");

  const queryClient = useQueryClient();
  const { user } = useAuth();

  const canCreate = user !== null && FINANCE_WRITE.includes(user.role);
  const canApprove = user !== null && FINANCE_APPROVE.includes(user.role);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const creditors = useQuery({
    queryKey: ["finance", "creditors", status, offset],
    queryFn: () =>
      listCreditors({
        ...(status === "all" ? {} : { status }),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["finance", "creditors"] });

  const describeError = (caught: unknown) =>
    setActionError(
      caught instanceof ApiRequestError ? caught.message : "That action failed. Try again.",
    );

  const create = useMutation({
    mutationFn: createCreditor,
    async onSuccess() {
      setCreateOpen(false);
      setActionError(null);
      await invalidate();
    },
    onError: describeError,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: CreditorStatus }) =>
      updateCreditorStatus(id, next),
    async onSuccess() {
      setActionError(null);
      await invalidate();
    },
    onError: describeError,
  });

  const rows = creditors.data?.items ?? [];

  // The CSV mirrors the table exactly — same strings, same formatter — so the
  // exported figures cannot disagree with the ones on screen.
  const csvRows = rows.map((row) => [
    row.name,
    formatMoney(row.amount_owed),
    row.due_date ?? "",
    STATUS_LABELS[row.status],
    row.xero_invoice_id === null ? "Manual" : "Xero",
    row.notes ?? "",
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Creditors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything the company owes, soonest due first.
          </p>
        </div>
        <FinanceSubnav />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="creditor-status-filter" className="text-sm text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as StatusFilter);
              // A filter change re-pages from the start; keeping the old offset
              // can land past the end of a shorter result set and show nothing.
              setOffset(0);
            }}
          >
            <SelectTrigger id="creditor-status-filter" className="h-9 w-[180px] rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CREDITOR_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <CsvExportButton
            filename={`creditors-${status}`}
            headers={["Name", "Amount owed", "Due date", "Status", "Source", "Notes"]}
            rows={csvRows}
            disabled={creditors.isPending}
          />
          {canCreate && (
            <Button className="rounded-xl" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add creditor
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <p role="alert" className="rounded-xl bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {actionError}
        </p>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {creditors.isPending && <TableSkeleton columns={5} />}

          {creditors.error && (
            <div className="p-4">
              <QueryError
                error={creditors.error}
                onRetry={() => void creditors.refetch()}
                resource="creditors"
              />
            </div>
          )}

          {!creditors.isPending && !creditors.error && (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Amount owed</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const overdue = isOverdue(row.due_date, row.status);
                    const fromXero = row.xero_invoice_id !== null;

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-foreground">
                          <span className="flex flex-wrap items-center gap-2">
                            {row.name}
                            {fromXero && (
                              <Badge
                                variant="outline"
                                className="rounded-full text-[10px] uppercase tracking-wide"
                              >
                                Xero
                              </Badge>
                            )}
                          </span>
                        </TableCell>

                        <TableCell className="text-right tabular-nums text-foreground">
                          {formatMoney(row.amount_owed)}
                        </TableCell>

                        <TableCell
                          className={cn(
                            "text-muted-foreground",
                            overdue && "font-medium text-status-red",
                          )}
                        >
                          {formatDate(row.due_date)}
                          {overdue && <span className="ml-2 text-xs">overdue</span>}
                        </TableCell>

                        <TableCell>
                          {canApprove ? (
                            fromXero ? (
                              <Tooltip>
                                {/* A disabled trigger emits no pointer events, so
                                    the span is what the tooltip listens on. */}
                                <TooltipTrigger asChild>
                                  <span className="inline-block">
                                    <Select value={row.status} disabled>
                                      <SelectTrigger className="h-8 w-[170px] rounded-lg text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CREDITOR_STATUSES.map((value) => (
                                          <SelectItem key={value} value={value} className="text-xs">
                                            {STATUS_LABELS[value]}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Managed by Xero — change the status on the bill in Xero. An edit
                                  here would be reverted by the next sync.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Select
                                value={row.status}
                                disabled={changeStatus.isPending}
                                onValueChange={(value) =>
                                  changeStatus.mutate({ id: row.id, next: value as CreditorStatus })
                                }
                              >
                                <SelectTrigger className="h-8 w-[170px] rounded-lg text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CREDITOR_STATUSES.map((value) => (
                                    <SelectItem key={value} value={value} className="text-xs">
                                      {STATUS_LABELS[value]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )
                          ) : (
                            <Badge className={cn("rounded-full border-0", STATUS_STYLES[row.status])}>
                              {STATUS_LABELS[row.status]}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="max-w-xs text-muted-foreground">
                          {row.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {status === "all"
                          ? "No creditors on record."
                          : `No ${STATUS_LABELS[status].toLowerCase()} creditors.`}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <Pagination
        total={creditors.data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="creditors"
      />

      {canCreate && (
        <CreateCreditorDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          pending={create.isPending}
          onSubmit={(body) => create.mutate(body)}
        />
      )}
    </div>
  );
}

function CreateCreditorDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (body: {
    name: string;
    amount_owed: string;
    due_date?: string | null;
    status?: CreditorStatus;
    notes?: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<CreditorStatus>("outstanding");
  const [notes, setNotes] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAmount("");
    setDueDate("");
    setStatus("outstanding");
    setNotes("");
    setAmountError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a creditor</DialogTitle>
          <DialogDescription>
            Records an amount the company owes. Enter the amount exactly as it appears on the
            invoice — it is stored to the cent.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-creditor-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = amount.trim();

            // Validated here as a string. A `type="number"` input would hand
            // back a float and quietly round the cents before the value ever
            // left the browser, which is why the field is text/inputMode.
            if (!AMOUNT_PATTERN.test(trimmed) || Number(trimmed) <= 0) {
              setAmountError("Enter a positive amount with at most 2 decimal places.");
              return;
            }
            setAmountError(null);

            onSubmit({
              name: name.trim(),
              amount_owed: trimmed,
              due_date: dueDate === "" ? null : dueDate,
              status,
              notes: notes.trim() === "" ? null : notes.trim(),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="creditor-name">Name</Label>
            <Input
              id="creditor-name"
              required
              maxLength={200}
              className="rounded-xl"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="creditor-amount">Amount owed</Label>
              <Input
                id="creditor-amount"
                required
                // Text, never number — see the comment in the submit handler.
                type="text"
                inputMode="decimal"
                placeholder="1250.50"
                autoComplete="off"
                className="rounded-xl tabular-nums"
                aria-invalid={amountError !== null}
                aria-describedby={amountError ? "creditor-amount-error" : undefined}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {amountError && (
                <p id="creditor-amount-error" className="text-xs text-status-red">
                  {amountError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="creditor-due">Due date</Label>
              <Input
                id="creditor-due"
                type="date"
                className="rounded-xl"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="creditor-status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as CreditorStatus)}>
              <SelectTrigger id="creditor-status" className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDITOR_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="creditor-notes">Notes</Label>
            <Textarea
              id="creditor-notes"
              rows={3}
              maxLength={2000}
              className="rounded-xl"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-creditor-form" className="rounded-xl" disabled={pending}>
            {pending ? "Saving…" : "Add creditor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
