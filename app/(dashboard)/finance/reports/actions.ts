"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { computeDailySnapshot, computeWeeklyReportData, computeMonthlyReportData } from "@/lib/finance/reports";
import { weeklyReportFreeTextSchema, monthlyReportFreeTextSchema } from "@/lib/validation/finance-schema";
import { createApprovalStep, decideApprovalStep } from "@/lib/approvals/approvals";
import { notify } from "@/lib/notifications/send";

const FINANCE_SIGNOFF_STEP = "finance_manager_signoff";

async function getFinanceManagerUserIds(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("profiles").select("id").in("role", ["finance_manager"]);
  return (data ?? []).map((p) => p.id);
}

export type ActionResult = { ok: boolean; error?: string };

/** Daily reports have no draft/publish step — they're auto-generated and
 * immediately final, per the brief ("auto-generated end-of-day snapshot"). */
export async function generateDailyReportAction(formData: FormData) {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);
  const date = (formData.get("date") as string) || new Date().toISOString().slice(0, 10);

  const snapshot = await computeDailySnapshot(date);
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("finance_reports")
    .insert({
      type: "daily",
      period_start: date,
      period_end: date,
      content: snapshot,
      generated_by: profile.id,
      status: "published",
      published_by: profile.id,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to generate daily report: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_daily_report_generated",
    entity_type: "finance_reports",
    entity_id: data.id,
    metadata: { date },
  });

  revalidatePath("/finance/reports");
  redirect(`/finance/reports/${data.id}`);
}

async function createPeriodReport(
  type: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
  freeText: Record<string, string>,
  actorId: string,
  actorRole: string,
  publishImmediately: boolean
) {
  const data =
    type === "weekly" ? await computeWeeklyReportData(periodStart, periodEnd) : await computeMonthlyReportData(periodStart, periodEnd);

  const canPublish = ["admin", "finance_manager"].includes(actorRole);
  const status = publishImmediately && canPublish ? "published" : "draft";

  const supabase = createServiceRoleClient();
  const { data: report, error } = await supabase
    .from("finance_reports")
    .insert({
      type,
      period_start: periodStart,
      period_end: periodEnd,
      content: { ...data, ...freeText },
      generated_by: actorId,
      status,
      published_by: status === "published" ? actorId : null,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create ${type} report: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: `finance_${type}_report_${status === "published" ? "published" : "drafted"}`,
    entity_type: "finance_reports",
    entity_id: report.id,
    metadata: { period_start: periodStart, period_end: periodEnd },
  });

  // A draft genuinely awaits sign-off — this is the approvals engine's
  // second real consumer, proving it's generic and not leave-specific.
  // An immediately-published report (Manager choosing "Save & Publish"
  // themselves) never had a pending state, so no step is created for it.
  if (status === "draft") {
    await createApprovalStep("finance_report", report.id, FINANCE_SIGNOFF_STEP);
    for (const managerUserId of await getFinanceManagerUserIds()) {
      await notify(managerUserId, {
        type: "finance_report_pending_signoff",
        title: `A ${type} finance report needs your sign-off`,
        body: `${periodStart} to ${periodEnd}.`,
        link: `/finance/reports/${report.id}`,
      });
    }
  }

  return report.id as string;
}

/**
 * The publish/draft choice is bound in from the page (`.bind(null, true|false)`
 * on the two submit buttons' formAction) rather than read from a form field.
 * React warns — and does not guarantee — that a button's name/value survive
 * when formAction is a Server Action function reference, so a plain form
 * field here would be unreliable for something this consequential.
 */
export async function createWeeklyReportAction(publishImmediately: boolean, formData: FormData) {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const periodStart = formData.get("period_start") as string;
  const periodEnd = formData.get("period_end") as string;

  const parsed = weeklyReportFreeTextSchema.safeParse({
    executive_summary: formData.get("executive_summary") || "",
    key_advancements: formData.get("key_advancements") || "",
    challenges: formData.get("challenges") || "",
    next_week_plan: formData.get("next_week_plan") || "",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const id = await createPeriodReport("weekly", periodStart, periodEnd, parsed.data, profile.id, profile.role, publishImmediately);
  revalidatePath("/finance/reports");
  redirect(`/finance/reports/${id}`);
}

export async function createMonthlyReportAction(publishImmediately: boolean, formData: FormData) {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const periodStart = formData.get("period_start") as string;
  const periodEnd = formData.get("period_end") as string;

  const parsed = monthlyReportFreeTextSchema.safeParse({
    executive_summary: formData.get("executive_summary") || "",
    key_advancements: formData.get("key_advancements") || "",
    challenges: formData.get("challenges") || "",
    next_month_plan: formData.get("next_month_plan") || "",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const id = await createPeriodReport("monthly", periodStart, periodEnd, parsed.data, profile.id, profile.role, publishImmediately);
  revalidatePath("/finance/reports");
  redirect(`/finance/reports/${id}`);
}

export async function publishReportAction(formData: FormData) {
  const profile = await requireRole(["admin", "finance_manager"]);
  const reportId = formData.get("report_id") as string;

  const supabase = createServiceRoleClient();
  const { data: report, error } = await supabase
    .from("finance_reports")
    .update({ status: "published", published_by: profile.id, published_at: new Date().toISOString() })
    .eq("id", reportId)
    .select("type, generated_by")
    .single();
  if (error) throw new Error(`Failed to publish report: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "finance_report_published",
    entity_type: "finance_reports",
    entity_id: reportId,
    metadata: {},
  });

  await decideApprovalStep("finance_report", reportId, FINANCE_SIGNOFF_STEP, "approved", profile.id, null);

  if (report.generated_by && report.generated_by !== profile.id) {
    await notify(report.generated_by, {
      type: "finance_report_published",
      title: `Your ${report.type} report was published`,
      link: `/finance/reports/${reportId}`,
    });
  }

  revalidatePath(`/finance/reports/${reportId}`);
  revalidatePath("/finance/reports");
}
