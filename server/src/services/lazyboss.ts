import { ActivityRecord } from "../db/models/index.js";
import { decimalToNumber, formatDateOnly } from "../db/types.js";

/**
 * The LazyBoss adapter seam, ported from `lib/datasources/lazyboss.ts`
 * (inventory §9, D-18).
 *
 * LazyBoss (lazybossapp.xyz) is the team's time/activity tracker. As of
 * 2026-08-18 it exposed no documented REST API, so the CSV path is the only
 * working one: an admin uploads an export, which upserts into
 * `activity_records`. Both adapters read that same collection — the
 * distinction is purely how rows got there, so implementing the API adapter
 * later is a drop-in change with no page-level edits.
 *
 * The seam is preserved rather than collapsed to the one working
 * implementation, because that is the whole point of it.
 */

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
  getTeamSummary(date?: Date): Promise<TeamSummary>;
  listPeopleActivity(date?: Date): Promise<PersonActivity[]>;
}

/** The most recent import date present, or null if nothing is imported. */
async function latestActivityDate(): Promise<Date | null> {
  const latest = await ActivityRecord.findOne({})
    .sort({ activityDate: -1 })
    .select("activityDate")
    .lean();
  return latest?.activityDate ?? null;
}

class CsvLazyBossAdapter implements LazyBossAdapter {
  async listPeopleActivity(date?: Date): Promise<PersonActivity[]> {
    const activityDate = date ?? (await latestActivityDate());
    if (!activityDate) return [];

    const rows = await ActivityRecord.find({ activityDate }).sort({ personName: 1 }).lean();

    return rows.map((row) => ({
      personName: row.personName,
      // Optional schema fields widen to `| undefined` through lean(); the
      // wire contract is `string | null`, so normalize rather than widen it.
      role: row.role ?? null,
      department: row.department ?? null,
      screenshotsCount: row.screenshotsCount ?? 0,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      status: (row.status ?? "offline") as "online" | "offline",
      // hours_today is numeric(5,2). It is a display figure rather than a
      // ledger value, so a number is fine here — but it goes through the
      // named converter so every lossy conversion stays greppable.
      hoursToday: decimalToNumber(row.hoursToday) ?? 0,
      onProjectMinutes: row.onProjectMinutes ?? 0,
      offProjectMinutes: row.offProjectMinutes ?? 0,
    }));
  }

  async getTeamSummary(date?: Date): Promise<TeamSummary> {
    const people = await this.listPeopleActivity(date);
    const activityDate = date ?? (await latestActivityDate());

    return {
      hoursToday: Math.round(people.reduce((sum, p) => sum + p.hoursToday, 0) * 100) / 100,
      onProjectMinutes: people.reduce((sum, p) => sum + p.onProjectMinutes, 0),
      offProjectMinutes: people.reduce((sum, p) => sum + p.offProjectMinutes, 0),
      peopleConnected: people.filter((p) => p.status === "online").length,
      screenshotsTaken: people.reduce((sum, p) => sum + p.screenshotsCount, 0),
      // Not tracked per-person in this shape; `storage_used_mb` exists on
      // activity_records if it is ever needed. Kept at 0 to match the legacy
      // adapter rather than silently changing a displayed figure.
      storageUsedMb: 0,
      asOfDate: formatDateOnly(activityDate),
    };
  }
}

/**
 * Throws by design. No public LazyBoss API existed when this was written, so
 * selecting it is a configuration mistake that should fail loudly rather than
 * return empty data that looks like "nobody worked today".
 */
class ApiLazyBossAdapter implements LazyBossAdapter {
  private static readonly MESSAGE =
    "LazyBoss API adapter not implemented — no public REST API was found at " +
    "lazybossapp.xyz as of 2026-08-18. Implement this once LazyBoss " +
    "credentials/API docs are available.";

  getTeamSummary(): Promise<TeamSummary> {
    throw new Error(ApiLazyBossAdapter.MESSAGE);
  }

  listPeopleActivity(): Promise<PersonActivity[]> {
    throw new Error(ApiLazyBossAdapter.MESSAGE);
  }
}

export function getLazyBossAdapter(): LazyBossAdapter {
  const source = process.env["LAZYBOSS_SOURCE"] ?? "csv";
  return source === "api" ? new ApiLazyBossAdapter() : new CsvLazyBossAdapter();
}
