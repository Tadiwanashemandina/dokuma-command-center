import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { UserRole } from "@dokuma/shared";
import { PasswordSetToken, User, type UserDocument } from "../db/models/index.js";
import { hashPassword } from "./password.js";
import { HttpError } from "../middleware/error.js";

/**
 * Account invites and password resets.
 *
 * Supabase Auth supplied this and nothing replaced it: after the migration an
 * admin could only create an account by choosing the password themselves and
 * passing it to the user out of band. This restores the invite-link flow
 * without the vendor.
 *
 * The token is 256 bits of entropy in the URL; only its SHA-256 is stored, so
 * a database dump yields nothing replayable. Same reasoning as the session
 * cookie — see the note on `sessionSchema`.
 */

/** How long a link stays valid. Long enough to act on, short enough to bound. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  /** The raw token — returned once, only ever present in the link. */
  token: string;
  expiresAt: Date;
}

/**
 * Issues a set-password token for an existing user.
 *
 * Any unused token for that user is consumed first: two live links for one
 * account means a revoked-and-reissued invite is still redeemable through the
 * old link, which defeats the point of reissuing it.
 */
export async function issuePasswordSetToken(
  userId: string,
  purpose: "invite" | "reset",
  createdBy: string | null,
): Promise<IssuedToken> {
  await PasswordSetToken.updateMany(
    { userId, usedAt: null },
    { $set: { usedAt: new Date() } },
  );

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (purpose === "invite" ? INVITE_TTL_MS : RESET_TTL_MS));

  await PasswordSetToken.create({
    _id: hashToken(token),
    userId,
    purpose,
    expiresAt,
    createdBy,
  });

  return { token, expiresAt };
}

export interface CreatedUser {
  user: UserDocument;
  token: string;
  expiresAt: Date;
}

/**
 * Creates an account that has no usable password yet, plus its invite token.
 *
 * `passwordHash` is required on the model, so the account is seeded with a
 * hash of 32 random bytes that is never shown to anyone. That is deliberate
 * rather than a placeholder: it means the account cannot be logged into at all
 * until the invite is redeemed, instead of being briefly guessable or
 * requiring the schema to allow a null hash that every login path would then
 * have to check.
 */
export async function createInvitedUser(input: {
  email: string;
  fullName: string;
  role: UserRole;
  createdBy: string | null;
}): Promise<CreatedUser> {
  const email = input.email.trim().toLowerCase();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new HttpError(409, `An account already exists for ${email}.`);
  }

  const unusable = await hashPassword(randomBytes(32).toString("hex"));

  const user = await User.create({
    _id: randomUUID(),
    email,
    fullName: input.fullName,
    role: input.role,
    passwordHash: unusable,
  });

  const { token, expiresAt } = await issuePasswordSetToken(user.id as string, "invite", input.createdBy);

  return { user, token, expiresAt };
}

export interface RedeemedToken {
  userId: string;
  email: string;
  purpose: "invite" | "reset";
}

/**
 * Validates a token without consuming it, so the set-password page can decide
 * whether to render a form or an "expired link" message before the user types
 * anything.
 */
export async function inspectPasswordSetToken(token: string): Promise<RedeemedToken> {
  const record = await PasswordSetToken.findById(hashToken(token)).lean();

  // One message for every failure mode. Distinguishing "no such token" from
  // "already used" from "expired" tells an attacker which guesses were close.
  const invalid = new HttpError(400, "This link is invalid or has expired. Ask an admin for a new one.");

  if (!record) throw invalid;
  if (record.usedAt !== null) throw invalid;
  if (record.expiresAt.getTime() <= Date.now()) throw invalid;

  const user = await User.findById(record.userId).select("email").lean();
  if (!user) throw invalid;

  return { userId: record.userId, email: user.email, purpose: record.purpose as "invite" | "reset" };
}

/**
 * Redeems a token and sets the password.
 *
 * The token is marked used in the same step, guarded on `usedAt: null`, so two
 * concurrent submissions cannot both succeed.
 */
export async function redeemPasswordSetToken(token: string, password: string): Promise<RedeemedToken> {
  const details = await inspectPasswordSetToken(token);

  const claimed = await PasswordSetToken.findOneAndUpdate(
    { _id: hashToken(token), usedAt: null },
    { $set: { usedAt: new Date() } },
  ).lean();

  if (!claimed) {
    throw new HttpError(400, "This link is invalid or has expired. Ask an admin for a new one.");
  }

  await User.updateOne(
    { _id: details.userId },
    {
      $set: {
        passwordHash: await hashPassword(password),
        // Setting a password clears a lockout: the credential that was being
        // guessed no longer exists.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    },
  );

  return details;
}
