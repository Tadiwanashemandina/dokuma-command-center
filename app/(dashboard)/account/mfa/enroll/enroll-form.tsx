"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type EnrollState = { factorId: string; qrCode: string; secret: string } | null;

export function EnrollForm() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<EnrollState>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function startEnrollment() {
      const supabase = createClient();

      // Clear out any stale unverified factor from a previous abandoned
      // attempt — Supabase rejects a second enroll while one is pending.
      // Unverified factors only show up in `.all`, not the per-type buckets.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const factor of existing?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (enrollError || !data) {
        setError(enrollError?.message ?? "Could not start enrollment.");
        setLoading(false);
        return;
      }

      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setLoading(false);
    }

    startEnrollment();
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setVerifying(true);
    setError(null);

    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (challengeError || !challenge) {
      setError(challengeError?.message ?? "Could not start verification challenge.");
      setVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError(verifyError.message);
      setVerifying(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Preparing enrollment…</p>;
  }

  if (!enrollment) {
    return <p className="text-sm text-status-red">{error ?? "Could not start enrollment."}</p>;
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-center">
          {/* Supabase returns this as an SVG data URI. */}
          <img src={enrollment.qrCode} alt="Scan with your authenticator app" className="h-48 w-48" />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Can&apos;t scan? Enter this key manually: <span className="font-mono">{enrollment.secret}</span>
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
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
          {error && <p className="text-sm text-status-red">{error}</p>}
          <Button type="submit" className="w-full bg-navy hover:bg-navy/90" disabled={verifying || code.length !== 6}>
            {verifying ? "Verifying…" : "Verify & Enable"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
