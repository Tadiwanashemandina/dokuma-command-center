import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../server/src/app.js";
import { connectForServerless } from "../server/src/db/serverless.js";

/**
 * The Vercel serverless entry point for the whole API.
 *
 * One function handles every `/api/*` route rather than one function per
 * route. Express already owns the routing, and splitting it would mean each
 * path paying its own cold start and opening its own Atlas connection — the
 * opposite of what a connection-limited database wants.
 *
 * `createApp()` is called once per instance and reused across invocations, so
 * the middleware stack is built on a cold start and not on every request.
 */

const app = createApp();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Awaited per request, but resolves instantly on a warm instance — the
    // promise is cached, so concurrent requests during a cold start share one
    // connect rather than each opening their own.
    await connectForServerless();
  } catch (error) {
    // A database that cannot be reached is not the client's fault and not
    // something a retry of this request will fix quickly. Say so plainly
    // rather than letting Express surface a cast error from a buffered query.
    console.error("[api] database unavailable:", error);
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
    return;
  }

  // An Express app IS a (req, res) handler, so it can be invoked directly.
  return app(req as never, res as never);
}
