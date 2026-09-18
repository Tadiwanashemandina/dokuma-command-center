import type { UserRole } from "@dokuma/shared";
import { User, type UserDocument } from "../db/models/index.js";
import { revokeAllSessions } from "./session.js";
import { HttpError } from "../middleware/error.js";

/**
 * Administrative operations on user accounts.
 *
 * Every function here changes who can see what, so each one has the same two
 * obligations: refuse the operations that would lock the organisation out of
 * its own system, and revoke the target's live sessions whenever their
 * authority changes. A role change that leaves an open session running under
 * the old role is not a role change — the session carries the authorization.
 */

/** A user as the admin list renders them. Never includes secrets. */
export interface AdminUserView {
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
  /** True when this account has never redeemed an invite. */
  pendingInvite: boolean;
}

export function toAdminUserView(user: UserDocument | Record<string, never>): AdminUserView {
  const u = user as unknown as {
    _id: string;
    email: string;
    fullName: string | null;
    role: UserRole;
    disabledAt: Date | null;
    lastLoginAt: Date | null;
    lockedUntil: Date | null;
    failedLoginCount: number;
    mfa?: { verifiedAt?: Date | null };
    createdAt?: Date | null;
  };

  return {
    id: u._id,
    email: u.email,
    fullName: u.fullName ?? null,
    role: u.role,
    disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
    failedLoginCount: u.failedLoginCount ?? 0,
    mfaEnrolled: Boolean(u.mfa?.verifiedAt),
    createdAt: u.createdAt ? u.createdAt.toISOString() : null,
    // Never signed in and no MFA: the invite has not been redeemed. Useful in
    // the list because a pending invite looks identical to a dormant account
    // otherwise.
    pendingInvite: !u.lastLoginAt,
  };
}

/**
 * Guards against removing the last route back in.
 *
 * Demoting or disabling the only remaining active admin leaves nobody able to
 * restore anyone — including themselves. The CLI invite script is the manual
 * escape hatch, but relying on shell access to recover from a UI click is not
 * a recovery plan.
 */
async function assertNotLastAdmin(userId: string, because: string): Promise<void> {
  const target = await User.findById(userId).select("role disabledAt").lean();
  if (!target || target.role !== "admin" || target.disabledAt) return;

  const otherActiveAdmins = await User.countDocuments({
    _id: { $ne: userId },
    role: "admin",
    disabledAt: null,
  });

  if (otherActiveAdmins === 0) {
    throw new HttpError(
      409,
      `This is the only active admin account. ${because} would leave nobody able to manage users. ` +
        `Promote another admin first.`,
    );
  }
}

/** Refuses operations an admin aims at their own account. */
function assertNotSelf(actorId: string, targetId: string, action: string): void {
  if (actorId === targetId) {
    throw new HttpError(409, `You cannot ${action} your own account.`);
  }
}

export async function listUsers(): Promise<AdminUserView[]> {
  const users = await User.find({}).sort({ email: 1 }).lean();
  return users.map((u) => toAdminUserView(u as never));
}

export async function getUser(userId: string): Promise<AdminUserView> {
  const user = await User.findById(userId).lean();
  if (!user) throw new HttpError(404, "User not found.");
  return toAdminUserView(user as never);
}

export interface RoleChange {
  user: AdminUserView;
  previousRole: UserRole;
}

/**
 * Changes a user's role.
 *
 * Sessions are revoked because role is read from the session record on every
 * request: leaving one open would let the user keep acting under the role they
 * just lost, until it expired on its own.
 */
export async function changeUserRole(
  actorId: string,
  userId: string,
  role: UserRole,
): Promise<RoleChange> {
  assertNotSelf(actorId, userId, "change the role of");

  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found.");

  const previousRole = user.role as UserRole;
  if (previousRole === role) {
    throw new HttpError(409, `That account already has the "${role}" role.`);
  }

  if (role !== "admin") {
    await assertNotLastAdmin(userId, "Changing its role");
  }

  user.role = role;
  await user.save();

  await revokeAllSessions(userId);

  return { user: toAdminUserView(user as never), previousRole };
}

/**
 * Disables an account.
 *
 * Deliberately not a delete. `audit_log.actor_id` and every `created_by`
 * reference point at users; removing the row would orphan history that exists
 * precisely to be auditable. The login path already refuses a disabled
 * account, and revoking sessions makes it effective immediately rather than
 * at the next expiry.
 */
export async function setUserDisabled(
  actorId: string,
  userId: string,
  disabled: boolean,
): Promise<AdminUserView> {
  if (disabled) {
    assertNotSelf(actorId, userId, "disable");
    await assertNotLastAdmin(userId, "Disabling it");
  }

  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found.");

  user.disabledAt = disabled ? new Date() : null;

  if (!disabled) {
    // Re-enabling clears a lockout too; otherwise the account is enabled but
    // still refuses the password, which reads as the re-enable not working.
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }

  await user.save();

  if (disabled) await revokeAllSessions(userId);

  return toAdminUserView(user as never);
}

/**
 * Clears a user's TOTP factor so they enroll again at next sign-in.
 *
 * For someone who has lost both their authenticator and their recovery codes.
 * Distinct from `POST /api/auth/mfa/reset`, which is self-service and requires
 * the user's own password — unusable in exactly this situation.
 *
 * Sessions are revoked so an already-verified session cannot continue at aal2
 * with no factor behind it.
 */
export async function resetUserMfa(actorId: string, userId: string): Promise<AdminUserView> {
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found.");

  user.mfa.secret = null;
  user.mfa.pendingSecret = null;
  user.mfa.verifiedAt = null;
  user.mfa.recoveryCodeHashes = [];
  await user.save();

  await revokeAllSessions(userId);

  return toAdminUserView(user as never);
}

/** Clears a lockout without waiting for the window to lapse. */
export async function unlockUser(userId: string): Promise<AdminUserView> {
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found.");

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();

  return toAdminUserView(user as never);
}
