"use server";

import Papa from "papaparse";
import { requireRole, createServiceRoleClient } from "@/lib/supabase/server";
import { lazyBossCsvRowSchema } from "@/lib/validation/lazyboss-csv-schema";
import type { Database } from "@/types/database.types";

type ActivityRecordInsert = Database["public"]["Tables"]["activity_records"]["Insert"];

export type ImportResult = {
  inserted: number;
  skipped: number;
  errors: string[];
};

export async function importLazyBossCsv(_prevState: ImportResult | null, formData: FormData): Promise<ImportResult> {
  const profile = await requireRole(["admin"]);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { inserted: 0, skipped: 0, errors: ["No file was uploaded."] };
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const errors: string[] = parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`);
  const activityDate = new Date().toISOString().slice(0, 10);
  const rows: ActivityRecordInsert[] = [];

  parsed.data.forEach((raw, index) => {
    const result = lazyBossCsvRowSchema.safeParse(raw);
    if (!result.success) {
      errors.push(`Row ${index + 2}: ${result.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    const row = result.data;
    rows.push({
      person_name: row.person_name,
      role: row.role || null,
      department: row.department || null,
      activity_date: activityDate,
      hours_today: row.hours_today,
      on_project_minutes: row.on_project_minutes,
      off_project_minutes: row.off_project_minutes,
      screenshots_count: row.screenshots_count,
      storage_used_mb: row.storage_used_mb,
      last_seen_at: row.last_seen_at || null,
      status: row.status,
      source: "csv",
    });
  });

  if (rows.length === 0) {
    return { inserted: 0, skipped: parsed.data.length, errors };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("activity_records")
    .upsert(rows, { onConflict: "person_name,activity_date,source" });

  if (error) {
    return { inserted: 0, skipped: parsed.data.length, errors: [...errors, error.message] };
  }

  await supabase.rpc("refresh_kpi_feed");

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "lazyboss_import",
    entity_type: "activity_records",
    entity_id: null,
    metadata: { filename: file.name, row_count: rows.length, skipped: parsed.data.length - rows.length },
  });

  return { inserted: rows.length, skipped: parsed.data.length - rows.length, errors };
}
