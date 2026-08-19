"use client";

import { useFormState, useFormStatus } from "react-dom";
import { importLazyBossCsv, type ImportResult } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: ImportResult = { inserted: 0, skipped: 0, errors: [] };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="bg-navy hover:bg-navy/90" disabled={pending}>
      {pending ? "Importing…" : "Import CSV"}
    </Button>
  );
}

export function ImportForm() {
  const [state, formAction] = useFormState(importLazyBossCsv, initialState);

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-6">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">LazyBoss CSV file</Label>
            <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
          </div>
          <SubmitButton />
        </form>

        {(state.inserted > 0 || state.skipped > 0 || state.errors.length > 0) && (
          <div className="space-y-2 border-t border-border/60 pt-4 text-sm">
            <p className="text-navy">
              Imported <span className="font-medium">{state.inserted}</span> rows, skipped{" "}
              <span className="font-medium">{state.skipped}</span>.
            </p>
            {state.errors.length > 0 && (
              <ul className="list-inside list-disc text-status-red">
                {state.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
