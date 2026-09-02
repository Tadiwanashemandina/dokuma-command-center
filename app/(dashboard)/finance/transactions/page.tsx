import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";
import { TransactionForm } from "./transaction-form";
import { ReverseButton } from "./reverse-button";
import { ReceiptButton } from "./receipt-button";

export default async function TransactionsPage() {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canWrite = ["admin", "finance_officer", "finance_manager"].includes(profile.role);

  const supabase = await createClient();
  const [{ data: transactions }, { data: accounts }] = await Promise.all([
    supabase
      .from("finance_transactions")
      .select("*, finance_accounts(name)")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("finance_accounts").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every recorded transaction across all accounts.</p>
        </div>
        {canWrite && <TransactionForm accounts={accounts ?? []} />}
      </div>

      <FinanceSubNav canWrite={canWrite} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>DLAP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">{formatDate(t.date)}</TableCell>
                  <TableCell className="text-navy">
                    {(t.finance_accounts as unknown as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        t.type === "credit"
                          ? "rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15"
                          : "rounded-full border-0 bg-status-red/15 text-status-red hover:bg-status-red/15"
                      }
                    >
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-navy">{formatUsd(t.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{t.category ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.counterparty ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.is_dlap ? `${t.dlap_share_pct ?? 0}%` : "—"}</TableCell>
                  <TableCell>
                    {t.is_reversed ? (
                      <Badge variant="outline">Reversed</Badge>
                    ) : t.reverses_transaction_id ? (
                      <Badge variant="outline">Reversal</Badge>
                    ) : (
                      <Badge variant="outline">Posted</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ReceiptButton transactionId={t.id} receiptPath={t.receipt_path} canUpload={canWrite} />
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      {!t.is_reversed && !t.reverses_transaction_id && <ReverseButton transactionId={t.id} />}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
