import type { Request } from "express";
import { AuditLog } from "../db/models/index.js";
import type { UserRole } from "@dokuma/shared";

/**
 * Audit logging (inventory §4.7).
 *
 * The legacy app wrote an `audit_log` row from every mutating action. This
 * keeps that contract — same field names, same `action` vocabulary — so rows
 * imported from Postgres stay queryable alongside new ones.
 */

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: UserRole | "anonymous" | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit row.
 *
 * Never rejects. An audit write failing must not turn a successful login into a
 * 500 — the user would be authenticated but told they were not, and would
 * retry against a rate limit. The failure is logged to stderr instead, where
 * process-level monitoring can see it.
 */
export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  } catch (error) {
    console.error("[audit] failed to write entry", entry.action, error);
  }
}
