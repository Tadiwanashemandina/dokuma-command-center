import { createClient } from "@/lib/supabase/server";

export type AttendanceView =
  | { source: "lazyboss"; records: { date: string; status: string; hoursToday: number }[] }
  | { source: "manual"; records: { date: string; status: string }[] };

/**
 * Dev staff already have real activity data via LazyBoss (activity_records,
 * matched by full_name — the same table People & Delivery reads). Rather
 * than asking them to also check in manually, the Employee 360 page prefers
 * that data whenever it exists and only falls back to the manual
 * attendance_records table for everyone else. No employee ends up tracked
 * in both places.
 */
export async function getEmployeeAttendance(employeeId: string, fullName: string): Promise<AttendanceView> {
  const supabase = await createClient();

  const { data: activity } = await supabase
    .from("activity_records")
    .select("activity_date, status, hours_today")
    .eq("person_name", fullName)
    .order("activity_date", { ascending: false })
    .limit(14);

  if (activity && activity.length > 0) {
    return {
      source: "lazyboss",
      records: activity.map((a) => ({
        date: a.activity_date,
        status: a.status ?? "unknown",
        hoursToday: Number(a.hours_today ?? 0),
      })),
    };
  }

  const { data: manual } = await supabase
    .from("attendance_records")
    .select("date, status")
    .eq("employee_id", employeeId)
    .order("date", { ascending: false })
    .limit(14);

  return { source: "manual", records: manual ?? [] };
}
