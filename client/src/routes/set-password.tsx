import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiRequestError } from "@/lib/api-client";
import { inspectSetPasswordToken, setPassword } from "@/lib/api/auth";
import logoCrop from "@/assets/dokuma-logo-crop.png";

/**
 * Redeems an invite or reset link.
 *
 * Public — the whole point is that the holder has no session yet, so this
 * route sits outside `<RequireAuth>`. The token is validated before the form
 * renders, so an expired link says so immediately rather than after someone
 * has chosen and typed a password twice.
 */
export function SetPasswordPage() {
  useDocumentTitle("Set your password");

  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const target = useQuery({
    queryKey: ["set-password", token],
    queryFn: () => inspectSetPasswordToken(token),
    enabled: token.length > 0,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => setPassword({ token, password }),
    onSuccess: () => setDone(true),
    onError: (caught) =>
      setError(
        caught instanceof ApiRequestError ? caught.message : "Could not set your password. Try again.",
      ),
  });

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 12;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <img
        src={logoCrop}
        alt="Dokuma — Digital Consultancy"
        width={954}
        height={253}
        className="mb-8 h-8 w-auto self-start object-contain"
        decoding="async"
      />

      {/* --- No token in the URL at all --- */}
      {token.length === 0 && (
        <>
          <h1 className="font-serif text-2xl font-semibold text-navy">Link incomplete</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is missing its token. Ask an administrator to send you a new one.
          </p>
        </>
      )}

      {/* --- Validating --- */}
      {token.length > 0 && target.isPending && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 pt-6" aria-busy="true">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {/* --- Token rejected --- */}
      {target.error && (
        <>
          <h1 className="font-serif text-2xl font-semibold text-navy">Link expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {target.error instanceof Error
              ? target.error.message
              : "This link is invalid or has expired."}
          </p>
          <Button asChild variant="outline" className="mt-6 w-fit rounded-xl">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </>
      )}

      {/* --- Done --- */}
      {done && (
        <>
          <CheckCircle2 className="h-8 w-8 text-status-green" aria-hidden="true" />
          <h1 className="mt-3 font-serif text-2xl font-semibold text-navy">Password set</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You can now sign in as <span className="font-medium text-navy">{target.data?.email}</span>.
          </p>
          <Button asChild className="mt-6 w-fit rounded-xl bg-navy hover:bg-navy/90">
            <Link to="/login">Sign in</Link>
          </Button>
        </>
      )}

      {/* --- The form --- */}
      {target.data && !done && (
        <>
          <h1 className="font-serif text-2xl font-semibold text-navy">
            {target.data.purpose === "invite" ? "Welcome to Dokuma" : "Choose a new password"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {target.data.purpose === "invite"
              ? "Choose a password for your account "
              : "Setting a new password will sign you out everywhere else. Account: "}
            <span className="font-medium text-navy">{target.data.email}</span>.
          </p>

          <Card className="mt-6 rounded-2xl">
            <CardContent className="pt-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  submit.mutate();
                }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    required
                    className="h-11 rounded-xl"
                    value={password}
                    onChange={(e) => setPasswordValue(e.target.value)}
                    aria-describedby="password-hint"
                  />
                  <p id="password-hint" className="text-xs text-muted-foreground">
                    At least 12 characters. A memorable phrase beats a short complicated one.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="h-11 rounded-xl"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  {mismatch && <p className="text-xs text-status-red">Passwords do not match.</p>}
                </div>

                {error && (
                  <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-navy hover:bg-navy/90"
                  disabled={submit.isPending || tooShort || mismatch || password.length === 0 || confirm.length === 0}
                >
                  {submit.isPending ? "Setting password…" : "Set password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
