"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createJobOpeningAction, type ActionResult } from "./actions";
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
    <Button type="submit" className="bg-navy hover:bg-navy/90" disabled={pending}>
      {pending ? "Saving…" : "Create Opening"}
    </Button>
  );
}

export function OpeningForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await createJobOpeningAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy hover:bg-navy/90">New Opening</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">New Job Opening</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="department">Department</Label>
            <Input id="department" name="department" />
          </div>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
