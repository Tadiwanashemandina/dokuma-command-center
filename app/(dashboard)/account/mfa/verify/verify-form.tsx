"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function VerifyForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function startChallenge() {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp[0];
      if (listError || !verified) {
        setError(listError?.message ?? "No verified authenticator found.");
        setLoading(false);
        return;
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: verified.id });
      if (challengeError || !challenge) {
        setError(challengeError?.message ?? "Could not start verification challenge.");
        setLoading(false);
        return;
      }

      setFactorId(verified.id);
      setChallengeId(challenge.id);
      setLoading(false);
    }

    startChallenge();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setVerifying(true);
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    if (verifyError) {
      setError(verifyError.message);
      setVerifying(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Preparing verification…</p>;
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
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
              disabled={!challengeId}
            />
          </div>
          {error && <p className="text-sm text-status-red">{error}</p>}
          <Button
            type="submit"
            className="w-full bg-navy hover:bg-navy/90"
            disabled={verifying || !challengeId || code.length !== 6}
          >
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
