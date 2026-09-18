import mongoose from "mongoose";
import { connectToDatabase } from "./connection.js";

/**
 * Connection reuse for serverless invocations.
 *
 * A serverless function is frozen between requests rather than torn down, so
 * module-level state survives into the next invocation on the same instance.
 * That is what makes a warm start fast — but it also means a naive
 * `await connectToDatabase()` per request opens a new pool every time, and
 * Atlas caps concurrent connections (500 on the free tier). Enough concurrent
 * cold starts and the cluster starts refusing connections.
 *
 * Two things fix that:
 *
 *   1. Cache the connection PROMISE on the module, not just the connection.
 *      Caching the resolved value still lets several requests arriving during
 *      a single cold start each begin their own connect; caching the promise
 *      means they all await the same one.
 *
 *   2. Keep the pool small. A serverless instance handles one request at a
 *      time, so a large pool is wasted sockets multiplied by instance count.
 *
 * Node's global is used deliberately: a bundler may load this module more than
 * once in a single process, and a module-scoped variable would then cache per
 * copy rather than per process.
 */

declare global {
  // eslint-disable-next-line no-var
  var __dokumaMongo: Promise<typeof mongoose> | undefined;
}

export function connectForServerless(): Promise<typeof mongoose> {
  // readyState 1 = connected, 2 = connecting. Anything else means the cached
  // promise (if any) is stale — a previous instance's socket that the platform
  // has since closed — so it is discarded rather than awaited forever.
  if (globalThis.__dokumaMongo && mongoose.connection.readyState >= 1) {
    return globalThis.__dokumaMongo;
  }

  const connecting = connectToDatabase(process.env["MONGODB_URI"], {
    // One request at a time per instance, so the pool never needs to be large.
    maxPoolSize: 5,
    minPoolSize: 0,
    // Close idle sockets rather than holding them across a long freeze.
    maxIdleTimeMS: 30_000,
    // Fail fast: a hung connect burns the whole function timeout and returns
    // nothing useful, where a quick failure at least produces a 500 the client
    // can retry.
    serverSelectionTimeoutMS: 8_000,
  }).catch((error: unknown) => {
    // Never leave a rejected promise cached — the next invocation would reuse
    // the failure instead of retrying.
    globalThis.__dokumaMongo = undefined;
    throw error;
  });

  globalThis.__dokumaMongo = connecting;
  return connecting;
}
