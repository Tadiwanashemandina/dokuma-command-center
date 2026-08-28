import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CreateTransactionInput } from "@/lib/validation/finance-schema";

/** Always called from a Server Action after requireRole() + zod validation
 * have already run — never invoked directly from a client component. */
export async function createTransaction(input: CreateTransactionInput, createdBy: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert({ ...input, source: "manual", created_by: createdBy })
    .select()
    .single();

  if (error) throw new Error(`createTransaction failed: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: createdBy,
    action: "finance_transaction_created",
    entity_type: "finance_transactions",
    entity_id: data.id,
    metadata: { account_id: input.account_id, amount: input.amount, type: input.type },
  });

  return data;
}

/** A reversal is a new, real offsetting transaction — never a delete or an
 * update to the original row. Both the reversal and the audit entry are
 * written atomically-enough for this app's needs (sequential inserts; a true
 * DB transaction would need a Postgres function, not needed at this scale). */
export async function reverseTransaction(transactionId: string, reason: string, actorId: string) {
  const supabase = createServiceRoleClient();

  const { data: original, error: fetchError } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("id", transactionId)
    .single();
  if (fetchError || !original) throw new Error(`Transaction not found: ${fetchError?.message ?? transactionId}`);
  if (original.is_reversed) throw new Error("This transaction has already been reversed.");

  const oppositeType = original.type === "debit" ? "credit" : "debit";

  const { data: reversal, error: insertError } = await supabase
    .from("finance_transactions")
    .insert({
      account_id: original.account_id,
      date: new Date().toISOString().slice(0, 10),
      type: oppositeType,
      amount: original.amount,
      category: original.category,
      counterparty: original.counterparty,
      description: `Reversal of ${original.id}: ${reason}`,
      reference_no: original.reference_no,
      is_dlap: original.is_dlap,
      dlap_share_pct: original.dlap_share_pct,
      source: "manual",
      reverses_transaction_id: original.id,
      created_by: actorId,
    })
    .select()
    .single();
  if (insertError) throw new Error(`reverseTransaction failed: ${insertError.message}`);

  await supabase.from("finance_transactions").update({ is_reversed: true }).eq("id", original.id);

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: "finance_transaction_reversed",
    entity_type: "finance_transactions",
    entity_id: original.id,
    metadata: { reason, reversal_transaction_id: reversal.id, amount: original.amount },
  });

  return reversal;
}
