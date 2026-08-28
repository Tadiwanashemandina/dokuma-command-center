"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import { createTransactionSchema, reverseTransactionSchema } from "@/lib/validation/finance-schema";
import { createTransaction, reverseTransaction } from "@/lib/finance/transactions";

export type ActionResult = { ok: boolean; error?: string };

export async function createTransactionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const parsed = createTransactionSchema.safeParse({
    account_id: formData.get("account_id"),
    date: formData.get("date"),
    type: formData.get("type"),
    amount: formData.get("amount"),
    category: formData.get("category") || null,
    counterparty: formData.get("counterparty") || null,
    description: formData.get("description") || null,
    reference_no: formData.get("reference_no") || null,
    is_dlap: formData.get("is_dlap") === "on",
    dlap_share_pct: formData.get("dlap_share_pct") || null,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    await createTransaction(parsed.data, profile.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create transaction." };
  }

  revalidatePath("/finance/transactions");
  revalidatePath("/finance");
  return { ok: true };
}

export async function reverseTransactionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const parsed = reverseTransactionSchema.safeParse({
    transaction_id: formData.get("transaction_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    await reverseTransaction(parsed.data.transaction_id, parsed.data.reason, profile.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reverse transaction." };
  }

  revalidatePath("/finance/transactions");
  revalidatePath("/finance");
  return { ok: true };
}
