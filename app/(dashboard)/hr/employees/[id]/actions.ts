"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { validateDocumentFile, uploadDocument, getSignedDocumentUrl } from "@/lib/storage/documents";

export type ActionResult = { ok: boolean; error?: string };

export async function uploadJdAttachmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const jdId = formData.get("job_description_id");
  const employeeId = formData.get("employee_id");
  const file = formData.get("file");
  if (typeof jdId !== "string" || !jdId || typeof employeeId !== "string" || !employeeId) {
    return { ok: false, error: "Missing job description." };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "No file selected." };
  }

  const fileError = validateDocumentFile(file);
  if (fileError) return { ok: false, error: fileError };

  const path = `${employeeId}/${Date.now()}-${file.name}`;

  try {
    await uploadDocument("jd-documents", path, file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }

  const supabase = createServiceRoleClient();
  const { error: updateError } = await supabase.from("job_descriptions").update({ attachment_path: path }).eq("id", jdId);
  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "jd_attachment_uploaded",
    entity_type: "job_descriptions",
    entity_id: jdId,
    metadata: { filename: file.name, size: file.size },
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  return { ok: true };
}

export async function getJdAttachmentUrlAction(path: string): Promise<string | null> {
  await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  return getSignedDocumentUrl("jd-documents", path);
}
