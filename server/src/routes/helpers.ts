import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/**
 * Shared plumbing for the domain routers.
 */

/** Wraps an async handler so a rejection reaches the error middleware. */
export function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** Every success response is `{ data }` — see shared/src/api.ts. */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

/**
 * Pagination for collection endpoints (Prompt 5: "bounded limits").
 *
 * The cap matters beyond tidiness: without it, `?limit=100000` on
 * `finance_transactions` is a trivial way to exhaust server memory, and the
 * legacy pages never asked for more than 100 rows anyway.
 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Parses and validates `?limit=&offset=`.
 *
 * Throws a `ZodError`, which the error middleware renders as a 400 with
 * per-field detail — the same treatment a bad body gets.
 */
export function pagination(req: Request): Pagination {
  return paginationSchema.parse(req.query);
}

/**
 * A UUID route parameter.
 *
 * All ids are UUID strings (D-8), and validating the shape here means a
 * malformed id is a 400 rather than a cast error surfacing as a 500 — and
 * that no unvalidated string reaches a query.
 */
export const uuidParamSchema = z.string().uuid("Expected a UUID");

export function uuidParam(req: Request, name = "id"): string {
  return uuidParamSchema.parse(req.params[name]);
}

/**
 * Wraps a page of results with the total, so a client can render "showing
 * 1–50 of 214" without a second request.
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function page<T>(items: T[], total: number, { limit, offset }: Pagination): Page<T> {
  return { items, total, limit, offset };
}
