"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCandidateAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initialState: ActionResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" className="bg-navy hover:bg-navy/90" disabled={pending}>
      {pending ? "Saving…" : "Add Candidate"}
    </Button>
  );
}

export function CandidateForm({ jobOpeningId }: { jobOpeningId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await createCandidateAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          + Candidate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">Add Candidate</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="job_opening_id" value={jobOpeningId} />
          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
