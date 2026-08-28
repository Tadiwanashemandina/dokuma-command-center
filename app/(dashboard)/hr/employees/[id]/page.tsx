import { notFound } from "next/navigation";
import { requireRole, createClient } from "@/lib/supabase/server";
import { getJobDescriptionHistory } from "@/lib/hr/employees";
import { getVisibleLeaveRequests } from "@/lib/hr/leave";
import { getEmployeeAttendance } from "@/lib/hr/attendance";
import { getEmployeeJiraTasks } from "@/lib/hr/jira";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);

  const { id } = await params;
  const supabase = await createClient();

  const { data: employee } = await supabase.from("employees").select("*").eq("id", id).single();
  if (!employee) notFound(); // RLS already hid this row if the caller isn't allowed to see it

  const [jdHistory, leaveRows, { data: balances }, { data: reviews }, { data: training }, attendance, jiraTasks, { data: manualTasks }] =
    await Promise.all([
      getJobDescriptionHistory(employee.id),
      getVisibleLeaveRequests({ employeeId: employee.id }),
      supabase.from("leave_balances").select("*, leave_types(name)").eq("employee_id", employee.id),
      supabase.from("performance_reviews").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("training_records").select("*").eq("employee_id", employee.id).order("completed_at", { ascending: false }),
      getEmployeeAttendance(employee.id, employee.full_name),
      getEmployeeJiraTasks(employee.id, employee.jira_account_id),
      supabase.from("employee_tasks").select("*").eq("employee_id", employee.id).order("due_date", { ascending: true }),
    ]);

  const currentJd = jdHistory[0] ?? null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">{employee.full_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {employee.role_title ?? "—"} · {employee.department ?? "—"}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {employee.status.replace("-", " ")}
        </Badge>
      </div>

      <HrSubNav isHrTier={isHrTier} />

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Job Description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {currentJd ? (
            <>
              <p className="text-xs text-muted-foreground">
                Version {currentJd.version} · effective {formatDate(currentJd.effective_date)}
              </p>
              <p>
                <span className="font-medium text-steel">Reporting line: </span>
                {currentJd.reporting_line ?? "—"}
              </p>
              <p>
                <span className="font-medium text-steel">Responsibilities: </span>
                {currentJd.responsibilities ?? "—"}
              </p>
              <p>
                <span className="font-medium text-steel">Requirements: </span>
                {currentJd.requirements ?? "—"}
              </p>
              {jdHistory.length > 1 && (
                <p className="text-xs text-muted-foreground">{jdHistory.length} versions on file.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">No job description on file.</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Leave</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {balances?.map((b) => (
              <div key={`${b.leave_type_id}-${b.year}`} className="rounded-xl border border-border/60 p-3">
                <p className="text-xs text-steel">
                  {(b.leave_types as unknown as { name: string } | null)?.name ?? "Leave"} ({b.year})
                </p>
                <p className="font-serif text-lg text-navy">{b.days_remaining} days left</p>
                <p className="text-xs text-muted-foreground">
                  {b.days_used} used of {b.days_allocated}
                </p>
              </div>
            ))}
            {(!balances || balances.length === 0) && <p className="text-muted-foreground">No leave balances recorded.</p>}
          </div>
          <div className="space-y-2">
            {leaveRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
                <span className="text-muted-foreground">
                  {formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days_requested}d)
                </span>
                <Badge variant="outline" className="capitalize">
                  {r.status.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
            {leaveRows.length === 0 && <p className="text-muted-foreground">No leave history.</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Performance Reviews</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {reviews?.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
              <div>
                <p className="text-navy">{r.period}</p>
                <p className="text-xs text-muted-foreground">{r.comments ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-navy">{r.rating ?? "—"}</p>
                <Badge variant="outline" className="capitalize">
                  {r.status}
                </Badge>
              </div>
            </div>
          ))}
          {(!reviews || reviews.length === 0) && <p className="text-muted-foreground">No reviews on file.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Training</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {training?.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
              <span className="text-navy">
                {t.course_name} {t.provider ? `(${t.provider})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.expires_at ? `Expires ${formatDate(t.expires_at)}` : `Completed ${formatDate(t.completed_at)}`}
              </span>
            </div>
          ))}
          {(!training || training.length === 0) && <p className="text-muted-foreground">No training records.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">
            Attendance {attendance.source === "lazyboss" && <span className="text-xs font-normal text-teal">via LazyBoss</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {attendance.records.map((r, i) => (
            <div key={i} className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
              <span className="text-muted-foreground">{formatDate(r.date)}</span>
              <span className="capitalize text-navy">
                {r.status}
                {"hoursToday" in r ? ` · ${r.hoursToday}h` : ""}
              </span>
            </div>
          ))}
          {attendance.records.length === 0 && <p className="text-muted-foreground">No attendance data.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">Manually Assigned</p>
            {manualTasks?.map((t) => (
              <div key={t.id} className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
                <span className="text-navy">{t.title}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatDate(t.due_date)}</span>
                  <Badge variant="outline" className="capitalize">
                    {t.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
            {(!manualTasks || manualTasks.length === 0) && <p className="text-muted-foreground">No manually assigned tasks.</p>}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-teal">From Jira</p>
            {jiraTasks.length > 0 ? (
              jiraTasks.map((t) => (
                <a
                  key={t.jira_issue_key}
                  href={t.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between border-b border-border/60 py-1 last:border-0 hover:bg-muted/40"
                >
                  <span className="text-navy">
                    {t.jira_issue_key}: {t.summary}
                  </span>
                  <Badge variant="outline">{t.status}</Badge>
                </a>
              ))
            ) : (
              <p className="text-muted-foreground">
                {employee.jira_account_id ? "No Jira issues currently assigned." : "No Jira account linked."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
