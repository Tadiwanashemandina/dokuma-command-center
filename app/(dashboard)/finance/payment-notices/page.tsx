import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";
import { PaymentNoticeForm } from "./notice-form";
import { PaymentNoticeStatusSelect } from "./status-select";
import { checkPaymentNoticesDueSoon } from "@/lib/notifications/triggers";
import { CsvExportButton } from "@/components/csv-export-button";

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default async function PaymentNoticesPage() {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canCreate = ["admin", "finance_officer", "finance_manager"].includes(profile.role);
  const canEditStatus = ["admin", "finance_manager"].includes(profile.role);

  await checkPaymentNoticesDueSoon();

  const { start, end } = currentMonthRange();
  const supabase = await createClient();
  const { data: notices } = await supabase
    .from("finance_payment_notices")
    .select("*")
    .gte("due_date", start)
    .lte("due_date", end)
    .order("due_date", { ascending: true });

  const csvRows = (notices ?? []).map((n) => [n.period, n.payee, n.amount, formatDate(n.due_date), n.status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Payment notices due this month ({start} to {end}).</p>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename="payment-notices.csv"
            headers={["Period", "Payee", "Amount", "Due Date", "Status"]}
            rows={csvRows}
          />
          {canCreate && <PaymentNoticeForm />}
        </div>
      </div>

      <FinanceSubNav canWrite={canCreate} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {notices?.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="text-muted-foreground">{n.period}</TableCell>
                  <TableCell className="font-medium text-navy">{n.payee}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatUsd(n.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(n.due_date)}</TableCell>
                  <TableCell>
                    {canEditStatus ? (
                      <PaymentNoticeStatusSelect noticeId={n.id} status={n.status} />
                    ) : (
                      <span className="text-sm capitalize text-muted-foreground">{n.status}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/api/finance/payment-notices/${n.id}/pdf`}>PDF</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!notices || notices.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No payment notices due this month.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
