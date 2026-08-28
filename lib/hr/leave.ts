import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { LeaveRequestStatus } from "@/types/database.types";

/**
 * `supabase gen types` marks every column of v_leave_requests as nullable
 * (it can't prove non-nullability through a view definition the way it can
 * for a real table's constraints), even though most of these are never
 * actually null in practice. This is the one place that assumption is
 * made explicit, so every page reading the view gets properly-typed rows
 * instead of scattering `?? ""` fallbacks at each call site.
 */
export type LeaveRequestRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string | null; // genuinely nullable — this is the masked column
  status: LeaveRequestStatus;
  supervisor_id: string | null;
  supervisor_decision_at: string | null;
  supervisor_comment: string | null;
  hr_decision_at: string | null;
  hr_comment: string | null;
  created_at: string;
};

export type LeaveRequestFilter = { status?: LeaveRequestStatus; supervisorId?: string; employeeId?: string };

/** Reads v_leave_requests — RLS on the underlying leave_requests table
 * already scopes rows to self / direct-reports' / HR-tier-sees-all; this
 * just adds optional narrowing filters and returns correctly-typed rows. */
export async function getVisibleLeaveRequests(filter: LeaveRequestFilter = {}): Promise<LeaveRequestRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_leave_requests").select("*").order("created_at", { ascending: false });
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.supervisorId) query = query.eq("supervisor_id", filter.supervisorId);
  if (filter.employeeId) query = query.eq("employee_id", filter.employeeId);

  const { data } = await query;
  return (data ?? []) as unknown as LeaveRequestRow[];
}

export type SubmitLeaveRequestInput = {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  reason: string;
};

/** Called from a Server Action after requireRole() confirms the actor is
 * the employee themselves (or admin/HR submitting on their behalf). The
 * supervisor is captured at submission time from the employee's current
 * org position — later org-chart changes don't retroactively move a
 * request already in flight. */
export async function submitLeaveRequest(input: SubmitLeaveRequestInput, actorId: string) {
  const supabase = createServiceRoleClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("supervisor_id")
    .eq("id", input.employeeId)
    .single();
  if (employeeError) throw new Error(`Employee not found: ${employeeError.message}`);

  const { data: request, error } = await supabase
    .from("leave_requests")
    .insert({
      employee_id: input.employeeId,
      leave_type_id: input.leaveTypeId,
      start_date: input.startDate,
      end_date: input.endDate,
      days_requested: input.daysRequested,
      reason: input.reason,
      status: "pending_supervisor",
      supervisor_id: employee.supervisor_id,
    })
    .select()
    .single();
  if (error) throw new Error(`submitLeaveRequest failed: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: "leave_request_submitted",
    entity_type: "leave_requests",
    entity_id: request.id,
    metadata: { employee_id: input.employeeId, days_requested: input.daysRequested },
  });

  return request;
}

/** The caller (a Server Action) must verify actorEmployeeId is actually the
 * request's supervisor_id before calling this — this function trusts its
 * caller, it does not re-check, since the service-role client bypasses RLS
 * and this is the one place that authorization has to happen explicitly. */
export async function supervisorDecision(
  requestId: string,
  decision: "approve" | "reject",
  comment: string | null,
  actorId: string
) {
  const supabase = createServiceRoleClient();
  const nextStatus = decision === "approve" ? "pending_hr" : "rejected";

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status: nextStatus,
      supervisor_decision_at: new Date().toISOString(),
      supervisor_comment: comment,
    })
    .eq("id", requestId);
  if (error) throw new Error(`supervisorDecision failed: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: `leave_request_supervisor_${decision}d`,
    entity_type: "leave_requests",
    entity_id: requestId,
    metadata: { comment },
  });
}

export async function hrDecision(requestId: string, decision: "approve" | "reject", comment: string | null, actorId: string) {
  const supabase = createServiceRoleClient();
  const nextStatus = decision === "approve" ? "approved" : "rejected";

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status: nextStatus,
      hr_decision_at: new Date().toISOString(),
      hr_comment: comment,
    })
    .eq("id", requestId);
  if (error) throw new Error(`hrDecision failed: ${error.message}`);
  // leave_balances.days_used is incremented automatically by the
  // recompute_leave_balance trigger when status becomes 'approved'.

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: `leave_request_hr_${decision}d`,
    entity_type: "leave_requests",
    entity_id: requestId,
    metadata: { comment },
  });
}
