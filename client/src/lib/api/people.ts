import { api } from "@/lib/api-client";

/** Typed client functions for /api/people (admin/exec only). */

export interface TeamSummary {
  hours_today: number;
  on_project_minutes: number;
  off_project_minutes: number;
  people_connected: number;
  screenshots_taken: number;
  storage_used_mb: number;
  as_of_date: string | null;
  /** null when no minutes are tracked — not 0, which would mislead. */
  utilisation_pct: number | null;
}

export interface PersonActivityRow {
  person_name: string;
  role: string | null;
  department: string | null;
  screenshots_count: number;
  last_seen_at: string | null;
  status: "online" | "offline";
  hours_today: number;
  on_project_minutes: number;
  off_project_minutes: number;
}

export interface PeopleActivityResponse {
  summary: TeamSummary;
  people: PersonActivityRow[];
  /** Which LazyBoss adapter served this — "csv" or "api". */
  source: string;
}

export function getPeopleActivity(): Promise<PeopleActivityResponse> {
  return api.get<PeopleActivityResponse>("/people/activity");
}
