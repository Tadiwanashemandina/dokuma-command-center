"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { reverseTransactionAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Reversing…" : "Confirm Reversal"}
    </Button>
  );
}

export function ReverseButton({ transactionId }: { transactionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await reverseTransactionAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-status-red hover:text-status-red">
          Reverse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">Reverse Transaction</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="transaction_id" value={transactionId} />
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for reversal</Label>
            <Textarea id="reason" name="reason" required placeholder="Why is this transaction being reversed?" />
          </div>
          <p className="text-xs text-muted-foreground">
            This creates a new offsetting entry — the original transaction is never deleted or edited, only marked as reversed.
          </p>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
