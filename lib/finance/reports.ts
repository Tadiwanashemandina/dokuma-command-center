import { createClient } from "@/lib/supabase/server";
import { getTotalBalanceAsOf } from "./balances";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type UnusualTransaction = {
  id: string;
  account_id: string;
  date: string;
  type: string;
  amount: number;
  category: string | null;
  counterparty: string | null;
  description: string | null;
};

export type DailySnapshot = {
  date: string;
  openingBalance: number;
  closingBalance: number;
  transactionsIn: number;
  transactionsOut: number;
  unusualTransactions: UnusualTransaction[];
};

/** Auto-generated end-of-day snapshot. Called on-demand today (manual
 * "Generate" trigger); a future Vercel Cron can call this same function on a
 * schedule without any change here. */
export async function computeDailySnapshot(date: string): Promise<DailySnapshot> {
  const supabase = await createClient();
  const openingBalance = await getTotalBalanceAsOf(addDays(date, -1));
  const closingBalance = await getTotalBalanceAsOf(date);

  const { data: txns } = await supabase
    .from("finance_transactions")
    .select("amount, type")
    .eq("date", date);

  const transactionsIn = (txns ?? []).filter((t) => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
  const transactionsOut = (txns ?? []).filter((t) => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);

  const { data: accounts } = await supabase.from("finance_accounts").select("id").eq("is_active", true);
  const unusualTransactions: UnusualTransaction[] = [];
  for (const acc of accounts ?? []) {
    const { data: flagged } = await supabase.rpc("get_unusual_transactions", {
      p_account_id: acc.id,
      p_check_date: date,
    });
    for (const t of flagged ?? []) {
      unusualTransactions.push({
        id: t.id,
        account_id: t.account_id,
        date: t.date,
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        counterparty: t.counterparty,
        description: t.description,
      });
    }
  }

  return { date, openingBalance, closingBalance, transactionsIn, transactionsOut, unusualTransactions };
}

export type DlapSummary = { totalAmount: number; dokumaShare: number; transactionCount: number };

async function computeDlapShare(periodStart: string, periodEnd: string): Promise<DlapSummary> {
  const supabase = await createClient();
  const { data: txns } = await supabase
    .from("finance_transactions")
    .select("amount, dlap_share_pct")
    .eq("is_dlap", true)
    .gte("date", periodStart)
    .lte("date", periodEnd);

  let totalAmount = 0;
  let dokumaShare = 0;
  for (const t of txns ?? []) {
    const amount = Number(t.amount);
    totalAmount += amount;
    dokumaShare += amount * (Number(t.dlap_share_pct ?? 0) / 100);
  }
  return { totalAmount, dokumaShare, transactionCount: (txns ?? []).length };
}

export type TrendPoint = { label: string; periodStart: string; periodEnd: string; closingBalance: number };

export type CreditorSummary = { id: string; name: string; amountOwed: number; dueDate: string | null; status: string };

async function getCurrentCreditors(): Promise<CreditorSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("finance_creditors")
    .select("id, name, amount_owed, due_date, status")
    .neq("status", "paid")
    .order("due_date", { ascending: true });

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    amountOwed: Number(c.amount_owed),
    dueDate: c.due_date,
    status: c.status,
  }));
}

export type PeriodReportData = {
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  currentBalance: number;
  closingBalance: number;
  dlap: DlapSummary;
  trend: TrendPoint[];
  creditors: CreditorSummary[];
};

/**
 * Shared computation for weekly/monthly reports.
 *
 * "Current Balance" and "Closing Balance" are deliberately two different
 * figures: Closing Balance is the account balance AT period_end (the actual
 * period being reported on); Current Balance is the LIVE balance as of
 * today (report generation time). For a report generated shortly after its
 * period ends, these will usually match; for a report generated later, the
 * gap between them tells the reader how much has moved since.
 */
async function computePeriodReportData(
  periodStart: string,
  periodEnd: string,
  trendWindows: { label: string; start: string; end: string }[]
): Promise<PeriodReportData> {
  const openingBalance = await getTotalBalanceAsOf(addDays(periodStart, -1));
  const closingBalance = await getTotalBalanceAsOf(periodEnd);
  const currentBalance = await getTotalBalanceAsOf(today());
  const dlap = await computeDlapShare(periodStart, periodEnd);
  const creditors = await getCurrentCreditors();

  const trend: TrendPoint[] = [];
  for (const w of trendWindows) {
    trend.push({ label: w.label, periodStart: w.start, periodEnd: w.end, closingBalance: await getTotalBalanceAsOf(w.end) });
  }

  return { periodStart, periodEnd, openingBalance, currentBalance, closingBalance, dlap, trend, creditors };
}

/** Weekly report: trend = the same day-of-week close for each of the last 4 weeks. */
export async function computeWeeklyReportData(periodStart: string, periodEnd: string): Promise<PeriodReportData> {
  const trendWindows = [4, 3, 2, 1].map((weeksAgo) => {
    const start = addDays(periodStart, -7 * weeksAgo);
    const end = addDays(periodEnd, -7 * weeksAgo);
    return { label: `${weeksAgo} week${weeksAgo > 1 ? "s" : ""} ago`, start, end };
  });
  return computePeriodReportData(periodStart, periodEnd, trendWindows);
}

/** Monthly report: trend = closing balance at the end of each of the last 3 months. */
export async function computeMonthlyReportData(periodStart: string, periodEnd: string): Promise<PeriodReportData> {
  const trendWindows = [3, 2, 1].map((monthsAgo) => {
    const start = addDays(periodStart, -30 * monthsAgo);
    const end = addDays(periodEnd, -30 * monthsAgo);
    return { label: `${monthsAgo} month${monthsAgo > 1 ? "s" : ""} ago`, start, end };
  });
  return computePeriodReportData(periodStart, periodEnd, trendWindows);
}
