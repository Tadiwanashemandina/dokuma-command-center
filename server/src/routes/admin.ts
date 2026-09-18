import { Router } from "express";
import { z } from "zod";
import { ADMIN_ONLY, USER_ROLES } from "@dokuma/shared";
import { AUDIT_ACTIONS } from "../db/models/index.js";
import { requireRole, requireAuthContext } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { createInvitedUser, issuePasswordSetToken } from "../services/invite.js";
import {
  changeUserRole,
  getUser,
  listUsers,
  resetUserMfa,
  setUserDisabled,
  unlockUser,
} from "../services/user-admin.js";
import { queryAuditLog, listAuditActions } from "../services/audit-query.js";
import { handle, ok, pagination, page, uuidParam } from "./helpers.js";

/**
 * User management and the audit trail (admin only).
 *
 * Replaces the CLI `invite` script for day-to-day use: creating an account,
 * changing a role, disabling someone or clearing their MFA are all operations
 * an administrator needs without shell access to the server.
 *
 * Every mutation here writes an audit row BEFORE returning, and each records
 * enough to answer "who changed what, from what, to what" — a role change that
 * logs only the new role cannot be reviewed, because the reviewer cannot tell
 * whether it was an escalation.
 */

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

adminRouter.get(
  "/users",
  ...requireRole(ADMIN_ONLY),
  handle(async (_req, res) => {
    ok(res, { items: await listUsers() });
  }),
);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  fullName: z.string().trim().min(1, "Enter a name.").max(200),
  role: z.enum(USER_ROLES),
});

adminRouter.post(
  "/users",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = inviteSchema.parse(req.body);

    const { user, token, expiresAt } = await createInvitedUser({
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      createdBy: auth.user.id as string,
    });

    await audit(req, {
      action: AUDIT_ACTIONS.USER_INVITED,
      entityType: "users",
      entityId: user.id as string,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email, role: input.role },
    });

    res.status(201).json({
      data: {
        user: { id: user.id as string, email: user.email, role: user.role },
        // Relative, so it resolves against whatever origin serves the client.
        setPasswordPath: `/set-password?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
      },
    });
  }),
);

/** Reissues a set-password link for an existing account. */
adminRouter.post(
  "/users/:id/password-link",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const userId = uuidParam(req);
    const user = await getUser(userId);

    const { token, expiresAt } = await issuePasswordSetToken(
      userId,
      "reset",
      auth.user.id as string,
    );

    await audit(req, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_ISSUED,
      entityType: "users",
      entityId: userId,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email },
    });

    ok(res, {
      setPasswordPath: `/set-password?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
      email: user.email,
    });
  }),
);

adminRouter.patch(
  "/users/:id/role",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const userId = uuidParam(req);
    const { role } = z.object({ role: z.enum(USER_ROLES) }).parse(req.body);

    const { user, previousRole } = await changeUserRole(auth.user.id as string, userId, role);

    await audit(req, {
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entityType: "users",
      entityId: userId,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      // Both values, so a reviewer can see whether this was an escalation.
      metadata: { email: user.email, from: previousRole, to: role },
    });

    ok(res, user);
  }),
);

adminRouter.patch(
  "/users/:id/disabled",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const userId = uuidParam(req);
    const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);

    const user = await setUserDisabled(auth.user.id as string, userId, disabled);

    await audit(req, {
      action: disabled ? AUDIT_ACTIONS.USER_DISABLED : AUDIT_ACTIONS.USER_ENABLED,
      entityType: "users",
      entityId: userId,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email },
    });

    ok(res, user);
  }),
);

adminRouter.post(
  "/users/:id/reset-mfa",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const userId = uuidParam(req);

    const user = await resetUserMfa(auth.user.id as string, userId);

    await audit(req, {
      action: AUDIT_ACTIONS.MFA_RESET,
      entityType: "users",
      entityId: userId,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email, by: "admin" },
    });

    ok(res, user);
  }),
);

adminRouter.post(
  "/users/:id/unlock",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const userId = uuidParam(req);

    const user = await unlockUser(userId);

    await audit(req, {
      action: AUDIT_ACTIONS.USER_UNLOCKED,
      entityType: "users",
      entityId: userId,
      actorId: auth.user.id as string,
      actorRole: auth.role,
      metadata: { email: user.email },
    });

    ok(res, user);
  }),
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Readable by admin, exec and finance_manager — the same three roles as the
 * Postgres policy `audit_log_select_admin_exec_finance_manager` (0013).
 * Deliberately wider than user management: reviewing history is oversight,
 * changing access is administration.
 */
const AUDIT_READERS = ["admin", "exec", "finance_manager"] as const;

const auditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  actionPrefix: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

adminRouter.get(
  "/audit-log",
  ...requireRole(AUDIT_READERS),
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const filters = auditQuerySchema.parse(req.query);

    const { items, total } = await queryAuditLog(filters, { limit, offset });
    ok(res, page(items, total, { limit, offset }));
  }),
);

adminRouter.get(
  "/audit-log/actions",
  ...requireRole(AUDIT_READERS),
  handle(async (_req, res) => {
    ok(res, { actions: await listAuditActions() });
  }),
);
