import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";
import { CreditorForm } from "./creditor-form";
import { CreditorStatusSelect } from "./status-select";

export default async function CreditorsPage() {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canCreate = ["admin", "finance_officer", "finance_manager"].includes(profile.role);
  const canEditStatus = ["admin", "finance_manager"].includes(profile.role);

  const supabase = await createClient();
  const { data: creditors } = await supabase
    .from("finance_creditors")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Amounts owed to third parties.</p>
        </div>
        {canCreate && <CreditorForm />}
      </div>

      <FinanceSubNav canWrite={canCreate} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Amount Owed</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditors?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-navy">{c.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatUsd(c.amount_owed)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(c.due_date)}</TableCell>
                  <TableCell>
                    {canEditStatus ? (
                      <CreditorStatusSelect creditorId={c.id} status={c.status} />
                    ) : (
                      <span className="text-sm capitalize text-muted-foreground">{c.status.replace("_", " ")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
