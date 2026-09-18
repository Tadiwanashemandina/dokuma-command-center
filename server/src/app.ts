import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { projectsRouter } from "./routes/projects.js";
import { deliveryRouter } from "./routes/delivery.js";
import { meetingsRouter } from "./routes/meetings.js";
import { risksRouter } from "./routes/risks.js";
import { clientsRouter } from "./routes/clients.js";
import { peopleRouter } from "./routes/people.js";
import { kpiFeedRouter } from "./routes/kpi-feed.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { requireCsrfToken } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

/**
 * Builds the Express app. Kept separate from index.ts so tests can mount it
 * without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Behind one proxy hop in production, so req.ip reflects x-forwarded-for.
  // Rate limiting (inventory §4.6) keys on it, so this must be set before any
  // request is served or every caller looks like the proxy.
  app.set("trust proxy", 1);

  app.use(helmet());

  /**
   * Credentialed CORS.
   *
   * In production on Vercel the client and the API share one origin, so no
   * cross-origin grant is needed at all — a same-origin request carries no
   * `Origin` header the browser will check. The allowlist exists for two
   * cases that are genuinely cross-origin:
   *
   *   - the Vite dev server on :5173, talking to Express on :4000;
   *   - Vercel preview deployments, which each get their own hostname.
   *
   * A function rather than a string because the preview hostname is not known
   * ahead of time. It matches `*.vercel.app` by suffix, and only that suffix —
   * a substring check would accept `evil-vercel.app.attacker.com`.
   */
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: same-origin, or a non-browser client. Nothing for
        // CORS to decide.
        if (!origin) return callback(null, true);

        if (origin === env.CLIENT_ORIGIN) return callback(null, true);

        try {
          const { hostname, protocol } = new URL(origin);
          if (protocol === "https:" && hostname.endsWith(".vercel.app")) {
            return callback(null, true);
          }
        } catch {
          // A malformed Origin is not a valid grant.
        }

        return callback(null, false);
      },
      credentials: true,
      // The client echoes the CSRF cookie back in this header; without it
      // listed, the browser's preflight rejects the request.
      allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser(env.SESSION_SECRET));

  // Applies to every mutating request that carries a session cookie. Mounted
  // before the routers so no route can forget it (see middleware/csrf.ts for
  // why login itself is not blocked by this).
  app.use(requireCsrfToken);

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);

  // Read-only domains (inventory §12 step 4). These are the routes that had no
  // `requireRole()` and relied on RLS; each router mounts `requireAnyRole`
  // explicitly per D-2.
  app.use("/api/projects", projectsRouter);
  app.use("/api/delivery-metrics", deliveryRouter);
  app.use("/api/meetings", meetingsRouter);

  // Department-scoped (§4.5): the scope filter comes from req.auth, resolved
  // once by requireAuth, so no handler recomputes the rule.
  app.use("/api/risks", risksRouter);
  app.use("/api/clients", clientsRouter);

  // admin/exec only — these had a real requireRole(), unlike the D-2 four.
  app.use("/api/people", peopleRouter);
  app.use("/api/dashboard", dashboardRouter);

  // User management (admin) and the audit trail (admin/exec/finance_manager).
  app.use("/api/admin", adminRouter);

  // The Group platform's polling contract, frozen per D-13.
  app.use("/api/kpi-feed", kpiFeedRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
