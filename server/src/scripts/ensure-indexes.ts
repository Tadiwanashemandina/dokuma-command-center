import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { ensureIndexes } from "../db/models/index.js";

/**
 * Builds every index declared on every model.
 *
 * Mongoose's `autoIndex` does this implicitly in development, but it is
 * disabled in production because it races with the first queries and swallows
 * failures. Running it explicitly makes index creation a verifiable deployment
 * step — which matters most for the unique indexes, since a unique constraint
 * is not enforced at all until its index exists.
 *
 * Idempotent: creating an index that already exists is a no-op.
 *
 *   npm run db:indexes --workspace @dokuma/server
 */
async function main(): Promise<void> {
  await connectToDatabase();
  console.log(`[indexes] connected to "${mongoose.connection.name}"`);

  const results = await ensureIndexes();

  for (const { model, indexes } of results) {
    console.log(`[indexes] ${model.padEnd(24)} ${indexes} index(es)`);
  }

  const total = results.reduce((sum, r) => sum + r.indexes, 0);
  console.log(`[indexes] done: ${results.length} models, ${total} indexes.`);

  await disconnectFromDatabase();
}

main().catch((error: unknown) => {
  console.error("[indexes] failed:", error);
  process.exitCode = 1;
  void disconnectFromDatabase();
});
