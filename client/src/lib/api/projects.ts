import { api } from "@/lib/api-client";
import type { Page } from "@/lib/api/types";

/**
 * Typed client functions for /api/projects.
 *
 * These replace the server-component `supabase.from("projects").select(...)`
 * calls the pages made directly. The wire shape is snake_case because it
 * mirrors the columns the ported components already read.
 *
 * Money arrives as a STRING, not a number: the server keeps ledger values in
 * Decimal128 and serializes them exactly (D-12). Parse at the point of
 * display, never accumulate in float.
 */

/** The RAG status a project carries. */
export type ProjectStatus = "green" | "amber" | "red";

export interface ProjectRow {
  id: string;
  name: string;
  status: ProjectStatus;
  owner_name: string | null;
  budget_usd: string | null;
  start_date: string | null;
  target_end_date: string | null;
  description: string | null;
  client_id: string | null;
  client_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MilestoneRow {
  id: string;
  name: string;
  due_date: string | null;
  status: "pending" | "on_track" | "at_risk" | "done";
}

export interface TaskRow {
  id: string;
  title: string;
  assignee_name: string | null;
  due_date: string | null;
  status: "todo" | "in_progress" | "blocked" | "done";
}

export interface ProjectRiskRow {
  id: string;
  type: "risk" | "issue" | "decision";
  title: string;
  description: string | null;
  owner_name: string | null;
  due_date: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  probability: "low" | "medium" | "high" | null;
  impact: "low" | "medium" | "high" | null;
  status: "open" | "mitigating" | "closed";
}

export interface ProjectDetail {
  project: ProjectRow;
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  risks: ProjectRiskRow[];
}

export interface ProjectListParams {
  status?: "green" | "amber" | "red";
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProjects(params: ProjectListParams = {}): Promise<Page<ProjectRow>> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));

  const suffix = query.toString();
  return api.get<Page<ProjectRow>>(`/projects${suffix ? `?${suffix}` : ""}`);
}

export function getProject(id: string): Promise<ProjectDetail> {
  return api.get<ProjectDetail>(`/projects/${id}`);
}
