import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { createInvitedUser, issuePasswordSetToken } from "../services/invite.js";
import { User, AuditLog } from "../db/models/index.js";
import { isUserRole, type UserRole } from "@dokuma/shared";
import { randomUUID } from "node:crypto";

/**
 * Creates an account and prints its one-time set-password link.
 *
 * The bootstrap path: the API's `POST /api/auth/invite` needs an admin to call
 * it, which is no help when there is no admin yet. This does the same thing
 * from the command line.
 *
 *   npm run invite --workspace @dokuma/server -- \
 *     --email person@dokuma.co.zw --name "Their Name" --role admin
 *
 * If the account already exists, this reissues a link rather than failing —
 * which is also how you recover an admin who has lost their password.
 *
 * The link is printed, never emailed: the Resend domain is not DNS-verified
 * (ONBOARDING §5), so an email path would fail silently today.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = arg("email");
  const name = arg("name");
  const role = arg("role") ?? "admin";
  const baseUrl = arg("base-url") ?? "http://localhost:5173";

  if (!email || !name) {
    console.error(
      "Usage: npm run invite --workspace @dokuma/server -- " +
        '--email <email> --name "<full name>" [--role admin] [--base-url https://…]',
    );
    process.exitCode = 1;
    return;
  }

  if (!isUserRole(role)) {
    console.error(`"${role}" is not a valid role.`);
    process.exitCode = 1;
    return;
  }

  await connectToDatabase();

  try {
    const existing = await User.findOne({ email: email.trim().toLowerCase() }).lean();

    let userId: string;
    let token: string;
    let expiresAt: Date;
    let created: boolean;

    if (existing) {
      // Reissue rather than refuse — this is the account-recovery path too.
      created = false;
      userId = existing._id;
      ({ token, expiresAt } = await issuePasswordSetToken(userId, "reset", null));
      console.log(`\nAccount already exists for ${email} (role: ${existing.role}).`);
      console.log("Issued a new set-password link; any previous link is now void.");
    } else {
      created = true;
      const result = await createInvitedUser({
        email,
        fullName: name,
        role: role as UserRole,
        createdBy: null,
      });
      userId = result.user.id as string;
      token = result.token;
      expiresAt = result.expiresAt;
      console.log(`\nCreated ${email} with role "${role}".`);
    }

    // Audited like any other privileged change, with a null actor because
    // this path has no signed-in user behind it.
    await AuditLog.create({
      _id: randomUUID(),
      actorId: null,
      actorRole: null,
      action: created ? "auth.user.invited" : "auth.password.reset_issued",
      entityType: "users",
      entityId: userId,
      metadata: { email, role, issuedVia: "cli" },
    });

    const link = `${baseUrl.replace(/\/$/, "")}/set-password?token=${encodeURIComponent(token)}`;

    console.log("\nSend them this link:\n");
    console.log(`  ${link}\n`);
    console.log(`It expires ${expiresAt.toISOString()} and can be used once.`);
    console.log("Anyone holding it can set this account's password — treat it like a password.\n");
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((error: unknown) => {
  console.error("invite failed:", error);
  process.exitCode = 1;
  void disconnectFromDatabase();
});
