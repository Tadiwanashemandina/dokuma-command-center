import { Router } from "express";
import { EXEC_ONLY } from "@dokuma/shared";
import { requireRole } from "../middleware/auth.js";
import { getLazyBossAdapter } from "../services/lazyboss.js";
import { handle, ok } from "./helpers.js";

/**
 * People & delivery — LazyBoss team activity (inventory §2.3, route 8).
 *
 * admin/exec only. Unlike the four D-2 routes, this page DID call
 * `requireRole(["admin","exec"])`, and `activity_records` carried a matching
 * RLS policy — so the gate here is a role check, not just authentication.
 *
 * Utilisation is computed server-side from the same minutes the KPI view
 * uses, so the figure on this page and the one on the CEO dashboard cannot
 * drift apart.
 */

export const peopleRouter = Router();

peopleRouter.get(
  "/activity",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    const adapter = getLazyBossAdapter();
    const [summary, people] = await Promise.all([
      adapter.getTeamSummary(),
      adapter.listPeopleActivity(),
    ]);

    const totalMinutes = summary.onProjectMinutes + summary.offProjectMinutes;
    // Matches `nullif(..., 0)` in the SQL view: no tracked minutes yields no
    // figure rather than a misleading 0%.
    const utilisationPct =
      totalMinutes > 0 ? Math.round((summary.onProjectMinutes / totalMinutes) * 1000) / 10 : null;

    ok(res, {
      summary: {
        hours_today: summary.hoursToday,
        on_project_minutes: summary.onProjectMinutes,
        off_project_minutes: summary.offProjectMinutes,
        people_connected: summary.peopleConnected,
        screenshots_taken: summary.screenshotsTaken,
        storage_used_mb: summary.storageUsedMb,
        as_of_date: summary.asOfDate,
        utilisation_pct: utilisationPct,
      },
      people: people.map((person) => ({
        person_name: person.personName,
        role: person.role,
        department: person.department,
        screenshots_count: person.screenshotsCount,
        last_seen_at: person.lastSeenAt,
        status: person.status,
        hours_today: person.hoursToday,
        on_project_minutes: person.onProjectMinutes,
        off_project_minutes: person.offProjectMinutes,
      })),
      /**
       * Which adapter served this. The page shows it, and it is the fastest
       * way to tell "nobody has imported today" from "the API adapter is
       * selected but unimplemented".
       */
      source: process.env["LAZYBOSS_SOURCE"] ?? "csv",
    });
  }),
);
