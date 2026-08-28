import { requireRole } from "@/lib/supabase/server";
import { computeMonthlyReportData } from "@/lib/finance/reports";
import { createMonthlyReportAction } from "../../actions";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/utils";

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default async function NewMonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period_start?: string; period_end?: string }>;
}) {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);
  const canPublish = ["admin", "finance_manager"].includes(profile.role);

  const params = await searchParams;
  const defaults = currentMonthRange();
  const periodStart = params.period_start || defaults.start;
  const periodEnd = params.period_end || defaults.end;

  const data = await computeMonthlyReportData(periodStart, periodEnd);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">New Monthly Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {periodStart} to {periodEnd}
        </p>
      </div>

      <FinanceSubNav />

      <form className="space-y-6">
        <input type="hidden" name="period_start" value={periodStart} />
        <input type="hidden" name="period_end" value={periodEnd} />

        <div className="space-y-2">
          <Label htmlFor="executive_summary">1. Executive Summary</Label>
          <Textarea id="executive_summary" name="executive_summary" required rows={4} />
        </div>

        <Card className="rounded-2xl bg-muted/40">
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">2. Opening Balance</span>
              <span className="font-medium text-navy">{formatUsd(data.openingBalance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">3. Current Balance</span>
              <span className="font-medium text-navy">{formatUsd(data.currentBalance)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-steel">4. DLAP Transactions and Dokuma&apos;s Share</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{data.dlap.transactionCount} DLAP transactions, total value</span>
              <span className="font-medium text-navy">{formatUsd(data.dlap.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dokuma&apos;s Share</span>
              <span className="font-medium text-navy">{formatUsd(data.dlap.dokumaShare)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-steel">5. Comparison with Previous Months</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-sm">
            {data.trend.map((t) => (
              <div key={t.label} className="flex justify-between">
                <span className="text-muted-foreground">{t.label}</span>
                <span className="font-medium text-navy">{formatUsd(t.closingBalance)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-steel">6. Creditors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-sm">
            {data.creditors.length === 0 ? (
              <p className="text-muted-foreground">No outstanding creditors.</p>
            ) : (
              data.creditors.map((c) => (
                <div key={c.id} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {c.name} ({c.status})
                  </span>
                  <span className="font-medium text-navy">{formatUsd(c.amountOwed)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between rounded-xl bg-muted/40 p-4 text-sm">
          <span className="text-muted-foreground">7. Closing Balance</span>
          <span className="font-medium text-navy">{formatUsd(data.closingBalance)}</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="key_advancements">8. Key Advancements</Label>
          <Textarea id="key_advancements" name="key_advancements" required rows={3} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="challenges">9. Challenges and How They Were Tackled</Label>
          <Textarea id="challenges" name="challenges" required rows={3} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="next_month_plan">10. Next Month Plan</Label>
          <Textarea id="next_month_plan" name="next_month_plan" required rows={3} />
        </div>

        <div className="flex gap-3">
          <Button type="submit" name="action" value="draft" formAction={createMonthlyReportAction} variant="outline">
            Save as Draft
          </Button>
          {canPublish && (
            <Button type="submit" name="action" value="publish" formAction={createMonthlyReportAction} className="bg-navy hover:bg-navy/90">
              Save &amp; Publish
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
