"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createTransactionAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      {pending ? "Saving…" : "Create Transaction"}
    </Button>
  );
}

export function TransactionForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [isDlap, setIsDlap] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await createTransactionAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy hover:bg-navy/90">New Transaction</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">New Transaction</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="account_id">Account</Label>
              <Select name="account_id" required>
                <SelectTrigger id="account_id">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select name="type" required>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Debit or credit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (money in)</SelectItem>
                  <SelectItem value="debit">Debit (money out)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input id="category" name="category" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="counterparty">Counterparty</Label>
              <Input id="counterparty" name="counterparty" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference_no">Reference No.</Label>
            <Input id="reference_no" name="reference_no" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="is_dlap" name="is_dlap" checked={isDlap} onCheckedChange={(v) => setIsDlap(v === true)} />
            <Label htmlFor="is_dlap" className="cursor-pointer font-normal">
              This is a DLAP transaction
            </Label>
          </div>

          {isDlap && (
            <div className="space-y-2">
              <Label htmlFor="dlap_share_pct">Dokuma&apos;s Share (%)</Label>
              <Input id="dlap_share_pct" name="dlap_share_pct" type="number" step="0.01" min="0" max="100" />
            </div>
          )}

          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
