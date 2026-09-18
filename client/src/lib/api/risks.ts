import { api } from "@/lib/api-client";
import type { Page } from "@/lib/api/types";
import type { ProjectStatus } from "@/lib/api/projects";

/** Typed client functions for /api/risks (department-scoped, §4.5). */

export type DepartmentScope = "finance" | "hr" | null;

export interface RiskRow {
  id: string;
  type: "risk" | "issue" | "decision";
  title: string;
  description: string | null;
  project_id: string | null;
  /** null means company-wide. */
  project_name: string | null;
  owner_name: string | null;
  due_date: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  probability: "low" | "medium" | "high" | null;
  impact: "low" | "medium" | "high" | null;
  status: "open" | "mitigating" | "closed";
  department: DepartmentScope;
}

/**
 * The server echoes the caller's scope so the page can title itself without
 * recomputing the rule from the user's role.
 */
export type RisksResponse = Page<RiskRow> & { scope: DepartmentScope };

export function listRisks(
  params: { critical?: boolean; limit?: number; offset?: number } = {},
): Promise<RisksResponse> {
  const query = new URLSearchParams();
  if (params.critical) query.set("critical", "true");
  query.set("limit", String(params.limit ?? 50));
  if (params.offset) query.set("offset", String(params.offset));
  return api.get<RisksResponse>(`/risks?${query.toString()}`);
}

export interface ClientProjectRow {
  id: string;
  name: string;
  status: ProjectStatus;
}

export interface ClientRow {
  id: string;
  name: string;
  industry: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  relationship_owner: string | null;
  tier: "strategic" | "key" | "standard" | null;
  notes: string | null;
  department: DepartmentScope;
  /** Linked projects, nested by the server. */
  projects: ClientProjectRow[];
}

export type ClientsResponse = Page<ClientRow> & { scope: DepartmentScope };

export function listClients(
  params: { limit?: number; offset?: number } = {},
): Promise<ClientsResponse> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  if (params.offset) query.set("offset", String(params.offset));
  return api.get<ClientsResponse>(`/clients?${query.toString()}`);
}
