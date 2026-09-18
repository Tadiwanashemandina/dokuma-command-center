import * as XLSX from "xlsx";
import { z } from "zod";
import { createTransactionSchema, type CreateTransactionInput } from "@dokuma/shared";
import { withTransaction } from "../../db/connection.js";
import { FinanceAccount } from "../../db/models/index.js";
import { HttpError } from "../../middleware/http-error.js";
import { recomputeAccountBalance } from "./balances.js";
import { createTransaction } from "./transactions.js";

/**
 * Excel / CSV transaction import.
 *
 * Ported from `lib/finance/import.ts` and `import-commit.ts`. Three properties
 * of the original are preserved deliberately, and each is load-bearing:
 *
 * 1. **All-or-nothing.** Any invalid row aborts the entire import (§9). A
 *    partial import of a bank statement is worse than no import: the operator
 *    cannot tell which rows landed without reading the whole ledger, and
 *    re-running it duplicates whatever succeeded. Here that guarantee is
 *    upgraded from "validate everything first, then insert" to a real database
 *    transaction, so a failure *during* insertion also rolls back.
 *
 * 2. **The `xlsx` mitigations.** The package carries two unpatched advisories
 *    (prototype pollution, ReDoS) that the inventory (§11) says must keep
 *    their mitigations verbatim. All three are here:
 *      - parsing is server-only — this module is never imported by client/;
 *      - a hard 5MB cap, checked before `XLSX.read` touches the buffer;
 *      - cell VALUES only: no formula evaluation, no macros.
 *    The prototype-pollution guard is additionally made explicit below, since
 *    "read values only" does not by itself stop a malicious `__proto__`
 *    header.
 *
 * 3. **The client's preview is never trusted.** The commit step re-parses and
 *    re-validates the uploaded file from scratch. A preview is a display
 *    convenience; treating it as the source of truth would let a caller post
 *    arbitrary rows that were never in any file.
 */

// ---------------------------------------------------------------------------
// Limits and column mapping
// ---------------------------------------------------------------------------

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

export const REQUIRED_MAP_FIELDS = ["date", "type", "amount"] as const;

export const ALL_MAP_FIELDS = [
  "date",
  "type",
  "amount",
  "category",
  "counterparty",
  "description",
  "reference_no",
  "is_dlap",
  "dlap_share_pct",
] as const;

export type MapField = (typeof ALL_MAP_FIELDS)[number];
export type ColumnMapping = Partial<Record<MapField, string>>;

/**
 * A cap on rows per import.
 *
 * Not in the original, which was bounded only by the 5MB file cap — but a 5MB
 * CSV is comfortably 50,000 rows, and each one becomes an insert plus a
 * balance recompute inside a single transaction. Mongo's 16MB oplog entry
 * limit makes that fail late and confusingly; failing early with a clear
 * message is better than a transaction that aborts after two minutes.
 */
export const MAX_IMPORT_ROWS = 5000;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedWorkbook {
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * Keys that must never be copied out of a parsed row.
 *
 * `sheet_to_json` builds plain objects from header cells, so a spreadsheet
 * whose header row contains `__proto__` produces an object that pollutes
 * `Object.prototype` the moment it is spread or assigned. This is the concrete
 * shape of the advisory the README notes, and dropping the keys is the
 * mitigation.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  // A null-prototype object cannot be used to reach Object.prototype even if
  // a forbidden key slipped through.
  const clean: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Parses an uploaded spreadsheet. Server-side only.
 *
 * `raw: false` returns formatted cell values rather than raw ones, which is
 * what keeps dates readable and, crucially, means no formula is ever
 * evaluated — the value that was last saved is the value that is read.
 */
export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new HttpError(
      400,
      `File exceeds the ${MAX_IMPORT_FILE_BYTES / 1024 / 1024}MB limit.`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: false });
  } catch (error) {
    throw new HttpError(
      400,
      `The file could not be read as a spreadsheet: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new HttpError(400, "The workbook has no sheets.");

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new HttpError(400, "The workbook's first sheet is empty.");

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    dateNF: "yyyy-mm-dd",
  });

  if (rawRows.length === 0) {
    throw new HttpError(400, "No data rows found in the first sheet.");
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      400,
      `The file has ${rawRows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it and import in parts.`,
    );
  }

  const rows = rawRows.map(sanitizeRow);
  const headers = Object.keys(rows[0] ?? {});

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Row coercion
// ---------------------------------------------------------------------------

/** Spreadsheet cell → `YYYY-MM-DD`, or null if it is not a date at all. */
function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (text === "") return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  /**
   * Deliberately NOT falling back to `new Date(text)` for other shapes.
   *
   * The original did, and it silently resolves `03/04/2025` using the host's
   * locale — which is March 4th in the US and April 3rd almost everywhere
   * else. On a bank statement that is a transaction booked into the wrong
   * month, and nothing downstream can detect it. An ambiguous date is now a
   * validation error the operator must resolve in the file, which is the only
   * place the intent is actually known.
   */
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) return null;

  return null;
}

/** Spreadsheet cell → exact decimal string, without a float round-trip. */
function toAmountString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  // Strip thousands separators and currency symbols, which spreadsheets add
  // as formatting and `raw: false` therefore returns.
  const text = String(value).trim().replace(/[,\s]/g, "").replace(/^[^\d.-]+/, "");
  if (text === "") return null;

  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return text.startsWith("-") ? `-${normalized}` : normalized;
}

function toTransactionType(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (text === "debit" || text === "dr" || text === "out") return "debit";
  if (text === "credit" || text === "cr" || text === "in") return "credit";
  return null;
}

function toBoolean(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "1";
}

function toOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ImportRowResult =
  | { row: number; ok: true; data: CreateTransactionInput }
  | { row: number; ok: false; errors: string[] };

export interface ValidationSummary {
  results: ImportRowResult[];
  validCount: number;
  invalidCount: number;
}

/**
 * Maps raw rows through the column mapping and validates each one.
 *
 * Every row is validated even after the first failure, so the operator sees
 * the full list of problems in one pass rather than fixing them one at a time
 * across repeated uploads.
 *
 * Row numbers are 1-based and count the header, matching what the spreadsheet
 * application shows in its row gutter — an error saying "row 2" should point
 * at the row the operator sees as row 2.
 */
export function mapAndValidateRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  accountId: string,
): ValidationSummary {
  const missing = REQUIRED_MAP_FIELDS.filter((field) => !mapping[field]);
  if (missing.length > 0) {
    throw new HttpError(400, `Unmapped required column(s): ${missing.join(", ")}.`);
  }

  const results: ImportRowResult[] = rows.map((raw, index) => {
    const rowNumber = index + 2;
    const pick = (field: MapField): unknown => {
      const column = mapping[field];
      return column === undefined ? null : raw[column];
    };

    const date = toIsoDate(pick("date"));
    const type = toTransactionType(pick("type"));
    const amount = toAmountString(pick("amount"));
    const dlapPct = toAmountString(pick("dlap_share_pct"));

    const errors: string[] = [];
    if (date === null) {
      errors.push(
        "date is missing or ambiguous — use YYYY-MM-DD (DD/MM/YYYY is rejected because it cannot be told from MM/DD/YYYY)",
      );
    }
    if (type === null) errors.push("type must be debit or credit");
    if (amount === null) errors.push("amount is not a number");

    if (errors.length > 0) return { row: rowNumber, ok: false, errors };

    const isDlap = toBoolean(pick("is_dlap"));

    const candidate = {
      account_id: accountId,
      date,
      type,
      amount,
      category: toOptionalText(pick("category")),
      counterparty: toOptionalText(pick("counterparty")),
      description: toOptionalText(pick("description")),
      reference_no: toOptionalText(pick("reference_no")),
      is_dlap: isDlap,
      dlap_share_pct: isDlap ? dlapPct : null,
    };

    // The same schema the manual create endpoint uses. One validation rule,
    // not two that drift.
    const parsed = createTransactionSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        row: rowNumber,
        ok: false,
        errors: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "row"}: ${issue.message}`,
        ),
      };
    }

    return { row: rowNumber, ok: true, data: parsed.data };
  });

  return {
    results,
    validCount: results.filter((r) => r.ok).length,
    invalidCount: results.filter((r) => !r.ok).length,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface CommitResult {
  inserted: number;
  accountId: string;
  currentBalance: string;
}

/**
 * Inserts every row, or none.
 *
 * The all-or-nothing guarantee (§9) is enforced twice over: validation runs to
 * completion first and refuses the batch if ANY row is invalid, and the
 * inserts then run inside one database transaction so a failure partway
 * through — a duplicate key, a write conflict, a process death — rolls the
 * whole thing back. The original could only offer the first half.
 *
 * The balance is recomputed ONCE at the end rather than per row.
 * `recomputeAccountBalance` replays the account's entire history, so calling
 * it per row makes a 5,000-row import quadratic. Correctness is unaffected
 * because the whole batch is one transaction: no reader can observe the
 * intermediate states, which is precisely the guarantee that makes skipping
 * the intermediate recomputes safe.
 */
export async function commitImport(
  validated: ImportRowResult[],
  accountId: string,
  createdBy: string,
): Promise<CommitResult> {
  const invalid = validated.filter((r) => !r.ok);
  if (invalid.length > 0) {
    throw new HttpError(
      400,
      `The import was rejected: ${invalid.length} invalid row(s). Nothing was written.`,
    );
  }

  const rows = validated.filter((r): r is Extract<ImportRowResult, { ok: true }> => r.ok);
  if (rows.length === 0) {
    throw new HttpError(400, "There are no rows to import.");
  }

  const account = await FinanceAccount.findById(accountId).select("_id isActive").lean();
  if (!account) throw new HttpError(400, `Finance account not found: ${accountId}`);
  if (!account.isActive) {
    throw new HttpError(400, "Cannot import into an inactive account.");
  }

  return withTransaction("commitImport", async (session) => {
    for (const row of rows) {
      await createTransaction(row.data, createdBy, {
        source: "excel-import",
        session,
        // Recomputed once below instead of per row — see the note above.
        skipBalanceRecompute: true,
      });
    }

    const currentBalance = await recomputeAccountBalance(accountId, session);
    return { inserted: rows.length, accountId, currentBalance };
  });
}
