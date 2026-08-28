import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireRole, createClient } from "@/lib/supabase/server";
import { DailyReportDocument } from "@/lib/finance/pdf/DailyReportDocument";
import { WeeklyReportDocument, type WeeklyReportContent } from "@/lib/finance/pdf/WeeklyReportDocument";
import { MonthlyReportDocument, type MonthlyReportContent } from "@/lib/finance/pdf/MonthlyReportDocument";
import type { DailySnapshot } from "@/lib/finance/reports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: report, error } = await supabase.from("finance_reports").select("*").eq("id", id).single();
  if (error || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  let buffer: Buffer;
  if (report.type === "daily") {
    buffer = await renderToBuffer(<DailyReportDocument snapshot={report.content as unknown as DailySnapshot} />);
  } else if (report.type === "weekly") {
    buffer = await renderToBuffer(<WeeklyReportDocument content={report.content as unknown as WeeklyReportContent} />);
  } else {
    buffer = await renderToBuffer(<MonthlyReportDocument content={report.content as unknown as MonthlyReportContent} />);
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dokuma-${report.type}-report-${report.period_start}.pdf"`,
    },
  });
}
