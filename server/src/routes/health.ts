import { Router } from "express";
import type { HealthResponse } from "@dokuma/shared";

export const healthRouter: Router = Router();

/**
 * GET /api/health — liveness probe. Deliberately unauthenticated and
 * free of any database call, so it answers even when Mongo is down.
 */
healthRouter.get("/", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});
