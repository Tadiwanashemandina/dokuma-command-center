// Pure constants/types only — no `xlsx`, no zod schemas. This is the only
// part of the Excel-import machinery safe (and small) enough to import from
// a client component (the import wizard's UI needs these for its column-
// mapping dropdowns). Actual parsing/validation stays server-only in
// import.ts, so the vulnerable `xlsx` package (see README security notes)
// never ships to the browser.

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv"];

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
