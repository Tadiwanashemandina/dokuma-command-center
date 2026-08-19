import { createClient } from "@/lib/supabase/server";

// LazyBoss (lazybossapp.xyz) is the team's existing time/activity tracker.
// As of 2026-08-18 its public site exposed no documented REST API, /api,
// /docs, or CSV export endpoint — likely gated behind a login we don't have.
// So this adapter defaults to the CSV path: an admin exports/downloads their
// LazyBoss data and uploads it via /admin/import/lazyboss-csv, which upserts
// into the shared `activity_records` table. Both adapters below read from
// that same table — the distinction is only about how rows got there, so
// swapping in a real API later is implementing ApiLazyBossAdapter and
// flipping LAZYBOSS_SOURCE, with zero page-level changes.

export interface PersonActivity {
  personName: string;
  role: string | null;
  department: string | null;
  screenshotsCount: number;
  lastSeenAt: string | null;
  status: "online" | "offline";
  hoursToday: number;
  onProjectMinutes: number;
  offProjectMinutes: number;
}

export interface TeamSummary {
  hoursToday: number;
  onProjectMinutes: number;
  offProjectMinutes: number;
  peopleConnected: number;
  screenshotsTaken: number;
  storageUsedMb: number;
  asOfDate: string | null;
}

export interface LazyBossAdapter {
  getTeamSummary(date?: string): Promise<TeamSummary>;
  listPeopleActivity(date?: string): Promise<PersonActivity[]>;
}

async function latestActivityDate(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_records")
    .select("activity_date")
    .order("activity_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.activity_date ?? null;
}

class CsvLazyBossAdapter implements LazyBossAdapter {
  async listPeopleActivity(date?: string): Promise<PersonActivity[]> {
    const activityDate = date ?? (await latestActivityDate());
    if (!activityDate) return [];

    const supabase = await createClient();
    const { data } = await supabase
      .from("activity_records")
      .select("*")
      .eq("activity_date", activityDate)
      .order("person_name");

    return (data ?? []).map((row) => ({
      personName: row.person_name,
      role: row.role,
      department: row.department,
      screenshotsCount: row.screenshots_count ?? 0,
      lastSeenAt: row.last_seen_at,
      status: (row.status ?? "offline") as "online" | "offline",
      hoursToday: Number(row.hours_today ?? 0),
      onProjectMinutes: row.on_project_minutes ?? 0,
      offProjectMinutes: row.off_project_minutes ?? 0,
    }));
  }

  async getTeamSummary(date?: string): Promise<TeamSummary> {
    const people = await this.listPeopleActivity(date);
    const activityDate = date ?? (await latestActivityDate());

    return {
      hoursToday: Math.round(people.reduce((sum, p) => sum + p.hoursToday, 0) * 100) / 100,
      onProjectMinutes: people.reduce((sum, p) => sum + p.onProjectMinutes, 0),
      offProjectMinutes: people.reduce((sum, p) => sum + p.offProjectMinutes, 0),
      peopleConnected: people.filter((p) => p.status === "online").length,
      screenshotsTaken: people.reduce((sum, p) => sum + p.screenshotsCount, 0),
      storageUsedMb: 0, // not tracked per-person in this shape; see storage_used_mb on activity_records if needed later
      asOfDate: activityDate,
    };
  }
}

class ApiLazyBossAdapter implements LazyBossAdapter {
  async getTeamSummary(): Promise<TeamSummary> {
    throw new Error(
      "LazyBoss API adapter not implemented — no public REST API was found at lazybossapp.xyz as of 2026-08-18. Implement this once LazyBoss credentials/API docs are available."
    );
  }
  async listPeopleActivity(): Promise<PersonActivity[]> {
    throw new Error(
      "LazyBoss API adapter not implemented — no public REST API was found at lazybossapp.xyz as of 2026-08-18. Implement this once LazyBoss credentials/API docs are available."
    );
  }
}

export function getLazyBossAdapter(): LazyBossAdapter {
  const source = process.env.LAZYBOSS_SOURCE ?? "csv";
  return source === "api" ? new ApiLazyBossAdapter() : new CsvLazyBossAdapter();
}
