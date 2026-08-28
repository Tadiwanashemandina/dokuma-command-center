"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createTrainingRecordAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {pending ? "Saving…" : "Add Training Record"}
    </Button>
  );
}

export function TrainingForm({ employees }: { employees: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await createTrainingRecordAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy hover:bg-navy/90">Add Training Record</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">Add Training Record</DialogTitle>
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
            <Label htmlFor="course_name">Course Name</Label>
            <Input id="course_name" name="course_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Input id="provider" name="provider" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="completed_at">Completed On</Label>
              <Input id="completed_at" name="completed_at" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expires_at">Expires On</Label>
              <Input id="expires_at" name="expires_at" type="date" />
            </div>
          </div>
          {state.error && <p className="text-sm text-status-red">{state.error}</p>}
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
