import type {
  AccountSummary,
  CashPositionCurrency,
  CreditorSummary,
  CreditorStatus,
  DailySnapshot,
  PaymentNoticeStatus,
  PeriodReportData,
  ReportStatus,
  ReportType,
  TransactionSummary,
} from "@dokuma/shared";
import { api } from "@/lib/api-client";

/**
 * Typed client for /api/finance.
 *
 * One rule runs through this whole file: **money is a string and stays a
 * string**. Every amount arrives as an exact decimal (`"1250.50"`) and is
 * passed to a formatter for display, never through `Number()` for arithmetic.
 * Summing balances in the browser would reintroduce precisely the float64
 * error that Decimal128 storage and the string wire format exist to prevent —
 * and the server already provides every total this UI needs.
 *
 * If a component finds itself wanting to add two amounts, the total belongs on
 * the server.
 */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Accounts & cash position
// ---------------------------------------------------------------------------

export function listAccounts(includeInactive = false): Promise<AccountSummary[]> {
  return api.get<AccountSummary[]>(
    `/finance/accounts${includeInactive ? "?include_inactive=true" : ""}`,
  );
}

export function createAccount(input: {
  name: string;
  type: "bank" | "cash" | "mobile-money";
  currency: string;
  opening_balance: string;
}): Promise<{ id: string }> {
  return api.post<{ id: string }>("/finance/accounts", input);
}

export function getCashPosition(): Promise<CashPositionCurrency[]> {
  return api.get<CashPositionCurrency[]>("/finance/cash-position");
}

// ---------------------------------------------------------------------------
// Company totals & project finance
// ---------------------------------------------------------------------------

export interface CompanyTotals {
  as_of_date: string | null;
  revenue_pipeline_usd: string | null;
  contracted_revenue_usd: string | null;
  outstanding_receivables_usd: string | null;
}

/** Null when no snapshot exists yet — distinct from three zeros. */
export function getCompanyTotals(): Promise<CompanyTotals | null> {
  return api.get<CompanyTotals | null>("/finance/company-totals");
}

export interface ProjectFinanceRow {
  id: string;
  project_id: string;
  project_name: string | null;
  project_status: string | null;
  budget_usd: string | null;
  cost_to_date_usd: string | null;
  revenue_pipeline_usd: string | null;
  contracted_revenue_usd: string | null;
  receivables_usd: string | null;
  as_of_date: string | null;
  /**
   * null means "no budget set", NOT "zero margin". Render it as an em dash,
   * never as 0% — a red zero against an unbudgeted project is a false alarm.
   */
  margin_pct: number | null;
}

export function listProjectFinance(): Promise<ProjectFinanceRow[]> {
  return api.get<ProjectFinanceRow[]>("/finance/project-finance");
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  account_id?: string;
  from?: string;
  to?: string;
  type?: "debit" | "credit";
  is_dlap?: boolean;
  limit?: number;
  offset?: number;
}

export function listTransactions(
  filters: TransactionFilters = {},
): Promise<Page<TransactionSummary>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<Page<TransactionSummary>>(`/finance/transactions${query ? `?${query}` : ""}`);
}

export interface CreateTransactionBody {
  account_id: string;
  date: string;
  type: "debit" | "credit";
  /** An exact decimal string. Never a number. */
  amount: string;
  category?: string | null;
  counterparty?: string | null;
  description?: string | null;
  reference_no?: string | null;
  is_dlap?: boolean;
  dlap_share_pct?: string | null;
}

export function createTransaction(
  body: CreateTransactionBody,
): Promise<{ id: string; current_balance: string }> {
  return api.post<{ id: string; current_balance: string }>("/finance/transactions", body);
}

/**
 * Reverses a transaction. The reason is mandatory — it is the only record of
 * why the original was wrong, and it lands in the reversal's description.
 */
export function reverseTransaction(
  id: string,
  reason: string,
): Promise<{ id: string; original_id: string; current_balance: string }> {
  return api.post<{ id: string; original_id: string; current_balance: string }>(
    `/finance/transactions/${id}/reverse`,
    { reason },
  );
}

// ---------------------------------------------------------------------------
// Creditors
// ---------------------------------------------------------------------------

export interface CreditorRow extends CreditorSummary {
  /**
   * Non-null when this creditor came from a Xero bill. The status control must
   * be disabled for such a row — Xero owns it, and an edit here is reverted by
   * the next sync without warning.
   */
  xero_invoice_id: string | null;
}

export function listCreditors(
  filters: { status?: CreditorStatus; limit?: number; offset?: number } = {},
): Promise<Page<CreditorRow>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<Page<CreditorRow>>(`/finance/creditors${query ? `?${query}` : ""}`);
}

export function createCreditor(body: {
  name: string;
  amount_owed: string;
  due_date?: string | null;
  status?: CreditorStatus;
  notes?: string | null;
}): Promise<{ id: string }> {
  return api.post<{ id: string }>("/finance/creditors", body);
}

export function updateCreditorStatus(
  id: string,
  status: CreditorStatus,
): Promise<{ id: string; status: CreditorStatus }> {
  return api.patch<{ id: string; status: CreditorStatus }>(
    `/finance/creditors/${id}/status`,
    { status },
  );
}

// ---------------------------------------------------------------------------
// Payment notices
// ---------------------------------------------------------------------------

export interface PaymentNoticeRow {
  id: string;
  period: string;
  payee: string;
  amount: string | null;
  due_date: string | null;
  status: PaymentNoticeStatus;
  notes: string | null;
}

export interface PaymentNoticePage extends Page<PaymentNoticeRow> {
  /** Echoed by the server so the page can title itself without recomputing. */
  month: "current" | "all";
}

/** Defaults to the current calendar month (§9). `"all"` lifts the filter. */
export function listPaymentNotices(
  options: { month?: "current" | "all"; limit?: number; offset?: number } = {},
): Promise<PaymentNoticePage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<PaymentNoticePage>(`/finance/payment-notices${query ? `?${query}` : ""}`);
}

export function createPaymentNotice(body: {
  period: string;
  payee: string;
  amount: string;
  due_date: string;
  status?: PaymentNoticeStatus;
  notes?: string | null;
}): Promise<{ id: string }> {
  return api.post<{ id: string }>("/finance/payment-notices", body);
}

export function updatePaymentNoticeStatus(
  id: string,
  status: PaymentNoticeStatus,
): Promise<{ id: string; status: PaymentNoticeStatus }> {
  return api.patch<{ id: string; status: PaymentNoticeStatus }>(
    `/finance/payment-notices/${id}/status`,
    { status },
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportListRow {
  id: string;
  type: ReportType;
  period_start: string | null;
  period_end: string | null;
  status: ReportStatus;
  generated_by: string | null;
  generated_by_name: string | null;
  generated_at: string | null;
  published_by: string | null;
  published_by_name: string | null;
  published_at: string | null;
}

export function listReports(
  filters: { type?: ReportType; limit?: number; offset?: number } = {},
): Promise<Page<ReportListRow>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return api.get<Page<ReportListRow>>(`/finance/reports${query ? `?${query}` : ""}`);
}

/**
 * A report's stored body.
 *
 * `content` is a daily snapshot or a period report plus its free text,
 * discriminated by `type`. It is a stored SNAPSHOT, not a live computation —
 * opening a published report months later shows the figures as they were when
 * it was generated, which is what makes it citable.
 */
export interface ReportDetail {
  id: string;
  type: ReportType;
  period_start: string | null;
  period_end: string | null;
  status: ReportStatus;
  content: DailySnapshot | (PeriodReportData & Record<string, string>);
  generated_by: string | null;
  generated_at: string | null;
  published_by: string | null;
  published_at: string | null;
}

export function getReport(id: string): Promise<ReportDetail> {
  return api.get<ReportDetail>(`/finance/reports/${id}`);
}

/** Daily reports publish immediately — there is no draft step (§9). */
export function generateDailyReport(
  date?: string,
): Promise<{ id: string; regenerated: boolean }> {
  return api.post<{ id: string; regenerated: boolean }>(
    "/finance/reports/daily",
    date ? { date } : {},
  );
}

export function previewWeeklyReport(
  periodStart?: string,
  periodEnd?: string,
): Promise<PeriodReportData> {
  const params = new URLSearchParams();
  if (periodStart) params.set("period_start", periodStart);
  if (periodEnd) params.set("period_end", periodEnd);
  const query = params.toString();
  return api.get<PeriodReportData>(`/finance/reports/weekly/preview${query ? `?${query}` : ""}`);
}

export function previewMonthlyReport(
  periodStart?: string,
  periodEnd?: string,
): Promise<PeriodReportData> {
  const params = new URLSearchParams();
  if (periodStart) params.set("period_start", periodStart);
  if (periodEnd) params.set("period_end", periodEnd);
  const query = params.toString();
  return api.get<PeriodReportData>(`/finance/reports/monthly/preview${query ? `?${query}` : ""}`);
}

export interface CreatePeriodReportBody {
  period_start: string;
  period_end: string;
  /** Honoured only for admin/finance_manager; an officer gets a 403. */
  publish: boolean;
  executive_summary: string;
  key_advancements: string;
  challenges: string;
  /** `next_week_plan` for weekly, `next_month_plan` for monthly. */
  next_week_plan?: string;
  next_month_plan?: string;
}

export function createWeeklyReport(
  body: CreatePeriodReportBody,
): Promise<{ id: string; status: ReportStatus }> {
  return api.post<{ id: string; status: ReportStatus }>("/finance/reports/weekly", body);
}

export function createMonthlyReport(
  body: CreatePeriodReportBody,
): Promise<{ id: string; status: ReportStatus }> {
  return api.post<{ id: string; status: ReportStatus }>("/finance/reports/monthly", body);
}

export function publishReport(
  id: string,
): Promise<{ id: string; status: "published"; published_at: string }> {
  return api.post<{ id: string; status: "published"; published_at: string }>(
    `/finance/reports/${id}/publish`,
    {},
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportPreview {
  filename: string;
  size_bytes: number;
  headers: string[];
  row_count: number;
  sample: Record<string, unknown>[];
  map_fields: readonly string[];
  required_map_fields: readonly string[];
}

/**
 * Uploads a file for preview. Writes nothing.
 *
 * `FormData` rather than JSON, and deliberately NOT going through `api.post` —
 * that helper sets `Content-Type: application/json`, and a multipart body needs
 * the browser to set the header itself so it can include the boundary.
 */
export function previewImport(file: File): Promise<ImportPreview> {
  const body = new FormData();
  body.append("file", file);
  return api.postForm<ImportPreview>("/finance/import/preview", body);
}

export interface ImportDryRunResult {
  dry_run: true;
  valid_count: number;
  invalid_count: number;
  errors: { row: number; ok: false; errors: string[] }[];
}

export interface ImportCommitResult {
  dry_run: false;
  inserted: number;
  account_id: string;
  current_balance: string;
}

/**
 * Validates or commits an import.
 *
 * The file is re-uploaded rather than referenced from the preview: the server
 * keeps no state between the two calls, and re-parsing is what guarantees the
 * committed rows came from a real file rather than from a client-supplied list.
 *
 * Always call this with `dryRun: true` first. The import is all-or-nothing, so
 * without a dry run the operator fixes one bad row at a time across repeated
 * uploads.
 */
export function commitImport(
  file: File,
  accountId: string,
  mapping: Record<string, string>,
  dryRun: boolean,
): Promise<ImportDryRunResult | ImportCommitResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("account_id", accountId);
  body.append("mapping", JSON.stringify(mapping));
  body.append("dry_run", String(dryRun));
  return api.postForm<ImportDryRunResult | ImportCommitResult>("/finance/import/commit", body);
}
