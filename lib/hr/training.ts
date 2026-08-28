import { createClient } from "@/lib/supabase/server";

export async function getExpiringTraining() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("v_training_expiring_soon")
    .select("*")
    .order("expires_at", { ascending: true });

  // v_training_expiring_soon is a view — PostgREST FK-embedding doesn't
  // reliably work on views, so employee names are resolved separately.
  const employeeIds = Array.from(new Set((rows ?? []).map((r) => r.employee_id))).filter(
    (id): id is string => id != null
  );
  const { data: employees } =
    employeeIds.length > 0
      ? await supabase.from("employees").select("id, full_name").in("id", employeeIds)
      : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]));

  return (rows ?? []).map((r) => ({ ...r, employeeName: nameById.get(r.employee_id ?? "") ?? "—" }));
}
