import { notFound } from "next/navigation";
import { requireRole, createClient } from "@/lib/supabase/server";
import { FinanceSubNav } from "@/components/finance/finance-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatUsd } from "@/lib/utils";
import { publishReportAction } from "../actions";

export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const canPublish = ["admin", "finance_manager"].includes(profile.role);

  const { id } = await params;
  const supabase = await createClient();
  const { data: report } = await supabase.from("finance_reports").select("*").eq("id", id).single();
  if (!report) notFound();

  const content = report.content as Record<string, unknown>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold capitalize text-navy">{report.type} Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(report.period_start)} — {formatDate(report.period_end)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            className={
              report.status === "published"
                ? "rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15"
                : "rounded-full border-0 bg-gold/15 text-gold hover:bg-gold/15"
            }
          >
            {report.status}
          </Badge>
          <Button asChild variant="outline">
            <a href={`/api/finance/reports/${report.id}/pdf`}>Download PDF</a>
          </Button>
          {report.status === "draft" && canPublish && (
            <form action={publishReportAction}>
              <input type="hidden" name="report_id" value={report.id} />
              <Button type="submit" className="bg-navy hover:bg-navy/90">
                Publish
              </Button>
            </form>
          )}
        </div>
      </div>

      <FinanceSubNav />

      {report.type === "daily" ? (
        <div className="space-y-4">
          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-4 text-sm">
              <Row label="Opening Balance" value={formatUsd(Number(content.openingBalance))} />
              <Row label="Transactions In" value={formatUsd(Number(content.transactionsIn))} />
              <Row label="Transactions Out" value={formatUsd(Number(content.transactionsOut))} />
              <Row label="Closing Balance" value={formatUsd(Number(content.closingBalance))} />
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="font-serif text-lg text-navy">Flagged Unusual Transactions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {((content.unusualTransactions as unknown[]) ?? []).length === 0 ? (
                <p className="text-muted-foreground">None — no transaction exceeded 2x the 30-day average.</p>
              ) : (
                (content.unusualTransactions as Array<{ id: string; type: string; amount: number; category: string | null; counterparty: string | null }>).map(
                  (t) => (
                    <div key={t.id} className="flex justify-between border-b border-border/60 py-1 last:border-0">
                      <span className="text-muted-foreground">
                        {t.type} · {t.category ?? "—"} · {t.counterparty ?? "—"}
                      </span>
                      <span className="font-medium text-status-red">{formatUsd(t.amount)}</span>
                    </div>
                  )
                )
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="1. Executive Summary" text={String(content.executive_summary ?? "")} />
          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-4 text-sm">
              <Row label="2. Opening Balance" value={formatUsd(Number(content.openingBalance))} />
              <Row label="3. Current Balance" value={formatUsd(Number(content.currentBalance))} />
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm text-steel">4. DLAP Transactions and Dokuma&apos;s Share</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              {(() => {
                const dlap = content.dlap as { totalAmount: number; dokumaShare: number; transactionCount: number };
                return (
                  <>
                    <Row label={`${dlap.transactionCount} DLAP transactions, total value`} value={formatUsd(dlap.totalAmount)} />
                    <Row label="Dokuma's Share" value={formatUsd(dlap.dokumaShare)} />
                  </>
                );
              })()}
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm text-steel">
                5. Comparison with Previous {report.type === "weekly" ? "Weeks" : "Months"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              {(content.trend as Array<{ label: string; closingBalance: number }>).map((t) => (
                <Row key={t.label} label={t.label} value={formatUsd(t.closingBalance)} />
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm text-steel">6. Creditors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              {(content.creditors as Array<{ id: string; name: string; status: string; amountOwed: number }>).length === 0 ? (
                <p className="text-muted-foreground">No outstanding creditors.</p>
              ) : (
                (content.creditors as Array<{ id: string; name: string; status: string; amountOwed: number }>).map((c) => (
                  <Row key={c.id} label={`${c.name} (${c.status})`} value={formatUsd(c.amountOwed)} />
                ))
              )}
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardContent className="p-4 text-sm">
              <Row label="7. Closing Balance" value={formatUsd(Number(content.closingBalance))} />
            </CardContent>
          </Card>
          <Section title="8. Key Advancements" text={String(content.key_advancements ?? "")} />
          <Section title="9. Challenges and How They Were Tackled" text={String(content.challenges ?? "")} />
          <Section
            title={report.type === "weekly" ? "10. Next Week Plan" : "10. Next Month Plan"}
            text={String(content.next_week_plan ?? content.next_month_plan ?? "")}
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-navy">{value}</span>
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="font-serif text-lg text-navy">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{text || "—"}</p>
      </CardContent>
    </Card>
  );
}
