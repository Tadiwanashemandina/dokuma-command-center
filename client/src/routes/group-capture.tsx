import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Check, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  KPI_CATEGORIES,
  formatTarget,
  isDecimalString,
  periodFormatFor,
  type SbuKpiCategory,
} from "@dokuma/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-states";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";
import {
  captureGroupKpiReadings,
  getGroupKpiReadings,
  getSuggestions,
  type MeasureWithValue,
  type DerivedSuggestion,
} from "@/lib/api/group-kpis";

/**
 * Month-end capture for the Group register.
 *
 * §9 of the specification calls the 41 manual measures "not an integration" —
 * they are typed in by Dokuma's own finance and operations people as part of
 * the month-end routine. This is that screen.
 *
 * ---------------------------------------------------------------------------
 * Why capture is separate from the board view
 * ---------------------------------------------------------------------------
 * `/group` answers "what has the board been told"; this answers "what do we
 * still owe". Different job, different reader, different rhythm — one is read
 * at a glance by an executive, the other is worked through row by row by
 * whoever owns the numbers. Merging them would make the board view an editable
 * form, which is exactly how a stray keystroke becomes a restated figure.
 *
 * ---------------------------------------------------------------------------
 * Suggestions are offered, never applied
 * ---------------------------------------------------------------------------
 * Where this platform can compute a figure it shows it beside the field with
 * what it was derived from, and the person clicks to accept. Nothing is
 * pre-filled. A pre-filled derivation is indistinguishable from a verified
 * figure once saved, and some of these derivations rest on tables flagged
 * `illustrative` — so the click is the point at which a human takes
 * responsibility for the number.
 */

/** Spine measures are excluded: the Group derives those from documents. */
const CAPTURE_CATEGORIES = KPI_CATEGORIES.filter((c) => c !== "group-spine");

export function GroupCapturePage() {
  useDocumentTitle("Group Capture");
  const queryClient = useQueryClient();

  /** Local edits, keyed `measureCode|period`. Not written until Save. */
  const [edits, setEdits] = useState<Record<string, string>>({});

  const readings = useQuery({
    queryKey: ["group-kpis", "readings"],
    queryFn: () => getGroupKpiReadings(),
  });

  const suggestions = useQuery({
    queryKey: ["group-kpis", "suggestions"],
    queryFn: getSuggestions,
    staleTime: 60_000,
  });

  const suggestionByCode = useMemo(() => {
    const map = new Map<string, DerivedSuggestion>();
    for (const s of suggestions.data?.suggestions ?? []) map.set(s.measureCode, s);
    return map;
  }, [suggestions.data]);

  const rows = useMemo(
    () => (readings.data?.readings ?? []).filter((r) => r.measure.route !== "derived"),
    [readings.data],
  );

  const save = useMutation({
    mutationFn: captureGroupKpiReadings,
    onSuccess: (result) => {
      const saved = result.results.filter((r) => r.outcome === "saved" || r.outcome === "cleared").length;
      const rejected = result.results.filter((r) => r.outcome === "rejected");

      if (rejected.length > 0) {
        // Named individually: "3 rejected" tells someone there is a problem but
        // not which figure to go back and fix.
        toast.error(`${rejected.length} rejected`, {
          description: rejected.map((r) => `${r.measureCode}: ${r.error ?? "invalid"}`).join("; "),
        });
      }
      if (saved > 0) toast.success(`${saved} figure${saved === 1 ? "" : "s"} saved`);

      setEdits({});
      void queryClient.invalidateQueries({ queryKey: ["group-kpis"] });
    },
    onError: (error: Error) => toast.error("Could not save", { description: error.message }),
  });

  const keyOf = (row: MeasureWithValue) => `${row.measure.code}|${row.period}`;

  /** The value to display: a pending edit if there is one, else what is stored. */
  const displayValue = (row: MeasureWithValue): string => {
    const pending = edits[keyOf(row)];
    return pending !== undefined ? pending : (row.value ?? "");
  };

  const isDirty = (row: MeasureWithValue) => edits[keyOf(row)] !== undefined;

  /** A pending edit that would be refused by the server, flagged before Save. */
  const isInvalid = (row: MeasureWithValue): boolean => {
    const pending = edits[keyOf(row)];
    if (pending === undefined || pending === "") return false;
    return !isDecimalString(pending);
  };

  const dirtyCount = Object.keys(edits).length;
  const invalidCount = rows.filter(isInvalid).length;

  function setValue(row: MeasureWithValue, value: string) {
    setEdits((prev) => ({ ...prev, [keyOf(row)]: value }));
  }

  function handleSave() {
    const payload = rows
      .filter(isDirty)
      .filter((r) => !isInvalid(r))
      .map((row) => ({
        measureCode: row.measure.code,
        period: row.period,
        // An emptied field CLEARS the figure rather than storing "" — the
        // server takes null to mean "no figure", which is distinct from zero.
        value: edits[keyOf(row)] === "" ? null : edits[keyOf(row)]!,
      }));

    if (payload.length === 0) return;
    save.mutate(payload);
  }

  const captured = rows.filter((r) => r.value !== null).length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-8 pb-32">
      <div className="flex flex-col justify-between gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-steel">
            <ClipboardList className="h-3.5 w-3.5" /> Month-end routine
          </div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-navy">Group Capture</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The 45 bespoke measures Dokuma reports to the Group. The 14 spine measures are not here —
            the Group derives those from finance documents.
          </p>
        </div>

        {readings.data && (
          <div className="text-right text-sm">
            <p className="font-semibold text-navy">
              {captured} of {rows.length} captured
            </p>
            <p className="text-muted-foreground">{readings.data.period.month}</p>
          </div>
        )}
      </div>

      {readings.error ? (
        <QueryError
          error={readings.error}
          onRetry={() => void readings.refetch()}
          resource="the capture sheet"
        />
      ) : readings.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {CAPTURE_CATEGORIES.map((category) => (
            <CategoryBlock
              key={category}
              category={category}
              rows={rows.filter((r) => r.measure.category === category)}
              displayValue={displayValue}
              isDirty={isDirty}
              isInvalid={isInvalid}
              setValue={setValue}
              suggestionByCode={suggestionByCode}
            />
          ))}
        </div>
      )}

      {/* A sticky bar rather than a button at the bottom of a 45-row form: on a
          list this long the save control would otherwise be off-screen for most
          of the work, and unsaved edits are easy to lose by navigating away. */}
      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-6 py-4">
            <span className="text-sm font-medium text-navy">
              {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            </span>

            {invalidCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-sm text-status-red">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {invalidCount} invalid — these will not be saved
              </span>
            )}

            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setEdits({})} disabled={save.isPending}>
                Discard
              </Button>
              <Button
                onClick={handleSave}
                disabled={save.isPending || dirtyCount === invalidCount}
              >
                {save.isPending ? "Saving…" : `Save ${dirtyCount - invalidCount} figure(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategoryBlock({
  category,
  rows,
  displayValue,
  isDirty,
  isInvalid,
  setValue,
  suggestionByCode,
}: {
  category: SbuKpiCategory;
  rows: MeasureWithValue[];
  displayValue: (row: MeasureWithValue) => string;
  isDirty: (row: MeasureWithValue) => boolean;
  isInvalid: (row: MeasureWithValue) => boolean;
  setValue: (row: MeasureWithValue, value: string) => void;
  suggestionByCode: Map<string, DerivedSuggestion>;
}) {
  if (rows.length === 0) return null;

  const outstanding = rows.filter((r) => r.value === null).length;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-0">
        <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
          <h2 className="font-serif text-base text-navy">{CATEGORY_LABELS[category]}</h2>
          <span className="text-xs text-muted-foreground">{rows.length}</span>
          {outstanding > 0 && (
            <span className="ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
              {outstanding} outstanding
            </span>
          )}
        </div>

        <div className="divide-y divide-border/40">
          {rows.map((row) => {
            const suggestion = suggestionByCode.get(row.measure.code);
            const invalid = isInvalid(row);
            const dirty = isDirty(row);

            return (
              <div key={row.measure.code} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">{row.measure.name}</span>
                    {row.measure.exception && (
                      <span className="rounded-full bg-navy/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
                        Board
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                    <code>{row.measure.code}</code>
                    <span>{row.measure.unit.toLowerCase()}</span>
                    <span>{row.measure.frequency.toLowerCase()}</span>
                    {formatTarget(row.measure.target) && (
                      <span>target {formatTarget(row.measure.target)}</span>
                    )}
                    {/* §12: a scalar standing in for a breakdown. Said here so a
                        total is not later read as split by type. */}
                    {row.measure.dimensioned && (
                      <span className="text-gold">total only — not by {row.measure.dimensioned}</span>
                    )}
                    {periodFormatFor(row.measure) === "date" && (
                      <span className="text-steel">daily feed — {row.period}</span>
                    )}
                  </div>
                </div>

                {suggestion && (
                  <button
                    type="button"
                    onClick={() => setValue(row, suggestion.value)}
                    title={suggestion.basis}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      suggestion.confidence === "low"
                        ? "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
                        : "border-teal/40 bg-teal/10 text-teal hover:bg-teal/20",
                    )}
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    {suggestion.value}
                    {suggestion.confidence === "low" && " (unverified)"}
                  </button>
                )}

                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    value={displayValue(row)}
                    onChange={(e) => setValue(row, e.target.value)}
                    placeholder="—"
                    inputMode="decimal"
                    aria-label={row.measure.name}
                    aria-invalid={invalid}
                    className={cn(
                      "w-32 text-right tabular-nums",
                      invalid && "border-status-red focus-visible:ring-status-red",
                      dirty && !invalid && "border-teal",
                    )}
                  />
                  {row.value !== null && !dirty && (
                    <Check className="h-4 w-4 text-status-green" aria-label="captured" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
