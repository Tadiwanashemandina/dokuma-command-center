import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiError } from "@dokuma/shared";
import { isProduction } from "../config/env.js";
import { HttpError, AuthError } from "./http-error.js";

// Re-exported so existing imports of `HttpError` from this module keep working.
export { HttpError, AuthError } from "./http-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: `No route for ${req.method} ${req.path}` };
  res.status(404).json(body);
};

/**
 * Centralized error handling (inventory §5). Validation failures become 400
 * with per-field detail; everything unrecognized becomes a 500 whose message
 * is withheld in production so internals do not leak to the browser.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ApiError = {
      error: "Validation failed",
      fields: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
    res.status(400).json(body);
    return;
  }

  // AuthError extends HttpError but carries the reason/next fields the client
  // routes on (sign-in vs MFA enroll vs MFA verify), so it is matched first.
  if (err instanceof AuthError) {
    res.status(err.status).json({
      error: err.message,
      reason: err.reason,
      ...(err.next ? { next: err.next } : {}),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message } satisfies ApiError);
    return;
  }

  console.error("Unhandled error:", err);
  const body: ApiError = {
    error: isProduction ? "Internal server error" : String((err as Error)?.message ?? err),
  };
  res.status(500).json(body);
};
