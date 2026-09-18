/**
 * Seeds one user per role, so the cross-role authorization tests (§4.3, D-5)
 * have accounts to run against and a fresh clone has something to log into.
 *
 * Idempotent: an existing email is updated in place rather than duplicated, so
 * re-running never fails on the unique index.
 *
 *   npm run seed:users --workspace @dokuma/server
 *
 * Passwords come from SEED_PASSWORD (default below). This script refuses to
 * run in production — seeded accounts with known credentials are exactly the
 * thing that should never exist there.
 */

import { USER_ROLES, type UserRole } from "@dokuma/shared";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { User } from "../db/models/index.js";
import { hashPassword } from "../services/password.js";
import { env, isProduction } from "../config/env.js";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "DokumaTest123!";

/** Readable names so a seeded dashboard does not read as placeholder soup. */
const SEED_NAMES: Record<UserRole, string> = {
  admin: "Ada Admin",
  exec: "Evan Exec",
  viewer: "Vera Viewer",
  finance_officer: "Faith Officer",
  finance_manager: "Frank Manager",
  employee: "Elena Employee",
  supervisor: "Sam Supervisor",
  hr_officer: "Hana Officer",
  hr_manager: "Hugo Manager",
};

async function main(): Promise<void> {
  if (isProduction) {
    throw new Error("seed-users refuses to run with NODE_ENV=production.");
  }

  await connectToDatabase();
  console.log(`[seed] connected to ${env.MONGODB_DATABASE}`);

  // Hashed once rather than per user: Argon2 is deliberately slow, and nine
  // sequential hashes at 19MiB each is a noticeable wait for no benefit when
  // the password is identical anyway.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const role of USER_ROLES) {
    const email = `${role}@dokuma.local`;

    // `updateOne` reports upsertedCount directly; a findOneAndUpdate document
    // cannot tell us whether it was just created.
    const result = await User.updateOne(
      { email },
      {
        // The password is only set on insert, so re-running the seed never
        // resets a password someone has deliberately changed.
        $set: { fullName: SEED_NAMES[role], role },
        $setOnInsert: { email, passwordHash },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    console.log(
      `[seed] ${result.upsertedCount > 0 ? "created" : "updated"} ${email} (${role})`,
    );
  }

  console.log(`\n[seed] ${USER_ROLES.length} users ready. Password: ${SEED_PASSWORD}`);
  console.log("[seed] Finance/HR roles will be prompted to enroll in MFA at first login.");

  await disconnectFromDatabase();
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});
