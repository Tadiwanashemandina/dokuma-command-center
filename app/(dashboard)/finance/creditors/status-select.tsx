"use client";

import { useState, useTransition } from "react";
import { updateCreditorStatusAction } from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CreditorStatusSelect({ creditorId, status }: { creditorId: string; status: string }) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    setValue(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("creditor_id", creditorId);
      fd.set("status", next);
      const result = await updateCreditorStatusAction(null, fd);
      if (!result.ok) setValue(status);
    });
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="h-8 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="outstanding">Outstanding</SelectItem>
        <SelectItem value="partially_paid">Partially Paid</SelectItem>
        <SelectItem value="paid">Paid</SelectItem>
      </SelectContent>
    </Select>
  );
}
