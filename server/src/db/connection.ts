import mongoose, { type ClientSession } from "mongoose";
import { env } from "../config/env.js";

/**
 * Mongo connection. Kept separate from app.ts so tests can connect to a
 * disposable database without starting an HTTP server.
 *
 * D-11 requires multi-document transactions for the two balance recomputes
 * that are DB-atomic today (the finance balance trigger and the leave-balance
 * trigger). Transactions need a replica set — a single-node replica set is
 * fine for development. `supportsTransactions()` reports whether the connected
 * deployment can actually provide them so the services can fail loudly rather
 * than silently degrade to non-atomic writes.
 */

let transactionsSupported: boolean | null = null;

export async function connectToDatabase(
  uri: string = env.MONGODB_URI,
  /** Extra driver options, used by the serverless entry point to size the pool. */
  overrides: mongoose.ConnectOptions = {},
): Promise<typeof mongoose> {
  // Reject filter paths that are not in the schema, rather than silently
  // ignoring them.
  mongoose.set("strictQuery", true);

  /**
   * `sanitizeFilter` is deliberately NOT enabled.
   *
   * It wraps every object-valued filter in `$eq`, so a legitimate
   * `find({ date: { $lte: x } })` becomes `find({ date: { $eq: { $lte: x } } })`
   * and fails to cast — it cannot tell an operator this code wrote from one
   * that arrived in a request body. Enabling it breaks every date-range query
   * in the application (reports, the expiring-training window, the
   * unusual-transaction baseline, the KPI due-this-week counts).
   *
   * The NoSQL-injection protection it was standing in for is provided instead
   * by the layer that can actually distinguish the two cases: every request
   * body, query string and route parameter is parsed by zod at the HTTP
   * boundary (inventory §8), so a string stays a string and an attacker-
   * supplied `{"$ne": null}` is rejected as a type error before it ever
   * reaches a query. Schema casting then rejects anything that slips past.
   *
   * If a filter is ever built directly from unvalidated input, the fix is to
   * validate that input — not to re-enable this flag.
   */
  mongoose.set("sanitizeFilter", false);

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DATABASE,
    // Fail fast instead of buffering operations forever when Mongo is down.
    serverSelectionTimeoutMS: 10_000,
    bufferCommands: false,
    ...overrides,
  });

  transactionsSupported = await detectTransactionSupport();

  return mongoose;
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
  transactionsSupported = null;
}

/** True once the connection is open and usable. */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * A standalone mongod reports no `setName` in its hello response. Replica sets
 * and sharded clusters do, and only those support multi-document transactions.
 */
async function detectTransactionSupport(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    return false;
  }
}

export function supportsTransactions(): boolean {
  if (transactionsSupported === null) {
    throw new Error("supportsTransactions() called before connectToDatabase().");
  }
  return transactionsSupported;
}

export class TransactionSupportError extends Error {
  constructor(operation: string) {
    super(
      `"${operation}" requires multi-document transactions, which need a replica set. ` +
        `Start mongod with --replSet (a single-node replica set is fine for development) ` +
        `and point MONGODB_URI at it. See server/README-DATA-MODEL.md § Transactions.`,
    );
    this.name = "TransactionSupportError";
  }
}

/**
 * Runs `work` inside a multi-document transaction.
 *
 * The two call sites that genuinely need this are the ones replacing Postgres
 * AFTER triggers (inventory §5.5): a finance transaction insert plus its
 * `current_balance` recompute, and a leave approval plus its `days_used`
 * increment. Those pairs are atomic in Postgres today, and a crash between the
 * two halves would leave a balance permanently wrong — so when the deployment
 * cannot offer a transaction this throws rather than silently degrading to two
 * independent writes.
 *
 * `allowWithoutTransaction` is for callers where atomicity is a convenience
 * rather than a correctness requirement: the seed script, which drops and
 * rebuilds the whole database and is re-runnable by construction.
 */
export async function withTransaction<T>(
  operation: string,
  work: (session: ClientSession | undefined) => Promise<T>,
  options: { allowWithoutTransaction?: boolean } = {},
): Promise<T> {
  if (!supportsTransactions()) {
    if (!options.allowWithoutTransaction) throw new TransactionSupportError(operation);
    return work(undefined);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => work(session));
  } finally {
    await session.endSession();
  }
}
