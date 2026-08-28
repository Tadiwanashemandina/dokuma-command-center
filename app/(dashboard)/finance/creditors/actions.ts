"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { createCreditorSchema } from "@/lib/validation/finance-schema";

export type ActionResult = { ok: boolean; error?: string };

/** Finance Officer, Manager, and admin can all create creditors. */
export async function createCreditorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const parsed = createCreditorSchema.safeParse({
    name: formData.get("name"),
    amount_owed: formData.get("amount_owed"),
    due_date: formData.get("due_date") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("finance_creditors").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_creditor_created",
    entity_type: "finance_creditors",
    entity_id: data.id,
    metadata: { name: parsed.data.name, amount_owed: parsed.data.amount_owed },
  });

  revalidatePath("/finance/creditors");
  return { ok: true };
}

/** Editing status is Finance Manager/CFO territory, per the brief. */
export async function updateCreditorStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_manager"]);

  const creditorId = formData.get("creditor_id") as string;
  const status = formData.get("status") as string;
  if (!["outstanding", "partially_paid", "paid"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("finance_creditors")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", creditorId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_creditor_status_updated",
    entity_type: "finance_creditors",
    entity_id: creditorId,
    metadata: { status },
  });

  revalidatePath("/finance/creditors");
  return { ok: true };
}
