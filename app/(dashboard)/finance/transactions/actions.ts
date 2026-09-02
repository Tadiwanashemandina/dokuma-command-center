"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { createTransactionSchema, reverseTransactionSchema } from "@/lib/validation/finance-schema";
import { createTransaction, reverseTransaction } from "@/lib/finance/transactions";
import { validateDocumentFile, uploadDocument, getSignedDocumentUrl } from "@/lib/storage/documents";

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

export async function uploadReceiptAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const transactionId = formData.get("transaction_id");
  const file = formData.get("file");
  if (typeof transactionId !== "string" || !transactionId) {
    return { ok: false, error: "Missing transaction." };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "No file selected." };
  }

  const fileError = validateDocumentFile(file);
  if (fileError) return { ok: false, error: fileError };

  const path = `${transactionId}/${Date.now()}-${file.name}`;

  try {
    await uploadDocument("receipts", path, file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }

  const supabase = createServiceRoleClient();
  const { error: updateError } = await supabase
    .from("finance_transactions")
    .update({ receipt_path: path })
    .eq("id", transactionId);
  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "receipt_uploaded",
    entity_type: "finance_transactions",
    entity_id: transactionId,
    metadata: { filename: file.name, size: file.size },
  });

  revalidatePath("/finance/transactions");
  return { ok: true };
}

export async function getReceiptUrlAction(path: string): Promise<string | null> {
  await requireRole(["admin", "exec", "finance_officer", "finance_manager"]);
  return getSignedDocumentUrl("receipts", path);
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
