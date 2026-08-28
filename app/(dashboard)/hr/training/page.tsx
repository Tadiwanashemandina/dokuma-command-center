import { requireRole, createClient } from "@/lib/supabase/server";
import { getExpiringTraining } from "@/lib/hr/training";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { TrainingForm } from "./training-form";

export default async function TrainingPage() {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);
  const canManage = ["admin", "hr_officer", "hr_manager"].includes(profile.role);

  const supabase = await createClient();
  // RLS scopes rows: own / direct-reports' / all (HR-tier).
  const { data: records } = await supabase.from("training_records").select("*").order("completed_at", { ascending: false });
  const { data: employees } = canManage ? await supabase.from("employees").select("id, full_name").order("full_name") : { data: [] };
  const expiring = isHrTier ? await getExpiringTraining() : [];

  const employeeIds = Array.from(new Set((records ?? []).map((r) => r.employee_id)));
  const { data: recordEmployees } =
    employeeIds.length > 0 ? await supabase.from("employees").select("id, full_name").in("id", employeeIds) : { data: [] };
  const nameById = new Map((recordEmployees ?? []).map((e) => [e.id, e.full_name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
          <p className="mt-1 text-sm text-muted-foreground">Training and certification records.</p>
        </div>
        {canManage && <TrainingForm employees={employees ?? []} />}
      </div>

      <HrSubNav isHrTier={isHrTier} />

      {isHrTier && expiring.length > 0 && (
        <Card className="rounded-2xl border-status-amber/40">
          <CardHeader>
            <CardTitle className="font-serif text-lg text-navy">Expiring Within 30 Days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {expiring.map((t) => (
              <div key={t.id} className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
                <span className="text-sm text-navy">
                  {t.employeeName} — {t.course_name}
                </span>
                <span className="text-xs text-status-amber">{formatDate(t.expires_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-navy">{nameById.get(r.employee_id) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.course_name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.provider ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.completed_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.expires_at)}</TableCell>
                </TableRow>
              ))}
              {(!records || records.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No training records.
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
