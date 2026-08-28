"use client";

import { useState, useTransition } from "react";
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

export function DecisionButtons({
  requestId,
  action,
}: {
  requestId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(decision: "approve" | "reject", comment: string) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("request_id", requestId);
      fd.set("decision", decision);
      fd.set("comment", comment);
      try {
        await action(fd);
        setOpen(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Dialog open={open === "approve"} onOpenChange={(v) => setOpen(v ? "approve" : null)}>
        <DialogTrigger asChild>
          <Button size="sm" className="bg-status-green hover:bg-status-green/90">
            Approve
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-navy">Approve Leave Request</DialogTitle>
          </DialogHeader>
          <DecisionForm pending={pending} error={error} onSubmit={(c) => submit("approve", c)} confirmLabel="Approve" />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "reject"} onOpenChange={(v) => setOpen(v ? "reject" : null)}>
        <DialogTrigger asChild>
          <Button size="sm" variant="destructive">
            Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-navy">Reject Leave Request</DialogTitle>
          </DialogHeader>
          <DecisionForm pending={pending} error={error} onSubmit={(c) => submit("reject", c)} confirmLabel="Reject" destructive />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DecisionForm({
  onSubmit,
  pending,
  error,
  confirmLabel,
  destructive,
}: {
  onSubmit: (comment: string) => void;
  pending: boolean;
  error: string | null;
  confirmLabel: string;
  destructive?: boolean;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="comment">Comment (optional)</Label>
        <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      </div>
      {error && <p className="text-sm text-status-red">{error}</p>}
      <Button
        onClick={() => onSubmit(comment)}
        disabled={pending}
        variant={destructive ? "destructive" : "default"}
        className={destructive ? "" : "bg-navy hover:bg-navy/90"}
      >
        {pending ? "Saving…" : confirmLabel}
      </Button>
    </div>
  );
}
