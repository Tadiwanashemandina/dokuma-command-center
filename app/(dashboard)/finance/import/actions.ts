"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import {
  parseWorkbook,
  mapAndValidateRows,
  ALL_MAP_FIELDS,
  ALLOWED_IMPORT_EXTENSIONS,
  type MapField,
  type ColumnMapping,
} from "@/lib/finance/import";
import { commitImport } from "@/lib/finance/import-commit";

export type PreviewResult =
  | { ok: true; headers: string[]; previewRows: Record<string, unknown>[]; totalRows: number }
  | { ok: false; error: string };

function assertAllowedFile(file: File) {
  const name = file.name.toLowerCase();
  if (!ALLOWED_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error(`Unsupported file type. Allowed: ${ALLOWED_IMPORT_EXTENSIONS.join(", ")}`);
  }
}

export async function previewImportAction(formData: FormData): Promise<PreviewResult> {
  await requireRole(["admin", "finance_officer", "finance_manager"]);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file was uploaded." };
  }

  try {
    assertAllowedFile(file);
    const buffer = await file.arrayBuffer();
    const { headers, rows } = parseWorkbook(buffer);
    return { ok: true, headers, previewRows: rows.slice(0, 20), totalRows: rows.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to parse file." };
  }
}

export type CommitResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string; rowErrors?: { row: number; errors: string[] }[] };

export async function commitImportAction(formData: FormData): Promise<CommitResult> {
  const profile = await requireRole(["admin", "finance_officer", "finance_manager"]);

  const file = formData.get("file");
  const accountId = formData.get("account_id");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file was uploaded." };
  if (typeof accountId !== "string" || !accountId) return { ok: false, error: "No target account selected." };

  const mapping: ColumnMapping = {};
  for (const field of ALL_MAP_FIELDS as readonly MapField[]) {
    const value = formData.get(`map_${field}`);
    if (typeof value === "string" && value) mapping[field] = value;
  }

  try {
    assertAllowedFile(file);
    const buffer = await file.arrayBuffer();
    const { rows } = parseWorkbook(buffer);
    const results = mapAndValidateRows(rows, mapping);

    const failures = results.filter((r) => !r.ok) as Extract<(typeof results)[number], { ok: false }>[];
    if (failures.length > 0) {
      return {
        ok: false,
        error: `${failures.length} of ${results.length} rows failed validation. Nothing was imported — fix the file and re-upload.`,
        rowErrors: failures.map((f) => ({ row: f.row, errors: f.errors })),
      };
    }

    const validRows = (results as Extract<(typeof results)[number], { ok: true }>[]).map((r) => r.data);
    await commitImport(accountId, validRows, profile.id, file.name);

    revalidatePath("/finance/transactions");
    revalidatePath("/finance");
    return { ok: true, inserted: validRows.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Import failed." };
  }
}
