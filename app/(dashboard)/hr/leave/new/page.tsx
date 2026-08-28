import { redirect } from "next/navigation";
import { requireRole, createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/hr/employees";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitLeaveRequestAction } from "../actions";

export default async function NewLeaveRequestPage() {
  const profile = await requireRole(["admin", "employee", "supervisor", "hr_officer", "hr_manager"]);
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/hr/leave");

  const supabase = await createClient();
  const { data: leaveTypes } = await supabase.from("leave_types").select("id, name").order("name");

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">New Leave Request</h1>
        <p className="mt-1 text-sm text-muted-foreground">Submitting as {employee.full_name}.</p>
      </div>

      <HrSubNav isHrTier={["admin", "exec", "hr_officer", "hr_manager"].includes(profile.role)} />

      <Card className="rounded-2xl">
        <CardContent className="p-6">
          <form action={submitLeaveRequestAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="leave_type_id">Leave Type</Label>
              <Select name="leave_type_id" required>
                <SelectTrigger id="leave_type_id">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date</Label>
                <Input id="start_date" name="start_date" type="date" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date">End Date</Label>
                <Input id="end_date" name="end_date" type="date" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="days_requested">Days Requested</Label>
              <Input id="days_requested" name="days_requested" type="number" step="0.5" min="0.5" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" name="reason" required rows={4} />
              <p className="text-xs text-muted-foreground">
                Your supervisor will see the dates and day count only — the reason is visible to HR and you.
              </p>
            </div>
            <Button type="submit" className="bg-navy hover:bg-navy/90">
              Submit Request
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
