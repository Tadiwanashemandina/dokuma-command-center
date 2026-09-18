"use client";

import { Suspense } from "react";
import { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <div className="relative grid min-h-screen bg-white lg:grid-cols-2">
      <BrandPanel />
      <div className="relative flex items-center justify-center overflow-hidden px-6 py-16 sm:px-10">
        {/* Fence mesh texture on the white side */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #0D1B3E 0, #0D1B3E 1px, transparent 1px, transparent 22px), repeating-linear-gradient(-45deg, #0D1B3E 0, #0D1B3E 1px, transparent 1px, transparent 22px)",
          }}
        />
        <div className="relative w-full max-w-sm">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-navy px-12 py-14 lg:flex lg:rounded-r-[64px] lg:shadow-[24px_0_48px_-24px_rgba(13,27,62,0.35)]">
      {/* Diamond mesh texture — same treatment as the sidebar */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, white 0, white 1px, transparent 1px, transparent 22px), repeating-linear-gradient(-45deg, white 0, white 1px, transparent 1px, transparent 22px)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, white 0, transparent 45%), radial-gradient(circle at 90% 80%, white 0, transparent 40%)",
        }}
      />

      <div className="relative">
        <Image
          src="/dokuma-logo-crop.png"
          alt="Dokuma — Digital Consultancy"
          width={954}
          height={253}
          className="h-9 w-auto object-contain brightness-0 invert"
          priority
        />
      </div>

      <div className="relative max-w-md">
        <p className="font-serif text-3xl font-semibold leading-tight text-white">
          The executive command centre for Dokuma&apos;s delivery, finance and people.
        </p>
        <p className="mt-4 text-sm leading-6 text-white/50">
          One live view of every project, risk and number that matters — built for the leadership team.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white">
          Shaping Africa&apos;s digital future
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-navy">
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      <p className="relative text-xs text-white/30">© {new Date().getFullYear()} Dokuma (Private) Limited</p>
    </div>
  );
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" className="h-11 w-full rounded-xl bg-navy text-sm font-medium hover:bg-navy/90" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
        next: formData.get("next"),
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error ?? "Unable to sign in");
      setPending(false);
      return;
    }

    router.push(result.next || "/");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-8 lg:hidden">
        <Image
          src="/dokuma-logo-crop.png"
          alt="Dokuma — Digital Consultancy"
          width={954}
          height={253}
          className="h-8 w-auto object-contain"
          priority
        />
      </div>

      <h1 className="font-serif text-2xl font-semibold text-navy">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in to view the executive dashboard.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <input type="hidden" name="next" value={searchParams.get("next") || "/"} />
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium text-navy">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-11 rounded-xl px-3.5 text-sm"
            placeholder="you@dokuma.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium text-navy">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-11 rounded-xl px-3.5 text-sm"
            placeholder="••••••••"
          />
        </div>
        {error && (
          <p className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">{error}</p>
        )}
        <SubmitButton pending={pending} />
      </form>
    </div>
  );
}
