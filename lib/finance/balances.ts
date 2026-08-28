import { createClient } from "@/lib/supabase/server";

export type CashPositionByCurrency = {
  currency: string;
  totalBalance: number;
  accounts: { id: string; name: string; type: string; currentBalance: number }[];
};

/** Grouped by currency — never naively summed across currencies. */
export async function getCashPosition(): Promise<CashPositionByCurrency[]> {
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("finance_accounts")
    .select("id, name, type, currency, current_balance")
    .eq("is_active", true)
    .order("currency")
    .order("name");

  const byCurrency = new Map<string, CashPositionByCurrency>();
  for (const acc of accounts ?? []) {
    const bucket = byCurrency.get(acc.currency) ?? { currency: acc.currency, totalBalance: 0, accounts: [] };
    bucket.totalBalance += Number(acc.current_balance);
    bucket.accounts.push({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      currentBalance: Number(acc.current_balance),
    });
    byCurrency.set(acc.currency, bucket);
  }
  return Array.from(byCurrency.values());
}

/** Shared running-balance lookup — wraps the SQL function every report uses. */
export async function getAccountBalanceAsOf(accountId: string, asOfDate: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_balance_as_of", {
    p_account_id: accountId,
    p_as_of_date: asOfDate,
  });
  if (error) throw new Error(`get_account_balance_as_of failed: ${error.message}`);
  return Number(data ?? 0);
}

/** Total balance (all active accounts, all currencies mixed) as of a date — used for company-wide report totals where a single figure is expected. */
export async function getTotalBalanceAsOf(asOfDate: string): Promise<number> {
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("finance_accounts").select("id").eq("is_active", true);
  let total = 0;
  for (const acc of accounts ?? []) {
    total += await getAccountBalanceAsOf(acc.id, asOfDate);
  }
  return total;
}
