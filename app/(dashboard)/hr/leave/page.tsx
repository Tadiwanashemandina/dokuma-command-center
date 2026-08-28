import Link from "next/link";
import { requireRole, createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/hr/employees";
import { getVisibleLeaveRequests } from "@/lib/hr/leave";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { DecisionButtons } from "./decision-buttons";
import { supervisorDecisionAction, hrDecisionAction } from "./actions";

export default async function LeavePage() {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);
  const employee = await getCurrentEmployee();

  const supabase = await createClient();
  // Inherits leave_requests' RLS: own / direct-reports' / all (HR-tier).
  const requests = await getVisibleLeaveRequests();

  const employeeIds = Array.from(new Set(requests.map((r) => r.employee_id)));
  const { data: employees } =
    employeeIds.length > 0 ? await supabase.from("employees").select("id, full_name").in("id", employeeIds) : { data: [] };
  const nameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]));

  const { data: leaveTypes } = await supabase.from("leave_types").select("id, name");
  const typeById = new Map((leaveTypes ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isHrTier ? "All leave requests." : "Your leave requests and any awaiting your decision."}
          </p>
        </div>
        {employee && (
          <Button asChild className="bg-navy hover:bg-navy/90">
            <Link href="/hr/leave/new">New Leave Request</Link>
          </Button>
        )}
      </div>

      <HrSubNav isHrTier={isHrTier} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => {
                const canSupervisorDecide =
                  r.status === "pending_supervisor" &&
                  ((profile.role === "supervisor" && employee && r.supervisor_id === employee.id) || profile.role === "admin");
                const canHrDecide = r.status === "pending_hr" && isHrTier;

                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-navy">{nameById.get(r.employee_id) ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{typeById.get(r.leave_type_id) ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(r.start_date)} – {formatDate(r.end_date)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.days_requested}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canSupervisorDecide && <DecisionButtons requestId={r.id} action={supervisorDecisionAction} />}
                      {canHrDecide && <DecisionButtons requestId={r.id} action={hrDecisionAction} />}
                    </TableCell>
                  </TableRow>
                );
              })}
              {requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No leave requests.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
