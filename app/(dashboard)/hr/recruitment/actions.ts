"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { createJobOpeningSchema, createCandidateSchema, updateApplicationStageSchema } from "@/lib/validation/hr-schema";

export type ActionResult = { ok: boolean; error?: string };

export async function createJobOpeningAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const parsed = createJobOpeningSchema.safeParse({
    title: formData.get("title"),
    department: formData.get("department") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("job_openings").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "job_opening_created",
    entity_type: "job_openings",
    entity_id: data.id,
    metadata: { title: parsed.data.title },
  });

  revalidatePath("/hr/recruitment");
  return { ok: true };
}

export async function createCandidateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const parsed = createCandidateSchema.safeParse({
    job_opening_id: formData.get("job_opening_id"),
    full_name: formData.get("full_name"),
    email: formData.get("email") || "",
    phone: formData.get("phone") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };

  const supabase = createServiceRoleClient();
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .insert({ full_name: parsed.data.full_name, email: parsed.data.email || null, phone: parsed.data.phone })
    .select("id")
    .single();
  if (candidateError) return { ok: false, error: candidateError.message };

  const { error: applicationError } = await supabase
    .from("applications")
    .insert({ job_opening_id: parsed.data.job_opening_id, candidate_id: candidate.id, stage: "applied" });
  if (applicationError) return { ok: false, error: applicationError.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "candidate_added",
    entity_type: "candidates",
    entity_id: candidate.id,
    metadata: { job_opening_id: parsed.data.job_opening_id, full_name: parsed.data.full_name },
  });

  revalidatePath("/hr/recruitment");
  return { ok: true };
}

export async function updateApplicationStageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const parsed = updateApplicationStageSchema.safeParse({
    application_id: formData.get("application_id"),
    stage: formData.get("stage"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("applications")
    .update({ stage: parsed.data.stage, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.application_id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "application_stage_updated",
    entity_type: "applications",
    entity_id: parsed.data.application_id,
    metadata: { stage: parsed.data.stage },
  });

  revalidatePath("/hr/recruitment");
  return { ok: true };
}
