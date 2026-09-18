import { api } from "@/lib/api-client";
import type { Page } from "@/lib/api/types";

/** Typed client functions for /api/delivery-metrics. */

export interface DeliveryMetricRow {
  id: string;
  repo_name: string;
  project_id: string | null;
  project_name: string | null;
  metric_date: string | null;
  commits_count: number;
  deploys_count: number;
  open_defects_count: number;
  closed_defects_count: number;
  source: "manual" | "github" | "illustrative";
}

/**
 * The headline figures, computed server-side over a real trailing-7-day
 * window. The legacy page summed whichever rows it had fetched, so its
 * "last 7 days" cards actually described the last 30 ROWS.
 */
export interface DeliveryTotals {
  commits: number;
  deploys: number;
  open_defects: number;
}

export type DeliveryResponse = Page<DeliveryMetricRow> & { totals: DeliveryTotals };

export function listDeliveryMetrics(
  params: { limit?: number; offset?: number } = {},
): Promise<DeliveryResponse> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 25));
  if (params.offset) query.set("offset", String(params.offset));
  return api.get<DeliveryResponse>(`/delivery-metrics?${query.toString()}`);
}
