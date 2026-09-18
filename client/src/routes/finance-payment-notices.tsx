import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  FINANCE_APPROVE,
  FINANCE_WRITE,
  PAYMENT_NOTICE_STATUSES,
  type PaymentNoticeStatus,
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
import { QueryError, TableSkeleton } from "@/components/query-states";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { CsvExportButton } from "@/components/finance/csv-export-button";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import {
  createPaymentNotice,
  listPaymentNotices,
  updatePaymentNoticeStatus,
} from "@/lib/api/finance";

/**
 * Payment notices — what is scheduled to go out, and whether it has.
 *
 * The list defaults to the CURRENT CALENDAR MONTH. That is the intended
 * behaviour rather than a paging limit: a notice matters in the month it falls
 * due, and opening the page on the whole history buries this month's work. The
 * server echoes which filter it applied as `month`, and the heading is driven
 * from that echo rather than from local state, so the title can never claim a
 * scope the rows do not have.
 *
 * Amounts are exact decimal strings throughout — displayed via `formatMoney`,
 * entered through a text input, never converted to a number.
 */

const STATUS_LABELS: Record<PaymentNoticeStatus, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  paid: "Paid",
};

const STATUS_STYLES: Record<PaymentNoticeStatus, string> = {
  scheduled: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  sent: "bg-steel/15 text-steel hover:bg-steel/15",
  paid: "bg-status-green/15 text-status-green hover:bg-status-green/15",
};

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export function FinancePaymentNoticesPage() {
  useDocumentTitle("Payment Notices");

  const queryClient = useQueryClient();
  const { user } = useAuth();

  const canCreate = user !== null && FINANCE_WRITE.includes(user.role);
  const canApprove = user !== null && FINANCE_APPROVE.includes(user.role);

  const [month, setMonth] = useState<"current" | "all">("current");
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const notices = useQuery({
    queryKey: ["finance", "payment-notices", month, offset],
    queryFn: () => listPaymentNotices({ month, limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["finance", "payment-notices"] });

  const describeError = (caught: unknown) =>
    setActionError(
      caught instanceof ApiRequestError ? caught.message : "That action failed. Try again.",
    );

  const create = useMutation({
    mutationFn: createPaymentNotice,
    async onSuccess() {
      setCreateOpen(false);
      setActionError(null);
      await invalidate();
    },
    onError: describeError,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: PaymentNoticeStatus }) =>
      updatePaymentNoticeStatus(id, next),
    async onSuccess() {
      setActionError(null);
      await invalidate();
    },
    onError: describeError,
  });

  const rows = notices.data?.items ?? [];
  // The server's echo, not the local toggle — while a switch is in flight the
  // rows on screen still belong to the previous scope, and the heading should
  // describe what is actually shown.
  const appliedMonth = notices.data?.month ?? month;

  const csvRows = rows.map((row) => [
    row.period,
    row.payee,
    formatMoney(row.amount),
    row.due_date ?? "",
    STATUS_LABELS[row.status],
    row.notes ?? "",
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Payment Notices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled payments and their state, period by period.
          </p>
        </div>
        <FinanceSubnav />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {appliedMonth === "current" ? "Notices due this month" : "All notices"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {appliedMonth === "current"
              ? "Showing the current calendar month only. Switch to all to see every period."
              : "Showing every notice on record, newest period first."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Period filter"
            className="flex items-center gap-1 rounded-xl border border-border p-1"
          >
            {(["current", "all"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={month === value ? "default" : "ghost"}
                aria-pressed={month === value}
                className="rounded-lg"
                onClick={() => {
                  setMonth(value);
                  setOffset(0);
                }}
              >
                {value === "current" ? "This month" : "All"}
              </Button>
            ))}
          </div>

          <CsvExportButton
            filename={`payment-notices-${appliedMonth}`}
            headers={["Period", "Payee", "Amount", "Due date", "Status", "Notes"]}
            rows={csvRows}
            disabled={notices.isPending}
          />

          {canCreate && (
            <Button className="rounded-xl" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New notice
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
          {notices.isPending && <TableSkeleton columns={6} />}

          {notices.error && (
            <div className="p-4">
              <QueryError
                error={notices.error}
                onRetry={() => void notices.refetch()}
                resource="payment notices"
              />
            </div>
          )}

          {!notices.isPending && !notices.error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">{row.period}</TableCell>
                    <TableCell className="text-foreground">{row.payee}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {formatMoney(row.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.due_date)}</TableCell>
                    <TableCell>
                      {canApprove ? (
                        <Select
                          value={row.status}
                          disabled={changeStatus.isPending}
                          onValueChange={(value) =>
                            changeStatus.mutate({ id: row.id, next: value as PaymentNoticeStatus })
                          }
                        >
                          <SelectTrigger className="h-8 w-[150px] rounded-lg text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_NOTICE_STATUSES.map((value) => (
                              <SelectItem key={value} value={value} className="text-xs">
                                {STATUS_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                ))}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {appliedMonth === "current"
                        ? "No notices fall due this month. Switch to “All” to see other periods."
                        : "No payment notices on record."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        total={notices.data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
        label="notices"
      />

      {canCreate && (
        <CreatePaymentNoticeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          pending={create.isPending}
          onSubmit={(body) => create.mutate(body)}
        />
      )}
    </div>
  );
}

function CreatePaymentNoticeDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (body: {
    period: string;
    payee: string;
    amount: string;
    due_date: string;
    status?: PaymentNoticeStatus;
    notes?: string | null;
  }) => void;
}) {
  const [period, setPeriod] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<PaymentNoticeStatus>("scheduled");
  const [notes, setNotes] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const reset = () => {
    setPeriod("");
    setPayee("");
    setAmount("");
    setDueDate("");
    setStatus("scheduled");
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
          <DialogTitle>New payment notice</DialogTitle>
          <DialogDescription>
            The period is free text as it should read on the notice — for example “September 2026”.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-notice-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = amount.trim();

            // A text field plus this regex keeps the amount an exact decimal
            // string end to end; `type="number"` would round it to a float
            // before submission and lose the cents.
            if (!AMOUNT_PATTERN.test(trimmed) || Number(trimmed) <= 0) {
              setAmountError("Enter a positive amount with at most 2 decimal places.");
              return;
            }
            setAmountError(null);

            onSubmit({
              period: period.trim(),
              payee: payee.trim(),
              amount: trimmed,
              due_date: dueDate,
              status,
              notes: notes.trim() === "" ? null : notes.trim(),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="notice-period">Period</Label>
              <Input
                id="notice-period"
                required
                maxLength={50}
                placeholder="September 2026"
                className="rounded-xl"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notice-payee">Payee</Label>
              <Input
                id="notice-payee"
                required
                maxLength={200}
                className="rounded-xl"
                value={payee}
                onChange={(event) => setPayee(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="notice-amount">Amount</Label>
              <Input
                id="notice-amount"
                required
                type="text"
                inputMode="decimal"
                placeholder="1250.50"
                autoComplete="off"
                className="rounded-xl tabular-nums"
                aria-invalid={amountError !== null}
                aria-describedby={amountError ? "notice-amount-error" : undefined}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {amountError && (
                <p id="notice-amount-error" className="text-xs text-status-red">
                  {amountError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notice-due">Due date</Label>
              <Input
                id="notice-due"
                type="date"
                required
                className="rounded-xl"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notice-status">Status</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as PaymentNoticeStatus)}
            >
              <SelectTrigger id="notice-status" className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_NOTICE_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notice-notes">Notes</Label>
            <Textarea
              id="notice-notes"
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
          <Button type="submit" form="create-notice-form" className="rounded-xl" disabled={pending}>
            {pending ? "Saving…" : "Create notice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
