import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiRequestError } from "@/lib/api-client";
import { enrollMfa, verifyMfaEnrollment } from "@/lib/api/auth";

/**
 * Ported from `app/(dashboard)/account/mfa/enroll/page.tsx` + `enroll-form.tsx`.
 *
 * Considerably simpler than the original, because the server models the factor
 * explicitly. The legacy form had to list Supabase's factors, unenroll any
 * stale unverified one (Supabase rejects a second enroll while one is
 * pending, and unverified factors appear only in `.all`), then create a
 * separate challenge before verifying. The Express API has `pendingSecret` vs
 * `secret`, so enrolling twice is simply allowed and there is no challenge id
 * to carry — the quirk documented in SECURITY.md disappears with Supabase.
 *
 * The redirects the page did itself (`/` if already aal2, `/verify` if a
 * factor exists) are handled by `<RequireAuth>`, which reads `mfaNext` from
 * the server.
 */
export function MfaEnrollPage() {
  useDocumentTitle("Set up two-factor authentication");

  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Starting enrollment is a server-side write (it stores `pendingSecret`),
  // but it is what this page needs on arrival, so it runs as a query.
  const enrollment = useQuery({
    queryKey: ["mfa", "enroll"],
    queryFn: enrollMfa,
    retry: false,
    // Re-running this would mint a new secret and invalidate the QR code the
    // user is part-way through scanning.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const verify = useMutation({
    mutationFn: verifyMfaEnrollment,
    async onSuccess(result) {
      // The recovery codes are shown exactly once — the server stores only
      // hashes — so the user acknowledges them before being sent on.
      if (result.recoveryCodes && result.recoveryCodes.length > 0) {
        setRecoveryCodes(result.recoveryCodes);
        await refresh();
        return;
      }
      await refresh();
      navigate(result.next || "/", { replace: true });
    },
    onError(caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : "Could not verify that code. Try again.",
      );
      setCode("");
    },
  });

  /** Step two: the codes are on screen and must be acknowledged. */
  if (recoveryCodes) {
    return (
      <div className="mx-auto max-w-md space-y-6 px-6 py-16">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Save your recovery codes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each code can be used once to sign in if you lose your authenticator. They are shown now and
            never again — store them somewhere safe before continuing.
          </p>
        </div>

        <Card className="rounded-2xl">
          <CardContent className="pt-6">
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-navy">
              {recoveryCodes.map((rc) => (
                <li key={rc} className="rounded-lg bg-muted px-3 py-2 text-center">
                  {rc}
                </li>
              ))}
            </ul>

            <div className="mt-5 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
              >
                Copy codes
              </Button>
              <Button
                className="flex-1 rounded-xl bg-navy hover:bg-navy/90"
                onClick={() => navigate("/", { replace: true })}
              >
                I&apos;ve saved them
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-6 py-16">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Set Up Two-Factor Authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your role requires an authenticator app for sign-in. Scan the code below with an app like Google
          Authenticator or Authy, then enter the 6-digit code it generates.
        </p>
      </div>

      {enrollment.isPending && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 pt-6" aria-busy="true">
            <Skeleton className="mx-auto h-48 w-48" />
            <Skeleton className="mx-auto h-3 w-64" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {enrollment.error && (
        <p role="alert" className="text-sm text-status-red">
          {enrollment.error instanceof Error
            ? enrollment.error.message
            : "Could not start enrollment."}
        </p>
      )}

      {enrollment.data && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-center">
              {/* Rendered server-side as a data: URL, so the client ships no
                  QR library. */}
              <img
                src={enrollment.data.qrCodeDataUrl}
                alt="Scan this QR code with your authenticator app"
                className="h-48 w-48"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key manually:{" "}
              <span className="font-mono">{enrollment.data.secret}</span>
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                verify.mutate(code);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-status-red">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-navy hover:bg-navy/90"
                disabled={verify.isPending || code.length !== 6}
              >
                {verify.isPending ? "Verifying…" : "Verify & Enable"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
