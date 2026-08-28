"use client";

import { useState, useTransition } from "react";
import { updateApplicationStageAction } from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STAGES = ["applied", "shortlisted", "interview", "offer", "hired", "rejected"];

export function StageSelect({ applicationId, stage }: { applicationId: string; stage: string }) {
  const [value, setValue] = useState(stage);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    setValue(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("application_id", applicationId);
      fd.set("stage", next);
      const result = await updateApplicationStageAction(null, fd);
      if (!result.ok) setValue(stage);
    });
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="h-7 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((s) => (
          <SelectItem key={s} value={s} className="capitalize">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
