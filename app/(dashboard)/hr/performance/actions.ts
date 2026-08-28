"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/hr/employees";
import { createPerformanceReviewSchema } from "@/lib/validation/hr-schema";

export type ActionResult = { ok: boolean; error?: string };

/** Reviewer defaults to the caller's own linked employee record (a
 * Supervisor reviewing their own direct report), unless HR/admin, who may
 * leave the reviewer unset. */
export async function createPerformanceReviewAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "supervisor", "hr_officer", "hr_manager"]);
  const reviewer = await getCurrentEmployee();

  const parsed = createPerformanceReviewSchema.safeParse({
    employee_id: formData.get("employee_id"),
    period: formData.get("period"),
    goals: formData.get("goals") || "",
    rating: formData.get("rating") || null,
    comments: formData.get("comments") || null,
    status: formData.get("status") || "draft",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("performance_reviews")
    .insert({
      employee_id: parsed.data.employee_id,
      period: parsed.data.period,
      reviewer_id: reviewer?.id ?? null,
      goals: parsed.data.goals ? [{ text: parsed.data.goals }] : [],
      rating: parsed.data.rating,
      comments: parsed.data.comments,
      status: parsed.data.status,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "performance_review_created",
    entity_type: "performance_reviews",
    entity_id: data.id,
    metadata: { employee_id: parsed.data.employee_id, period: parsed.data.period },
  });

  revalidatePath("/hr/performance");
  return { ok: true };
}
