import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { kpiFeedRateLimit, clientIp } from "../services/rate-limit.js";
import { getKpiFeed } from "../services/kpi.js";
import { handle } from "./helpers.js";

/**
 * GET /api/kpi-feed — the Group platform's polling contract.
 *
 * FROZEN DELIBERATELY (inventory §10, D-13). README and ONBOARDING both flag
 * that neither the transport (table vs. endpoint) nor the auth model (session
 * vs. scoped API key) has been agreed with the Group team. A migration is the
 * wrong moment to resolve an open cross-team question, so every observable
 * property is preserved exactly:
 *
 *   - same path: /api/kpi-feed
 *   - same auth: session-authenticated
 *   - same rate limit: 30 requests / 60s, keyed by client IP
 *   - same body: `{ data: [...] }` with snake_case rows, ordered by metric
 *
 * Note this is the ONE endpoint that does not use the `ok()` helper. Its
 * envelope predates the internal `{ data }` convention and happens to match
 * it; writing it out here keeps the coupling visible, so a future change to
 * the internal convention cannot silently alter an external contract.
 */

export const kpiFeedRouter = Router();

kpiFeedRouter.get(
  "/",
  requireAuth,
  handle(async (req, res) => {
    const { success, retryAfterSeconds } = await kpiFeedRateLimit.limit(`kpi-feed:${clientIp(req)}`);

    if (!success) {
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests." });
      return;
    }

    const data = await getKpiFeed();
    res.status(200).json({ data });
  }),
);
