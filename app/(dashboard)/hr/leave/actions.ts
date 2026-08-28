"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/hr/employees";
import { submitLeaveRequest, supervisorDecision, hrDecision } from "@/lib/hr/leave";
import { submitLeaveRequestSchema, leaveDecisionSchema } from "@/lib/validation/hr-schema";

export async function submitLeaveRequestAction(formData: FormData) {
  const profile = await requireRole(["admin", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const employee = await getCurrentEmployee();
  if (!employee) throw new Error("No employee record is linked to your account — ask HR to link it.");

  const parsed = submitLeaveRequestSchema.parse({
    leave_type_id: formData.get("leave_type_id"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    days_requested: formData.get("days_requested"),
    reason: formData.get("reason"),
  });

  await submitLeaveRequest(
    {
      employeeId: employee.id,
      leaveTypeId: parsed.leave_type_id,
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      daysRequested: parsed.days_requested,
      reason: parsed.reason,
    },
    profile.id
  );

  revalidatePath("/hr/leave");
  redirect("/hr/leave");
}

export async function supervisorDecisionAction(formData: FormData) {
  const profile = await requireRole(["admin", "supervisor"]);
  const employee = await getCurrentEmployee();

  const parsed = leaveDecisionSchema.parse({
    request_id: formData.get("request_id"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || null,
  });

  if (profile.role !== "admin") {
    const supabase = await createClient();
    const { data: request } = await supabase
      .from("leave_requests")
      .select("supervisor_id")
      .eq("id", parsed.request_id)
      .single();
    if (!employee || request?.supervisor_id !== employee.id) {
      throw new Error("You are not the assigned supervisor for this request.");
    }
  }

  await supervisorDecision(parsed.request_id, parsed.decision, parsed.comment ?? null, profile.id);
  revalidatePath("/hr/leave");
}

export async function hrDecisionAction(formData: FormData) {
  const profile = await requireRole(["admin", "hr_officer", "hr_manager"]);

  const parsed = leaveDecisionSchema.parse({
    request_id: formData.get("request_id"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || null,
  });

  await hrDecision(parsed.request_id, parsed.decision, parsed.comment ?? null, profile.id);
  revalidatePath("/hr/leave");
}
