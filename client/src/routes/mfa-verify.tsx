import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiRequestError } from "@/lib/api-client";
import { challengeMfa, recoverMfa } from "@/lib/api/auth";

/**
 * Ported from `app/(dashboard)/account/mfa/verify/page.tsx` + `verify-form.tsx`.
 *
 * The legacy form had to list factors and create a challenge on mount before
 * it could accept a code. The Express API takes the code directly, so there is
 * nothing to set up — the form is usable immediately.
 *
 * Recovery-code entry is offered here too. The legacy UI had no path to use
 * one, which meant a lost authenticator locked a Finance/HR user out with no
 * self-service option.
 */
export function MfaVerifyPage() {
  useDocumentTitle("Two-factor authentication");

  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [code, setCode] = useState("");
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: (value: string) => (usingRecoveryCode ? recoverMfa(value) : challengeMfa(value)),
    async onSuccess(result) {
      await refresh();
      navigate(result.next || "/", { replace: true });
    },
    onError(caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "Could not verify that code. Try again.",
      );
      setCode("");
    },
  });

  const expectedLength = usingRecoveryCode ? 1 : 6;

  return (
    <div className="mx-auto max-w-md space-y-6 px-6 py-16">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Two-Factor Authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {usingRecoveryCode
            ? "Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once."
            : "Enter the 6-digit code from your authenticator app to continue."}
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="space-y-4 pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              verify.mutate(code);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="code">{usingRecoveryCode ? "Recovery code" : "6-digit code"}</Label>
              <Input
                id="code"
                inputMode={usingRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                maxLength={usingRecoveryCode ? 32 : 6}
                required
                value={code}
                onChange={(e) =>
                  setCode(
                    usingRecoveryCode
                      ? e.target.value.trim()
                      : e.target.value.replace(/\D/g, ""),
                  )
                }
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
              disabled={verify.isPending || code.length < expectedLength}
            >
              {verify.isPending ? "Verifying…" : "Verify"}
            </Button>
          </form>

          <button
            type="button"
            className="w-full text-center text-xs text-steel underline"
            onClick={() => {
              setUsingRecoveryCode((v) => !v);
              setCode("");
              setError(null);
            }}
          >
            {usingRecoveryCode
              ? "Use your authenticator app instead"
              : "Lost your authenticator? Use a recovery code"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
