import { redirect } from "next/navigation";
import { getProfile, createClient } from "@/lib/supabase/server";
import { MFA_REQUIRED_ROLES, getAssuranceLevel, hasVerifiedTotpFactor } from "@/lib/supabase/mfa";
import { VerifyForm } from "./verify-form";

export default async function MfaVerifyPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!MFA_REQUIRED_ROLES.includes(profile.role)) redirect("/");

  const supabase = await createClient();
  if ((await getAssuranceLevel(supabase)) === "aal2") redirect("/");
  if (!(await hasVerifiedTotpFactor(supabase))) redirect("/account/mfa/enroll");

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Verify Your Identity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app to continue.
        </p>
      </div>
      <VerifyForm />
    </div>
  );
}
