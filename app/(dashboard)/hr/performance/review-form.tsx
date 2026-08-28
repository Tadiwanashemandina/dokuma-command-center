"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createPerformanceReviewAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      {pending ? "Saving…" : "Save Review"}
    </Button>
  );
}

export function ReviewForm({ employees }: { employees: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await createPerformanceReviewAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy hover:bg-navy/90">New Review</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">New Performance Review</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employee_id">Employee</Label>
            <Select name="employee_id" required>
              <SelectTrigger id="employee_id">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="period">Period</Label>
            <Input id="period" name="period" placeholder="e.g. Q3 2026" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goals">Goals</Label>
            <Textarea id="goals" name="goals" rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rating">Rating</Label>
              <Input id="rating" name="rating" placeholder="e.g. Exceeds Expectations" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue="draft">
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="comments">Comments</Label>
            <Textarea id="comments" name="comments" rows={3} />
          </div>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
