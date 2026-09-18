import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { FINANCE_APPROVE } from "@dokuma/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/query-states";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { PeriodReportFigures } from "@/routes/finance-report-detail";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  createMonthlyReport,
  createWeeklyReport,
  previewMonthlyReport,
  previewWeeklyReport,
  type CreatePeriodReportBody,
} from "@/lib/api/finance";

/**
 * Drafting a weekly or monthly report.
 *
 * Weekly and monthly differ in exactly four ways — the default period, the
 * preview endpoint, the submit endpoint, and the name of the forward-looking
 * field (`next_week_plan` vs `next_month_plan`). Everything else, including the
 * validation, the character limits and the read-only figure panel, is
 * identical, so there is one component and two thin wrappers rather than two
 * files that would drift apart the first time one of them was fixed.
 *
 * The figures are never editable. They are computed server-side from the ledger
 * and shown here only so the author can see what their narrative is describing;
 * an editable copy would let a report claim a balance the ledger does not have.
 */

/** Matches the server's own limit — see `CreatePeriodReportBody` validation. */
const MAX_TEXT = 5000;

type PeriodType = "weekly" | "monthly";

interface NarrativeState {
  executive_summary: string;
  key_advancements: string;
  challenges: string;
  plan: string;
}

const EMPTY_NARRATIVE: NarrativeState = {
  executive_summary: "",
  key_advancements: "",
  challenges: "",
  plan: "",
};

// ---------------------------------------------------------------------------
// Period defaults, computed in UTC
// ---------------------------------------------------------------------------

/**
 * UTC throughout, to match the server.
 *
 * `new Date()` in Harare (UTC+2) is two hours ahead of UTC, so a local-time
 * computation late on the last day of a month would produce next month's
 * range. Using the UTC getters makes the client's default period the same one
 * the server would compute for the same instant.
 */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Monday–Sunday week containing today, in UTC. */
function currentWeek(now = new Date()): { start: string; end: string } {
  const day = now.getUTCDay(); // 0 = Sunday
  // Sunday belongs to the week that started six days earlier, not the one
  // beginning tomorrow, so it maps to an offset of 6 rather than -1.
  const sinceMonday = day === 0 ? 6 : day - 1;

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - sinceMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { start: toIsoDate(start), end: toIsoDate(end) };
}

/** The calendar month containing today, in UTC. */
function currentMonth(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Day 0 of the following month is the last day of this one — which handles
  // month lengths and leap years without a table.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

// ---------------------------------------------------------------------------

const CONFIG: Record<
  PeriodType,
  {
    title: string;
    noun: string;
    planLabel: string;
    planField: "next_week_plan" | "next_month_plan";
    defaults: () => { start: string; end: string };
    preview: (start: string, end: string) => ReturnType<typeof previewWeeklyReport>;
    create: (body: CreatePeriodReportBody) => ReturnType<typeof createWeeklyReport>;
  }
> = {
  weekly: {
    title: "New weekly report",
    noun: "week",
    planLabel: "Plan for next week",
    planField: "next_week_plan",
    defaults: currentWeek,
    preview: previewWeeklyReport,
    create: createWeeklyReport,
  },
  monthly: {
    title: "New monthly report",
    noun: "month",
    planLabel: "Plan for next month",
    planField: "next_month_plan",
    defaults: currentMonth,
    preview: previewMonthlyReport,
    create: createMonthlyReport,
  },
};

export function FinanceWeeklyReportNewPage() {
  return <PeriodReportForm type="weekly" />;
}

export function FinanceMonthlyReportNewPage() {
  return <PeriodReportForm type="monthly" />;
}

// ---------------------------------------------------------------------------

function PeriodReportForm({ type }: { type: PeriodType }) {
  const config = CONFIG[type];
  useDocumentTitle(config.title);

  const navigate = useNavigate();
  const { user } = useAuth();
  const canPublish = user !== null && FINANCE_APPROVE.includes(user.role);

  const initial = useMemo(() => config.defaults(), [config]);
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [narrative, setNarrative] = useState<NarrativeState>(EMPTY_NARRATIVE);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** The server checks this too; doing it here saves a round trip. */
  const rangeInvalid = Boolean(periodStart) && Boolean(periodEnd) && periodEnd < periodStart;
  const datesPresent = Boolean(periodStart) && Boolean(periodEnd);

  const overLimit = Object.values(narrative).some((value) => value.length > MAX_TEXT);

  const preview = useQuery({
    queryKey: ["finance", "reports", "preview", type, periodStart, periodEnd],
    queryFn: () => config.preview(periodStart, periodEnd),
    enabled: datesPresent && !rangeInvalid,
  });

  const submit = useMutation({
    mutationFn: (publish: boolean) => {
      const body: CreatePeriodReportBody = {
        period_start: periodStart,
        period_end: periodEnd,
        publish,
        executive_summary: narrative.executive_summary,
        key_advancements: narrative.key_advancements,
        challenges: narrative.challenges,
        [config.planField]: narrative.plan,
      };
      return config.create(body);
    },
    onSuccess(result) {
      navigate(`/finance/reports/${result.id}`);
    },
    onError(caught) {
      setSubmitError(
        caught instanceof ApiRequestError ? caught.message : "Could not save this report.",
      );
    },
  });

  const blocked = rangeInvalid || !datesPresent || overLimit || submit.isPending;

  const setField = (key: keyof NarrativeState, value: string) =>
    setNarrative((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="space-y-6">
      <FinanceSubnav />

      <div>
        <Link
          to="/finance/reports"
          className="inline-flex items-center text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> All reports
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground">{config.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the {config.noun} and write the narrative. The figures below are computed from the
          ledger and are not editable — they are stored with the report exactly as shown.
        </p>
      </div>

      {/* ---- Period ------------------------------------------------------ */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg text-foreground">Reporting period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="period-start">Period start</Label>
              <Input
                id="period-start"
                type="date"
                className="rounded-xl"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-end">Period end</Label>
              <Input
                id="period-end"
                type="date"
                className="rounded-xl"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                aria-invalid={rangeInvalid}
              />
            </div>
          </div>

          {rangeInvalid && (
            <p role="alert" className="text-sm text-status-red">
              The period end must fall on or after the period start.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Computed figures -------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-serif text-lg text-foreground">Computed figures</h2>
          <span className="text-xs text-muted-foreground">
            Read-only · recalculated whenever the period changes
          </span>
        </div>

        {rangeInvalid || !datesPresent ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Choose a valid period to see the computed figures.
          </p>
        ) : preview.error ? (
          <QueryError
            error={preview.error}
            onRetry={() => void preview.refetch()}
            resource="the computed figures"
          />
        ) : preview.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : (
          <PeriodReportFigures data={preview.data} />
        )}
      </section>

      {/* ---- Narrative ---------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-serif text-lg text-foreground">Narrative</h2>

        <NarrativeField
          id="executive-summary"
          label="Executive summary"
          value={narrative.executive_summary}
          onChange={(v) => setField("executive_summary", v)}
        />
        <NarrativeField
          id="key-advancements"
          label="Key advancements"
          value={narrative.key_advancements}
          onChange={(v) => setField("key_advancements", v)}
        />
        <NarrativeField
          id="challenges"
          label="Challenges"
          value={narrative.challenges}
          onChange={(v) => setField("challenges", v)}
        />
        <NarrativeField
          id="plan"
          label={config.planLabel}
          value={narrative.plan}
          onChange={(v) => setField("plan", v)}
        />
      </section>

      {submitError && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {submitError}
        </p>
      )}

      {/* ---- Submit ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={blocked}
          onClick={() => {
            setSubmitError(null);
            submit.mutate(false);
          }}
        >
          {submit.isPending ? "Saving…" : "Save draft"}
        </Button>

        {/*
          Only FINANCE_APPROVE sees "Save & publish". A finance_officer's
          `publish: true` is refused server-side with a 403, and the legacy app's
          documented bug was offering the button anyway and letting the officer
          discover the rule by losing their draft to an error.
        */}
        {canPublish ? (
          <Button
            className="rounded-xl"
            disabled={blocked}
            onClick={() => {
              setSubmitError(null);
              submit.mutate(true);
            }}
          >
            {submit.isPending ? "Saving…" : "Save & publish"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Saved as a draft. A finance manager publishes it from the report page.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NarrativeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const over = value.length > MAX_TEXT;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={cn(
            "text-xs tabular-nums",
            over ? "font-medium text-status-red" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {value.length.toLocaleString("en-US")} / {MAX_TEXT.toLocaleString("en-US")}
        </span>
      </div>
      <Textarea
        id={id}
        rows={5}
        className="rounded-xl"
        value={value}
        aria-invalid={over}
        onChange={(e) => onChange(e.target.value)}
      />
      {over && (
        <p role="alert" className="text-xs text-status-red">
          {label} is over the {MAX_TEXT.toLocaleString("en-US")}-character limit and will be
          rejected. Trim it before saving.
        </p>
      )}
    </div>
  );
}
