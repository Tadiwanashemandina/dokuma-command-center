import { requireRole } from "@/lib/supabase/server";
import { ImportForm } from "./import-form";

export default async function LazyBossCsvImportPage() {
  await requireRole(["admin"]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Import LazyBoss CSV</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a LazyBoss activity export. Expected columns: person_name, role, department, hours_today,
          on_project_minutes, off_project_minutes, screenshots_count, storage_used_mb, last_seen_at, status.
          Re-uploading for the same day updates existing rows rather than duplicating them.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
