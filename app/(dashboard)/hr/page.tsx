import Link from "next/link";
import { requireRole, createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/hr/employees";
import { getVisibleLeaveRequests } from "@/lib/hr/leave";
import { getExpiringTraining } from "@/lib/hr/training";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default async function HrOverviewPage() {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);

  const supabase = await createClient();
  const employee = await getCurrentEmployee();

  const [{ count: headcount }, pendingRows, expiringTraining, { count: openRoles }] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    profile.role === "supervisor" && employee
      ? getVisibleLeaveRequests({ supervisorId: employee.id, status: "pending_supervisor" })
      : isHrTier
        ? getVisibleLeaveRequests({ status: "pending_hr" })
        : Promise.resolve([]),
    isHrTier ? getExpiringTraining() : Promise.resolve([]),
    isHrTier
      ? supabase.from("job_openings").select("id", { count: "exact", head: true }).eq("status", "open")
      : Promise.resolve({ count: 0 }),
  ]);

  // v_leave_requests doesn't support PostgREST FK-embedding (it's a view),
  // so employee names are resolved with a small separate lookup.
  const pendingEmployeeIds = Array.from(new Set(pendingRows.map((r) => r.employee_id)));
  const { data: pendingEmployees } =
    pendingEmployeeIds.length > 0
      ? await supabase.from("employees").select("id, full_name").in("id", pendingEmployeeIds)
      : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((pendingEmployees ?? []).map((e) => [e.id, e.full_name]));
  const pendingForMe = pendingRows.map((r) => ({ ...r, employeeName: nameById.get(r.employee_id) ?? "—" }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Employees, leave, recruitment, performance and training.
        </p>
      </div>

      <HrSubNav isHrTier={isHrTier} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Active Employees" value={headcount ?? 0} href="/hr/employees" />
        <KpiCard label="Leave Awaiting Your Action" value={pendingForMe.length} href="/hr/leave" />
        {isHrTier && <KpiCard label="Open Roles" value={openRoles ?? 0} href="/hr/recruitment" />}
      </div>

      {pendingForMe.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Awaiting Your Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingForMe.map((r) => (
              <Link
                key={r.id}
                href="/hr/leave"
                className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
              >
                <span className="text-sm text-navy">
                  {r.employeeName} — {r.days_requested} day{Number(r.days_requested) === 1 ? "" : "s"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(r.start_date)} – {formatDate(r.end_date)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {isHrTier && expiringTraining.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Training Expiring Soon</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {expiringTraining.map((t) => (
              <div key={t.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                <span className="text-sm text-navy">
                  {t.employeeName} — {t.course_name}
                </span>
                <span className="text-xs text-status-amber">{formatDate(t.expires_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
