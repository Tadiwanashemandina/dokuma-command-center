import type { FilterQuery } from "mongoose";
import { AuditLog, User } from "../db/models/index.js";

/**
 * Reading the audit trail.
 *
 * `services/audit.ts` writes; this reads. Kept separate because the write path
 * must never fail a business action and so swallows its errors, while a read
 * that fails should surface — different obligations, different module.
 *
 * Access is enforced at the route (admin, exec, finance_manager — migration
 * 0013's policy). Nothing here filters by role, so it must not be called from
 * an unguarded handler.
 */

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  /** Resolved for display; null when the actor was deleted or was the system. */
  actor_email: string | null;
  actor_name: string | null;
  /** The role at the time of the action, which may differ from their role now. */
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditFilters {
  /** Exact action, e.g. "auth.login.failed". */
  action?: string;
  /** Prefix match, e.g. "auth." for everything authentication-related. */
  actionPrefix?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  /** ISO timestamps. */
  from?: Date;
  to?: Date;
}

export async function queryAuditLog(
  filters: AuditFilters,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ items: AuditRow[]; total: number }> {
  const filter: FilterQuery<Record<string, unknown>> = {};

  if (filters.action) filter["action"] = filters.action;
  else if (filters.actionPrefix) {
    // Anchored and escaped: an unescaped prefix would let a caller inject
    // regex metacharacters into a database query.
    filter["action"] = {
      $regex: `^${filters.actionPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    };
  }

  if (filters.actorId) filter["actorId"] = filters.actorId;
  if (filters.entityType) filter["entityType"] = filters.entityType;
  if (filters.entityId) filter["entityId"] = filters.entityId;

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range["$gte"] = filters.from;
    if (filters.to) range["$lte"] = filters.to;
    filter["createdAt"] = range;
  }

  const [rows, total] = await Promise.all([
    // Newest first — an audit trail is read from the incident backwards.
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  // Resolve actor identities in one lookup. The row stores only the id,
  // deliberately: an email captured at write time would go stale, and the row
  // must survive the user being deleted (ON DELETE SET NULL).
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select("email fullName").lean()
    : [];
  const byId = new Map(actors.map((a) => [a._id, a]));

  return {
    items: rows.map((row) => {
      const actor = row.actorId ? byId.get(row.actorId) : undefined;
      return {
        id: row._id,
        action: row.action,
        entity_type: row.entityType,
        entity_id: row.entityId ?? null,
        actor_id: row.actorId ?? null,
        actor_email: actor?.email ?? null,
        actor_name: actor?.fullName ?? null,
        actor_role: row.actorRole ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        ip: row.ip ?? null,
        user_agent: row.userAgent ?? null,
        created_at: row.createdAt.toISOString(),
      };
    }),
    total,
  };
}

/**
 * The distinct actions present, for the filter dropdown.
 *
 * Read from the data rather than from a hard-coded list so actions added by
 * later modules appear without touching this file.
 */
export async function listAuditActions(): Promise<string[]> {
  const actions = await AuditLog.distinct("action");
  return (actions as string[]).sort();
}
