import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { FINANCE_WRITE, booleanFlag } from "@dokuma/shared";
import { requireRole, requireAuthContext } from "../middleware/auth.js";
import { HttpError } from "../middleware/http-error.js";
import { audit } from "../services/audit.js";
import { handle, ok } from "./helpers.js";
import {
  parseWorkbook,
  mapAndValidateRows,
  commitImport,
  MAX_IMPORT_FILE_BYTES,
  ALLOWED_IMPORT_EXTENSIONS,
  ALL_MAP_FIELDS,
  REQUIRED_MAP_FIELDS,
  type ColumnMapping,
} from "../services/finance/import.js";

/**
 * The Excel/CSV import wizard's two endpoints (inventory §2.4, route 21).
 *
 * Split from `finance.ts` because this is the only router that accepts
 * multipart bodies, and mounting multer on the whole finance router would make
 * every endpoint parse uploads it will never receive.
 *
 * The wizard is upload → preview → column-map → commit, and the commit step
 * re-uploads the file rather than referring back to the preview. That is
 * deliberate and matches the legacy behavior: the server keeps no state
 * between the two calls, so there is no temporary file to clean up, no
 * expiring handle, and — most importantly — no way for a caller to commit rows
 * that were never in a file. The preview is display only.
 */

export const financeImportRouter = Router();

const canWrite = requireRole(FINANCE_WRITE);

/**
 * In-memory upload, hard-capped.
 *
 * Memory rather than disk because the file is parsed once and discarded, and
 * a temp file would need cleanup on every error path. The 5MB cap is the
 * documented mitigation for `xlsx`'s unpatched ReDoS advisory (§11) and is
 * enforced HERE as well as in `parseWorkbook` — multer rejects the stream
 * before the whole body is buffered, which is the point of having it at this
 * layer rather than only after.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    const name = file.originalname.toLowerCase();
    const allowed = ALLOWED_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext));

    if (!allowed) {
      // An extension allowlist, matching the legacy `previewImportAction`.
      // Not a content-type check: browsers report spreadsheet MIME types
      // inconsistently, and a wrong one would reject a valid file.
      callback(new HttpError(400, `Only ${ALLOWED_IMPORT_EXTENSIONS.join(", ")} files are accepted.`));
      return;
    }

    callback(null, true);
  },
});

/** Multer puts the file on `req.file`; Express's types do not know that. */
interface UploadedRequest {
  file?: { buffer: Buffer; originalname: string; size: number };
}

function requireUpload(req: unknown): { buffer: Buffer; originalname: string; size: number } {
  const file = (req as UploadedRequest).file;
  if (!file) throw new HttpError(400, "No file was uploaded.");
  return file;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Parses an uploaded file and returns its headers plus a sample of rows.
 *
 * Writes nothing. The sample is capped at 20 rows because its only job is to
 * let the operator confirm they picked the right file and map the columns —
 * returning 5,000 rows to render a preview table would be slow for no benefit.
 */
financeImportRouter.post(
  "/preview",
  ...canWrite,
  upload.single("file"),
  handle(async (req, res) => {
    const file = requireUpload(req);
    const { headers, rows } = parseWorkbook(file.buffer);

    ok(res, {
      filename: file.originalname,
      size_bytes: file.size,
      headers,
      row_count: rows.length,
      sample: rows.slice(0, 20),
      /**
       * The mapping vocabulary is returned rather than hard-coded in the
       * client, so adding a mappable field is a server change only and the two
       * lists cannot drift.
       */
      map_fields: ALL_MAP_FIELDS,
      required_map_fields: REQUIRED_MAP_FIELDS,
    });
  }),
);

// ---------------------------------------------------------------------------
// Validate & commit
// ---------------------------------------------------------------------------

const commitBodySchema = z.object({
  account_id: z.string().uuid(),
  /** `{ date: "Transaction Date", amount: "Value", ... }` */
  mapping: z.record(z.string(), z.string()),
  /**
   * When true, the rows are validated and the outcome returned WITHOUT
   * writing. The wizard calls this before committing so the operator sees
   * every problem at once — which is the only way the all-or-nothing rule is
   * workable in practice. Without it, they would upload, be rejected for one
   * bad row, fix it, and be rejected for the next.
   *
   * Parsed explicitly rather than with `z.coerce.boolean()`, which is
   * `Boolean(value)` and therefore maps the STRING `"false"` to `true` —
   * every non-empty string is truthy. A multipart field is always a string,
   * so the coercing version would force every real commit down the dry-run
   * branch: the wizard would report success and write nothing.
   */
  dry_run: booleanFlag.default(false),
});

financeImportRouter.post(
  "/commit",
  ...canWrite,
  upload.single("file"),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const file = requireUpload(req);

    /**
     * The body arrives as multipart text fields alongside the file, so
     * `mapping` is a JSON string rather than an object. Parsed defensively:
     * a malformed one is a 400, not a 500.
     */
    const rawMapping = (req.body as Record<string, unknown>)["mapping"];
    let mapping: unknown = rawMapping;
    if (typeof rawMapping === "string") {
      try {
        mapping = JSON.parse(rawMapping);
      } catch {
        throw new HttpError(400, "`mapping` is not valid JSON.");
      }
    }

    const body = commitBodySchema.parse({ ...(req.body as object), mapping });

    // Re-parsed from the uploaded bytes, never from a client-supplied preview.
    const { rows } = parseWorkbook(file.buffer);

    const summary = mapAndValidateRows(
      rows,
      body.mapping as ColumnMapping,
      body.account_id,
    );

    if (body.dry_run) {
      ok(res, {
        dry_run: true,
        valid_count: summary.validCount,
        invalid_count: summary.invalidCount,
        // Only the failures are returned in full — the valid rows are already
        // visible in the preview and would double the payload.
        errors: summary.results.filter((r) => !r.ok),
      });
      return;
    }

    /**
     * All-or-nothing (§9). Rejected before any write if a single row is
     * invalid — and `commitImport` additionally runs the inserts in one
     * database transaction, so a failure during insertion also rolls back.
     */
    if (summary.invalidCount > 0) {
      throw new HttpError(
        400,
        `The import was rejected: ${summary.invalidCount} of ${summary.results.length} rows are invalid. Nothing was written.`,
      );
    }

    const result = await commitImport(
      summary.results,
      body.account_id,
      auth.user.id as string,
    );

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_transactions_imported",
      entityType: "finance_transactions",
      entityId: body.account_id,
      metadata: {
        account_id: body.account_id,
        row_count: result.inserted,
        filename: file.originalname,
      },
    });

    ok(
      res,
      {
        dry_run: false,
        inserted: result.inserted,
        account_id: result.accountId,
        current_balance: result.currentBalance,
      },
      201,
    );
  }),
);
