"use client";

import { useState, useTransition } from "react";
import { updatePaymentNoticeStatusAction } from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PaymentNoticeStatusSelect({ noticeId, status }: { noticeId: string; status: string }) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    setValue(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("notice_id", noticeId);
      fd.set("status", next);
      const result = await updatePaymentNoticeStatusAction(null, fd);
      if (!result.ok) setValue(status);
    });
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="h-8 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="scheduled">Scheduled</SelectItem>
        <SelectItem value="sent">Sent</SelectItem>
        <SelectItem value="paid">Paid</SelectItem>
      </SelectContent>
    </Select>
  );
}
