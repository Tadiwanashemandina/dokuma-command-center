import { createClient } from "@/lib/supabase/server";

export async function getCurrentEmployee() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("employees").select("*").eq("user_id", user.id).maybeSingle();
  return data;
}

export async function getDirectReports(supervisorId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, full_name, role_title, department, status")
    .eq("supervisor_id", supervisorId)
    .order("full_name");
  return data ?? [];
}

export async function getCurrentJobDescription(employeeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_descriptions")
    .select("*")
    .eq("employee_id", employeeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getJobDescriptionHistory(employeeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_descriptions")
    .select("*")
    .eq("employee_id", employeeId)
    .order("version", { ascending: false });
  return data ?? [];
}
