import { redirect } from "next/navigation";
import { getProfile, createClient } from "@/lib/supabase/server";
import { MFA_REQUIRED_ROLES, getAssuranceLevel, hasVerifiedTotpFactor } from "@/lib/supabase/mfa";
import { EnrollForm } from "./enroll-form";

export default async function MfaEnrollPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!MFA_REQUIRED_ROLES.includes(profile.role)) redirect("/");

  const supabase = await createClient();
  if ((await getAssuranceLevel(supabase)) === "aal2") redirect("/");
  if (await hasVerifiedTotpFactor(supabase)) redirect("/account/mfa/verify");

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Set Up Two-Factor Authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your role requires an authenticator app for sign-in. Scan the code below with an app like Google
          Authenticator or Authy, then enter the 6-digit code it generates.
        </p>
      </div>
      <EnrollForm />
    </div>
  );
}
