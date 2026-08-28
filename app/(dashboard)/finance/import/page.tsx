import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { ImportWizard } from "./import-wizard";

export default async function FinanceImportPage() {
  await requireRole(["admin", "finance_officer", "finance_manager"]);
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("finance_accounts").select("id, name").eq("is_active", true).order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">Import transactions from a bank/mobile-money statement export.</p>
      </div>

      <FinanceSubNav />

      <ImportWizard accounts={accounts ?? []} />
    </div>
  );
}
