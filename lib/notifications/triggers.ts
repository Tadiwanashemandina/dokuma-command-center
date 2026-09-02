import { createServiceRoleClient } from "@/lib/supabase/server";
import { notify } from "./send";

/**
 * Checked on page load rather than via a cron (same pragmatic "manual
 * trigger, cron later" pattern as Phase 1's daily finance report — no new
 * scheduling infrastructure needed today). Deduped per-entity so revisiting
 * the page repeatedly doesn't re-notify: before sending, this checks
 * whether a notification linking to that exact record already exists for
 * that user.
 */
async function notifyOnceForLink(userId: string, link: string, input: Parameters<typeof notify>[1]) {
  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("link", link)
    .eq("type", input.type)
    .maybeSingle();
  if (existing) return;
  await notify(userId, input);
}

async function getUserIdsForRoles(roles: string[]): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("profiles").select("id").in("role", roles);
  return (data ?? []).map((p) => p.id);
}

export async function checkPaymentNoticesDueSoon() {
  const supabase = createServiceRoleClient();
  const { data: notices } = await supabase
    .from("finance_payment_notices")
    .select("id, payee, due_date")
    .neq("status", "paid")
    .lte("due_date", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

  if (!notices || notices.length === 0) return;
  const financeUserIds = await getUserIdsForRoles(["finance_officer", "finance_manager"]);

  for (const notice of notices) {
    const link = "/finance/payment-notices";
    for (const userId of financeUserIds) {
      await notifyOnceForLink(userId, `${link}#${notice.id}`, {
        type: "payment_notice_due_soon",
        title: `Payment to ${notice.payee} is due soon`,
        body: `Due ${notice.due_date}.`,
        link,
      });
    }
  }
}

export async function checkTrainingExpiringSoon() {
  const supabase = createServiceRoleClient();
  const { data: expiring } = await supabase.from("v_training_expiring_soon").select("id, employee_id, course_name, expires_at");
  if (!expiring || expiring.length === 0) return;

  const hrUserIds = await getUserIdsForRoles(["hr_officer", "hr_manager"]);

  for (const record of expiring) {
    const link = "/hr/training";
    for (const userId of hrUserIds) {
      await notifyOnceForLink(userId, `${link}#${record.id}`, {
        type: "training_expiring_soon",
        title: `Training expiring soon: ${record.course_name}`,
        body: `Expires ${record.expires_at}.`,
        link,
      });
    }
  }
}
