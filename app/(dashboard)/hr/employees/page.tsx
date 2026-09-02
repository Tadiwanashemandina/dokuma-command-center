import Link from "next/link";
import { requireRole, createClient } from "@/lib/supabase/server";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { CsvExportButton } from "@/components/csv-export-button";

export default async function EmployeeDirectoryPage() {
  const profile = await requireRole(["admin", "exec", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const isHrTier = ["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role);

  const supabase = await createClient();
  // RLS already scopes this to: self / direct reports / everyone (HR-tier) —
  // no additional app-level filtering needed.
  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, role_title, department, status, employment_date")
    .order("full_name");

  const csvRows = (employees ?? []).map((e) => [
    e.full_name,
    e.role_title,
    e.department,
    e.status.replace("-", " "),
    formatDate(e.employment_date),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isHrTier ? "Every employee at Dokuma." : "Your profile and direct reports."}
          </p>
        </div>
        <CsvExportButton
          filename="employees.csv"
          headers={["Name", "Role", "Department", "Status", "Employed Since"]}
          rows={csvRows}
        />
      </div>

      <HrSubNav isHrTier={isHrTier} />

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Employed Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees?.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium text-navy">
                    <Link href={`/hr/employees/${e.id}`} className="hover:underline">
                      {e.full_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.role_title ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.department ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {e.status.replace("-", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(e.employment_date)}</TableCell>
                </TableRow>
              ))}
              {(!employees || employees.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No employees visible.
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
