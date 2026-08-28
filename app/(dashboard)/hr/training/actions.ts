"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { createTrainingRecordSchema } from "@/lib/validation/hr-schema";

export type ActionResult = { ok: boolean; error?: string };

export async function createTrainingRecordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const parsed = createTrainingRecordSchema.safeParse({
    employee_id: formData.get("employee_id"),
    course_name: formData.get("course_name"),
    provider: formData.get("provider") || null,
    completed_at: formData.get("completed_at") || null,
    expires_at: formData.get("expires_at") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("training_records").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "training_record_created",
    entity_type: "training_records",
    entity_id: data.id,
    metadata: { employee_id: parsed.data.employee_id, course_name: parsed.data.course_name },
  });

  revalidatePath("/hr/training");
  return { ok: true };
}
