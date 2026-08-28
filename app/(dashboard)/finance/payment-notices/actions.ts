"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { createPaymentNoticeSchema } from "@/lib/validation/finance-schema";

export type ActionResult = { ok: boolean; error?: string };

export async function createPaymentNoticeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const parsed = createPaymentNoticeSchema.safeParse({
    period: formData.get("period"),
    payee: formData.get("payee"),
    amount: formData.get("amount"),
    due_date: formData.get("due_date"),
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("finance_payment_notices").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_payment_notice_created",
    entity_type: "finance_payment_notices",
    entity_id: data.id,
    metadata: { payee: parsed.data.payee, amount: parsed.data.amount },
  });

  revalidatePath("/finance/payment-notices");
  return { ok: true };
}

export async function updatePaymentNoticeStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_manager"]);

  const noticeId = formData.get("notice_id") as string;
  const status = formData.get("status") as string;
  if (!["scheduled", "sent", "paid"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("finance_payment_notices")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", noticeId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_payment_notice_status_updated",
    entity_type: "finance_payment_notices",
    entity_id: noticeId,
    metadata: { status },
  });

  revalidatePath("/finance/payment-notices");
  return { ok: true };
}
