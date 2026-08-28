import * as XLSX from "xlsx";
import { z } from "zod";
import { MAX_IMPORT_FILE_BYTES, REQUIRED_MAP_FIELDS, type ColumnMapping } from "./import-shared";

export { MAX_IMPORT_FILE_BYTES, ALLOWED_IMPORT_EXTENSIONS, REQUIRED_MAP_FIELDS, ALL_MAP_FIELDS } from "./import-shared";
export type { MapField, ColumnMapping } from "./import-shared";

export type ParsedWorkbook = { headers: string[]; rows: Record<string, unknown>[] };

/**
 * Parses an uploaded spreadsheet server-side only — never trust a client's
 * parsed preview as the source of truth for the actual commit step. Reads
 * cell VALUES only (no formula evaluation, no macro execution) which is the
 * main practical mitigation against xlsx's known prototype-pollution/ReDoS
 * advisories (see README security notes) beyond the file-size cap below.
 */
export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_IMPORT_FILE_BYTES / 1024 / 1024}MB limit.`);
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
  if (rows.length === 0) throw new Error("No data rows found in the first sheet.");

  const headers = Object.keys(rows[0]);
  return { headers, rows };
}

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

const importedRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid or missing date"),
  type: z.enum(["debit", "credit"], { error: "type must be 'debit' or 'credit'" }),
  amount: z.coerce.number().positive("amount must be a positive number"),
  category: z.string().trim().max(200).nullable().optional(),
  counterparty: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  reference_no: z.string().trim().max(200).nullable().optional(),
  is_dlap: z.boolean().optional().default(false),
  dlap_share_pct: z.coerce.number().min(0).max(100).nullable().optional(),
});

export type ImportedRow = z.infer<typeof importedRowSchema>;
export type ImportRowResult = { row: number; ok: true; data: ImportedRow } | { row: number; ok: false; errors: string[] };

/** Maps raw spreadsheet rows through the user-chosen column mapping, then
 * validates every row with zod. Never drops a bad row silently — every row
 * gets a result, good or bad, so the caller can show a complete error list. */
export function mapAndValidateRows(rows: Record<string, unknown>[], mapping: ColumnMapping): ImportRowResult[] {
  for (const field of REQUIRED_MAP_FIELDS) {
    if (!mapping[field]) {
      throw new Error(`Required field "${field}" is not mapped to a column.`);
    }
  }

  return rows.map((row, index) => {
    const rawIsDlap = mapping.is_dlap ? row[mapping.is_dlap] : null;
    const candidate = {
      date: toIsoDate(mapping.date ? row[mapping.date] : null),
      type: mapping.type ? String(row[mapping.type]).trim().toLowerCase() : null,
      amount: mapping.amount ? row[mapping.amount] : null,
      category: mapping.category ? row[mapping.category] : null,
      counterparty: mapping.counterparty ? row[mapping.counterparty] : null,
      description: mapping.description ? row[mapping.description] : null,
      reference_no: mapping.reference_no ? row[mapping.reference_no] : null,
      is_dlap: rawIsDlap == null ? false : ["true", "yes", "1", "y"].includes(String(rawIsDlap).trim().toLowerCase()),
      dlap_share_pct: mapping.dlap_share_pct ? row[mapping.dlap_share_pct] : null,
    };

    const result = importedRowSchema.safeParse(candidate);
    if (!result.success) {
      return { row: index + 2, ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    }
    return { row: index + 2, ok: true, data: result.data };
  });
}
