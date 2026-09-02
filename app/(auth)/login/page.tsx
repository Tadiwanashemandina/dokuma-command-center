"use client";

import { Suspense } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { loginAction, type LoginResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const initialState: LoginResult = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full bg-navy hover:bg-navy/90" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <Card className="rounded-2xl border-0 shadow-xl">
      <CardHeader className="text-center">
        <div className="mb-2 flex justify-center">
          <Image src="/dokuma-logo.jpg" alt="Dokuma" width={601} height={280} className="h-10 w-auto" priority />
        </div>
        <CardTitle className="font-serif text-xl text-navy">Command Centre</CardTitle>
        <CardDescription>Sign in to view the executive dashboard</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="next" value={searchParams.get("next") || "/"} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
