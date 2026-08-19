import { z } from "zod";

// Expected LazyBoss CSV export columns, matching the per-person shape
// described in the brief: name, role, department, screenshot count,
// last-seen, online/offline, plus the hours/on-project/off-project split.
export const lazyBossCsvRowSchema = z.object({
  person_name: z.string().min(1),
  role: z.string().optional().default(""),
  department: z.string().optional().default(""),
  hours_today: z.coerce.number().nonnegative().optional().default(0),
  on_project_minutes: z.coerce.number().int().nonnegative().optional().default(0),
  off_project_minutes: z.coerce.number().int().nonnegative().optional().default(0),
  screenshots_count: z.coerce.number().int().nonnegative().optional().default(0),
  storage_used_mb: z.coerce.number().nonnegative().optional().default(0),
  last_seen_at: z.string().optional().default(""),
  status: z.enum(["online", "offline"]).optional().default("offline"),
});

export type LazyBossCsvRow = z.infer<typeof lazyBossCsvRowSchema>;
