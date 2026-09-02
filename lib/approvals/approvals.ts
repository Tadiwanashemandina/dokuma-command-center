import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * The generic approvals engine. `leave_requests.status` remains the source
 * of truth for the leave workflow's own logic and UI — this is a parallel
 * ledger so any consumer (a future Finance sign-off, a payment-notice
 * authorization, ...) can query "what's pending across the whole platform"
 * from one table instead of every module inventing its own. See
 * supabase/migrations/0027_approvals_engine.sql.
 */
export async function createApprovalStep(approvableType: string, approvableId: string, step: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("approvals").insert({
    approvable_type: approvableType,
    approvable_id: approvableId,
    step,
    status: "pending",
  });
  if (error) throw new Error(`createApprovalStep failed: ${error.message}`);
}

export async function decideApprovalStep(
  approvableType: string,
  approvableId: string,
  step: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  comment: string | null
) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("approvals")
    .update({ status: decision, decided_by: decidedBy, decided_at: new Date().toISOString(), comment })
    .eq("approvable_type", approvableType)
    .eq("approvable_id", approvableId)
    .eq("step", step)
    .eq("status", "pending");
  if (error) throw new Error(`decideApprovalStep failed: ${error.message}`);
}
