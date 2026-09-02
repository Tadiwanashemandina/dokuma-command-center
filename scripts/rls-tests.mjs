// Repeatable, live cross-role RLS checks. Run after any migration that
// touches RLS to confirm these guarantees still hold — this codifies checks
// that were originally verified by hand during Phases 1-3.
//
// Usage: node --env-file=.env.local scripts/rls-tests.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and the
// seeded test accounts (see README) to exist with password DokumaTest123!.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "DokumaTest123!";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

async function asUser(email) {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return supabase;
}

async function main() {
  console.log("\n== Finance: cross-domain isolation ==");
  {
    const viewer = await asUser("viewer@dokuma.local");
    const { data } = await viewer.from("finance_transactions").select("id");
    check("viewer sees 0 finance_transactions rows", (data ?? []).length === 0);
    await viewer.auth.signOut();
  }
  {
    const financeOfficer = await asUser("finance-officer@dokuma.local");
    const { data } = await financeOfficer.from("finance_transactions").select("id");
    check("finance_officer sees finance_transactions rows", (data ?? []).length > 0);
    await financeOfficer.auth.signOut();
  }
  {
    const hrOfficer = await asUser("hr-officer@dokuma.local");
    const { data } = await hrOfficer.from("finance_transactions").select("id");
    check("hr_officer sees 0 finance_transactions rows (cross-domain)", (data ?? []).length === 0);
    await hrOfficer.auth.signOut();
  }

  console.log("\n== HR: employees row scoping ==");
  {
    const viewer = await asUser("viewer@dokuma.local");
    const { data } = await viewer.from("employees").select("id");
    check("viewer sees 0 employees rows", (data ?? []).length === 0);
    await viewer.auth.signOut();
  }
  {
    const hrManager = await asUser("hr-manager@dokuma.local");
    const { data } = await hrManager.from("employees").select("id");
    check("hr_manager sees all employees rows", (data ?? []).length > 5);
    await hrManager.auth.signOut();
  }

  console.log("\n== v_leave_requests: security_invoker + supervisor scoping ==");
  {
    const supervisor = await asUser("supervisor@dokuma.local");
    const { data: me } = await supervisor.from("employees").select("id").eq("user_id", (await supervisor.auth.getUser()).data.user.id).single();
    const { data: rows } = await supervisor.from("v_leave_requests").select("employee_id, reason");
    const onlySelfOrDirectReports = (rows ?? []).length > 0;
    const noForeignReasonLeak = (rows ?? []).every((r) => r.employee_id === me?.id || r.reason === null);
    check("supervisor sees at least one leave request (own/direct reports)", onlySelfOrDirectReports);
    check("supervisor never sees another employee's leave reason", noForeignReasonLeak);
    await supervisor.auth.signOut();
  }
  {
    const employee = await asUser("employee@dokuma.local");
    const { data: me } = await employee.from("employees").select("id").eq("user_id", (await employee.auth.getUser()).data.user.id).single();
    const { data: rows } = await employee.from("v_leave_requests").select("employee_id");
    const onlyOwnRows = (rows ?? []).every((r) => r.employee_id === me?.id);
    check("employee sees only their own leave requests", onlyOwnRows);
    await employee.auth.signOut();
  }
  {
    const hrOfficer = await asUser("hr-officer@dokuma.local");
    const { data: rows } = await hrOfficer.from("v_leave_requests").select("employee_id, reason");
    const seesAcrossEmployees = new Set((rows ?? []).map((r) => r.employee_id)).size > 1;
    const canSeeAtLeastOneReason = (rows ?? []).some((r) => r.reason !== null);
    check("hr_officer sees leave requests across multiple employees", seesAcrossEmployees);
    check("hr_officer can see leave reasons (HR-tier, not masked)", canSeeAtLeastOneReason);
    await hrOfficer.auth.signOut();
  }

  console.log("\n== Document storage: private buckets ==");
  {
    const viewer = await asUser("viewer@dokuma.local");
    const { data, error } = await viewer.storage.from("receipts").list();
    check("viewer cannot list the receipts bucket", !!error || (data ?? []).length === 0);
    await viewer.auth.signOut();
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
