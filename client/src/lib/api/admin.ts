import { api } from "@/lib/api-client";
import type { Page } from "@/lib/api/types";
import type { UserRole } from "@dokuma/shared";

/**
 * Typed client functions for /api/admin.
 *
 * User management is admin-only; the audit trail is readable by admin, exec
 * and finance_manager — the same three roles as the Postgres policy it
 * replaces (migration 0013).
 */

export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  disabledAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  mfaEnrolled: boolean;
  createdAt: string | null;
  /** Never signed in — the invite has not been redeemed. */
  pendingInvite: boolean;
}

export function listUsers(): Promise<{ items: AdminUser[] }> {
  return api.get<{ items: AdminUser[] }>("/admin/users");
}

export interface IssuedLink {
  setPasswordPath: string;
  expiresAt: string;
  email?: string;
}

export function inviteUser(input: {
  email: string;
  fullName: string;
  role: UserRole;
}): Promise<IssuedLink & { user: { id: string; email: string; role: UserRole } }> {
  return api.post("/admin/users", input);
}

/** Reissues a set-password link; any previous link is voided. */
export function issuePasswordLink(userId: string): Promise<IssuedLink> {
  return api.post<IssuedLink>(`/admin/users/${userId}/password-link`);
}

export function changeUserRole(userId: string, role: UserRole): Promise<AdminUser> {
  return api.patch<AdminUser>(`/admin/users/${userId}/role`, { role });
}

export function setUserDisabled(userId: string, disabled: boolean): Promise<AdminUser> {
  return api.patch<AdminUser>(`/admin/users/${userId}/disabled`, { disabled });
}

export function resetUserMfa(userId: string): Promise<AdminUser> {
  return api.post<AdminUser>(`/admin/users/${userId}/reset-mfa`);
}

export function unlockUser(userId: string): Promise<AdminUser> {
  return api.post<AdminUser>(`/admin/users/${userId}/unlock`);
}

/* --------------------------------------------------------------------- *
 * Audit trail
 * --------------------------------------------------------------------- */

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  /** The role held at the time of the action, not necessarily their role now. */
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditFilters {
  action?: string;
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function queryAuditLog(filters: AuditFilters = {}): Promise<Page<AuditRow>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return api.get<Page<AuditRow>>(`/admin/audit-log${suffix ? `?${suffix}` : ""}`);
}

export function listAuditActions(): Promise<{ actions: string[] }> {
  return api.get<{ actions: string[] }>("/admin/audit-log/actions");
}
