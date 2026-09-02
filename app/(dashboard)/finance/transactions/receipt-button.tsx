"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { uploadReceiptAction, getReceiptUrlAction, type ActionResult } from "./actions";
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
    <Button type="submit" disabled={pending}>
      {pending ? "Uploading…" : "Upload"}
    </Button>
  );
}

export function ReceiptButton({
  transactionId,
  receiptPath,
  canUpload,
}: {
  transactionId: string;
  receiptPath: string | null;
  canUpload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loadingView, setLoadingView] = useState(false);
  const [state, formAction] = useFormState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await uploadReceiptAction(prev, fd);
    if (result.ok) setOpen(false);
    return result;
  }, initialState);

  async function handleView() {
    if (!receiptPath) return;
    setLoadingView(true);
    const url = await getReceiptUrlAction(receiptPath);
    setLoadingView(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  if (receiptPath) {
    return (
      <Button variant="ghost" size="sm" onClick={handleView} disabled={loadingView}>
        {loadingView ? "Opening…" : "View receipt"}
      </Button>
    );
  }

  if (!canUpload) return <span className="text-muted-foreground">—</span>;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-steel">
          Attach receipt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-navy">Attach Receipt</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="transaction_id" value={transactionId} />
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
  );
}
