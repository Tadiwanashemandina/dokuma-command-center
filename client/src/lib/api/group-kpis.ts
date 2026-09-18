import type { SbuKpiMeasure } from "@dokuma/shared";
import { api } from "@/lib/api-client";

/**
 * Typed client for /api/group-kpis — the Group reporting surface.
 *
 * Distinct from `@/lib/api/dashboard`, which is Dokuma's own operational view.
 * This is what Dokuma reports UPWARD to the Office of the Chairman, on the
 * Group's own register of 45 bespoke + 14 spine measures.
 *
 * The measure DEFINITIONS are imported from `@dokuma/shared`, not fetched —
 * the register is a compile-time constant shared by both sides, so the client
 * can render a complete checklist of what is owed even while the figures are
 * still loading, and even when the request fails.
 */

/** A measure joined to its captured figure for a period. */
export interface MeasureWithValue {
  measure: SbuKpiMeasure;
  /** Exact decimal string — never parsed except at the point of display. */
  value: string | null;
  currency: string | null;
  note: string | null;
  period: string;
  capturedAt: string | null;
  capturedBy: string | null;
  syncState: "pending" | "sent" | "failed" | "not-applicable";
  /**
   * Where the figure came from. "seed" is a fabricated demo value and must
   * never be presented as a measurement.
   */
  source: "seed" | "qa" | "manual";
  /** null when there is no target or no value — "unknown", not "failing". */
  onTarget: boolean | null;
}

export interface RegisterCompleteness {
  total: number;
  captured: number;
  outstanding: number;
  /** Captured figures that came from the demo seed, not a measurement. */
  demo: number;
  exceptionsOutstanding: string[];
}

export interface FeedHealth {
  lastAttemptAt: string | null;
  lastAcceptedAt: string | null;
  lastOutcome: string | null;
  /** §11's alert condition: no accepted batch for today. */
  staleToday: boolean;
  consecutiveFailures: number;
}

export interface FeedConfig {
  mode: "disabled" | "dry-run" | "live";
  baseUrl: string | null;
  sbuCode: string;
  keyId: string | null;
  reason: string | null;
  health: FeedHealth;
}

export interface GroupKpiOverview {
  sbuCode: string;
  period: { month: string; date: string };
  exceptions: MeasureWithValue[];
  completeness: RegisterCompleteness;
  feed: FeedConfig;
}

export function getGroupKpiOverview(params?: {
  month?: string;
  date?: string;
}): Promise<GroupKpiOverview> {
  const query = new URLSearchParams();
  if (params?.month) query.set("month", params.month);
  if (params?.date) query.set("date", params.date);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return api.get<GroupKpiOverview>(`/group-kpis/overview${suffix}`);
}

export interface GroupKpiReadings {
  period: { month: string; date: string };
  readings: MeasureWithValue[];
}

export function getGroupKpiReadings(params?: {
  month?: string;
  date?: string;
}): Promise<GroupKpiReadings> {
  const query = new URLSearchParams();
  if (params?.month) query.set("month", params.month);
  if (params?.date) query.set("date", params.date);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return api.get<GroupKpiReadings>(`/group-kpis/readings${suffix}`);
}

export interface CaptureResult {
  measureCode: string;
  period: string;
  outcome: "saved" | "unchanged" | "cleared" | "rejected";
  error?: string;
}

/**
 * Saves figures.
 *
 * `value` is a decimal STRING or null. Passing a JSON number here is rejected
 * by the server rather than coerced — 99.95 is not exactly representable as a
 * float64, and this is how DATA_ACCURACY is captured.
 */
export function captureGroupKpiReadings(readings: {
  measureCode: string;
  period: string;
  value: string | null;
  currency?: string | null;
  note?: string | null;
  restatementReason?: string | null;
}[]): Promise<{ results: CaptureResult[] }> {
  return api.post<{ results: CaptureResult[] }>("/group-kpis/readings", { readings });
}

export interface FeedPreview {
  config: Omit<FeedConfig, "health">;
  batch: {
    sbuCode: string;
    clientBatchRef: string;
    atomic: boolean;
    documents: {
      measureCode: string;
      readingDate: string;
      value: string;
      status: string;
      sourceUpdatedAt: string;
    }[];
  };
  missing: { code: string; name: string }[];
  invalid: { code: string; value: string; problem: string }[];
}

/** Builds today's batch without sending it — the local dry run of §0 step 4. */
export function getFeedPreview(date?: string): Promise<FeedPreview> {
  return api.get<FeedPreview>(`/group-kpis/feed/preview${date ? `?date=${date}` : ""}`);
}

/**
 * A figure this platform computed from data it already holds.
 *
 * A SUGGESTION, never a saved value. `basis` says what it was computed from and
 * `confidence` how much to trust it — both are shown so the person capturing
 * can accept or overwrite with an informed eye rather than a blind click.
 */
export interface DerivedSuggestion {
  measureCode: string;
  value: string;
  basis: string;
  confidence: "high" | "medium" | "low";
}

export function getSuggestions(): Promise<{ suggestions: DerivedSuggestion[] }> {
  return api.get<{ suggestions: DerivedSuggestion[] }>("/group-kpis/suggestions");
}
