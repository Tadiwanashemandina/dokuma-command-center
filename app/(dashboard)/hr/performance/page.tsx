import { requireRole, createClient } from "@/lib/supabase/server";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReviewForm } from "./review-form";
import { CsvExportButton } from "@/components/csv-export-button";

export default async function PerformancePage() {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const canReview = ["admin", "supervisor", "hr_officer", "hr_manager"].includes(profile.role);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);

  const supabase = await createClient();
  // RLS already scopes rows: own / direct-reports' / all (HR-tier).
  const { data: reviews } = await supabase.from("performance_reviews").select("*").order("created_at", { ascending: false });
  const { data: employees } = canReview ? await supabase.from("employees").select("id, full_name").order("full_name") : { data: [] };

  const employeeIds = Array.from(new Set((reviews ?? []).map((r) => r.employee_id)));
  const { data: reviewEmployees } =
    employeeIds.length > 0 ? await supabase.from("employees").select("id, full_name").in("id", employeeIds) : { data: [] };
  const nameById = new Map((reviewEmployees ?? []).map((e) => [e.id, e.full_name]));

  const csvRows = (reviews ?? []).map((r) => [nameById.get(r.employee_id) ?? "", r.period, r.rating, r.status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
          <p className="mt-1 text-sm text-muted-foreground">Performance review cycles.</p>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename="performance-reviews.csv"
            headers={["Employee", "Period", "Rating", "Status"]}
            rows={csvRows}
          />
          {canReview && <ReviewForm employees={employees ?? []} />}
        </div>
      </div>

      <HrSubNav isHrTier={isHrTier} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-navy">{nameById.get(r.employee_id) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.period}</TableCell>
                  <TableCell className="text-muted-foreground">{r.rating ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!reviews || reviews.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No reviews yet.
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
