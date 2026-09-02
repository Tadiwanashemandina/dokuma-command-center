import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database.types";

// Scoped to Finance and HR roles per the Phase 3 brief — admin/exec are
// deliberately not forced into MFA.
export const MFA_REQUIRED_ROLES: UserRole[] = ["finance_officer", "finance_manager", "hr_officer", "hr_manager"];

export async function getAssuranceLevel(supabase: SupabaseClient<Database>): Promise<"aal1" | "aal2"> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2" ? "aal2" : "aal1";
}

// listFactors()'s per-type buckets (e.g. .totp) only ever contain verified
// factors — unverified ones show up only in .all — so this is just a
// presence check, not a status filter.
export async function hasVerifiedTotpFactor(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).length > 0;
}
