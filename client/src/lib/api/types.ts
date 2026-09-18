/**
 * Shapes shared by every collection endpoint.
 */

/** A page of results, with the total so a client can render "1–50 of 214". */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
