import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireRole, createClient } from "@/lib/supabase/server";
import { PaymentNoticeDocument } from "@/lib/finance/pdf/PaymentNoticeDocument";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: notice, error } = await supabase.from("finance_payment_notices").select("*").eq("id", id).single();
  if (error || !notice) {
    return NextResponse.json({ error: "Payment notice not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    <PaymentNoticeDocument
      notice={{
        period: notice.period,
        payee: notice.payee,
        amount: Number(notice.amount),
        due_date: notice.due_date,
        status: notice.status,
        notes: notice.notes,
      }}
    />
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dokuma-payment-notice-${notice.id}.pdf"`,
    },
  });
}
