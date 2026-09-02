"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { uploadJdAttachmentAction, getJdAttachmentUrlAction, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
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
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Uploading…" : "Upload"}
    </Button>
  );
}

export function JdAttachmentButton({
  employeeId,
  jobDescriptionId,
  attachmentPath,
  canUpload,
}: {
  employeeId: string;
  jobDescriptionId: string;
  attachmentPath: string | null;
  canUpload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loadingView, setLoadingView] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await uploadJdAttachmentAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  async function handleView() {
    if (!attachmentPath) return;
    setLoadingView(true);
    const url = await getJdAttachmentUrlAction(attachmentPath);
    setLoadingView(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex items-center gap-2">
      {attachmentPath && (
        <Button variant="ghost" size="sm" onClick={handleView} disabled={loadingView}>
          {loadingView ? "Opening…" : "View attachment"}
        </Button>
      )}
      {canUpload && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-steel">
              {attachmentPath ? "Replace attachment" : "Attach document"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-navy">Attach Job Description Document</DialogTitle>
            </DialogHeader>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="job_description_id" value={jobDescriptionId} />
              <input type="hidden" name="employee_id" value={employeeId} />
              <input
                type="file"
                name="file"
                required
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              />
              <p className="text-xs text-muted-foreground">PDF, Word, or image, up to 10MB.</p>
              {state.error && <p className="text-sm text-status-red">{state.error}</p>}
              <SubmitButton />
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
