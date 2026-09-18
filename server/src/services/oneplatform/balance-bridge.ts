import { randomUUID } from "node:crypto";
import {
  FinanceAccount,
  FinanceCreditor,
  ProjectFinance,
} from "../../db/models/index.js";
import { decimalToNumber, formatDateOnly } from "../../db/types.js";
import { resolveConfig } from "./config.js";
import { signRequest } from "./signing.js";

/**
 * Dokuma's financial position → the Group's `BALANCE` feed.
 *
 * Feeds three spine measures: `DSO_DAYS`, `DPO_DAYS` and `NET_DEBT_EBITDA`.
 *
 * ---------------------------------------------------------------------------
 * Why this is gated behind a completeness check
 * ---------------------------------------------------------------------------
 * `BALANCE` is a SNAPSHOT record type. The Group's documentation states
 * snapshots are always all-or-nothing, and a snapshot is read as *the* position
 * on a date — not as a partial extract. Sending three cash accounts alone would
 * tell the board Dokuma's entire balance sheet is ~$42k, and `NET_DEBT_EBITDA`
 * — a gearing ratio boards read as a solvency signal — would then be computed
 * against it.
 *
 * The arithmetic would be correct and the conclusion badly wrong. That is the
 * most dangerous class of figure to publish, because nothing about it looks
 * suspicious.
 *
 * So `buildBalanceSnapshot()` assembles every component this system can find
 * and reports what is MISSING. `assessCompleteness()` is what a caller checks
 * before deciding to send, and the dispatcher refuses by default.
 *
 * ---------------------------------------------------------------------------
 * What Dokuma actually has, as of 2026-09-18
 * ---------------------------------------------------------------------------
 *   CASH         3 reconciled accounts        ~$42,822   ✓ verified
 *   RECEIVABLES  project_finance              ~$223,200  ✓ present
 *   PAYABLES     finance_creditors            ~$11,720   ✓ present
 *   DEBT         nowhere                      —          ✗ MISSING
 *   FIXED_ASSETS nowhere                      —          ✗ MISSING
 *
 * Note `finance_company_totals` claims $480k receivables against
 * `project_finance`'s $223k. Two sources disagreeing by a factor of two is
 * itself a reason not to publish either until finance says which is right.
 */

const BALANCE_PATH = "/ingest/v1/balances";

/**
 * Balance types.
 *
 * The exact vocabulary the Group accepts is NOT in the documentation supplied,
 * so these are the conventional names. Confirm them against the payload checker
 * before the first real send — a wrong `balanceType` is a rejected batch at
 * best, and a misfiled figure at worst.
 */
export type BalanceType = "CASH" | "RECEIVABLES" | "PAYABLES" | "DEBT" | "FIXED_ASSETS";

export interface BalanceRecord {
  balanceType: BalanceType;
  asOfDate: string;
  currency: string;
  /** Identity is balanceType + asOfDate + currency + accountRef. */
  accountRef: string;
  accountName?: string;
  amount: string;
  sourceUpdatedAt: string;
}

export interface BalanceBatch {
  sbuCode: string;
  clientBatchRef: string;
  /** Forced true: snapshots are all-or-nothing by the Group's own rule. */
  atomic: true;
  documents: BalanceRecord[];
}

export interface CompletenessReport {
  /** Component → total found, or null when this system holds no such data. */
  components: Record<BalanceType, { total: number; count: number } | null>;
  missing: BalanceType[];
  /** Contradictions worth resolving before publishing. */
  warnings: string[];
  /** True only when nothing required is missing and no warning is outstanding. */
  safeToSend: boolean;
}

function dec(value: number): string {
  return value.toFixed(2);
}

/**
 * Builds the snapshot and reports what it could not find.
 *
 * Never throws on missing components — an incomplete picture is the normal
 * case today, and the caller needs the detail in order to decide.
 */
export async function buildBalanceSnapshot(options: {
  asOfDate: Date;
  sbuCode: string;
}): Promise<{ batch: BalanceBatch; completeness: CompletenessReport }> {
  const asOf = formatDateOnly(options.asOfDate);
  if (!asOf) throw new Error("asOfDate is not a valid date.");

  const now = new Date().toISOString();
  const documents: BalanceRecord[] = [];
  const components: CompletenessReport["components"] = {
    CASH: null,
    RECEIVABLES: null,
    PAYABLES: null,
    DEBT: null,
    FIXED_ASSETS: null,
  };
  const warnings: string[] = [];

  // ---- CASH ---------------------------------------------------------------

  const accounts = await FinanceAccount.find({ isActive: true }).lean();
  if (accounts.length > 0) {
    let total = 0;
    for (const account of accounts) {
      const balance = decimalToNumber(account.currentBalance) ?? 0;
      total += balance;
      documents.push({
        balanceType: "CASH",
        asOfDate: asOf,
        currency: account.currency ?? "USD",
        // The account's own id: stable, so tomorrow's snapshot updates the same
        // record rather than creating a parallel one.
        accountRef: account._id,
        accountName: account.name,
        amount: dec(balance),
        sourceUpdatedAt: now,
      });
    }
    components.CASH = { total, count: accounts.length };
  }

  // ---- RECEIVABLES --------------------------------------------------------

  /** Latest snapshot per project, or a project with several rows double-counts. */
  const latestPf = await ProjectFinance.aggregate<{
    _id: string;
    receivables: Parameters<typeof decimalToNumber>[0];
  }>([
    { $sort: { asOfDate: -1 } },
    { $group: { _id: "$projectId", receivables: { $first: "$receivablesUsd" } } },
  ]);

  const receivablesTotal = latestPf.reduce((sum, r) => sum + (decimalToNumber(r.receivables) ?? 0), 0);

  if (receivablesTotal > 0) {
    documents.push({
      balanceType: "RECEIVABLES",
      asOfDate: asOf,
      currency: "USD",
      accountRef: "AR-TOTAL",
      accountName: "Trade receivables",
      amount: dec(receivablesTotal),
      sourceUpdatedAt: now,
    });
    components.RECEIVABLES = { total: receivablesTotal, count: latestPf.length };
  }

  // ---- PAYABLES -----------------------------------------------------------

  const creditors = await FinanceCreditor.find({
    status: { $in: ["outstanding", "partially_paid"] },
  }).lean();

  if (creditors.length > 0) {
    const total = creditors.reduce((sum, c) => sum + (decimalToNumber(c.amountOwed) ?? 0), 0);
    documents.push({
      balanceType: "PAYABLES",
      asOfDate: asOf,
      currency: "USD",
      accountRef: "AP-TOTAL",
      accountName: "Trade payables",
      amount: dec(total),
      sourceUpdatedAt: now,
    });
    components.PAYABLES = { total, count: creditors.length };

    /**
     * A partially-paid creditor's `amountOwed` may be the ORIGINAL invoice
     * rather than the remaining balance — the field name does not settle it.
     * Overstating payables understates net assets, so this is flagged rather
     * than silently summed.
     */
    const partial = creditors.filter((c) => c.status === "partially_paid").length;
    if (partial > 0) {
      warnings.push(
        `${partial} creditor(s) are partially paid — confirm amountOwed is the REMAINING balance, not the original invoice.`,
      );
    }
  }

  // ---- Cross-check against the company totals snapshot --------------------

  /**
   * `finance_company_totals` carries its own receivables figure. When the two
   * disagree materially, one of them is wrong and publishing either would be
   * guessing — so the disagreement is surfaced rather than resolved here.
   */
  const { FinanceCompanyTotals } = await import("../../db/models/index.js");
  const totals = await FinanceCompanyTotals.findOne({}).sort({ asOfDate: -1 }).lean();
  const totalsReceivables = decimalToNumber(totals?.outstandingReceivablesUsd);

  if (totalsReceivables && receivablesTotal > 0) {
    const ratio = totalsReceivables / receivablesTotal;
    if (ratio > 1.1 || ratio < 0.9) {
      warnings.push(
        `Receivables disagree: project_finance says ${dec(receivablesTotal)}, ` +
          `finance_company_totals says ${dec(totalsReceivables)}. Resolve before publishing.`,
      );
    }
  }

  // ---- What is simply absent ---------------------------------------------

  const missing: BalanceType[] = [];
  // DEBT and FIXED_ASSETS have no table in this system at all. Their absence is
  // structural, not a data-entry gap, and NET_DEBT_EBITDA cannot be computed
  // honestly without debt.
  for (const type of ["DEBT", "FIXED_ASSETS"] as const) {
    if (!components[type]) missing.push(type);
  }
  for (const type of ["CASH", "RECEIVABLES", "PAYABLES"] as const) {
    if (!components[type]) missing.push(type);
  }

  return {
    batch: {
      sbuCode: options.sbuCode,
      clientBatchRef: `dokuma-balance-${asOf}-${randomUUID().slice(0, 8)}`,
      atomic: true,
      documents,
    },
    completeness: {
      components,
      missing,
      warnings,
      // Deliberately strict. A snapshot missing debt cannot support
      // NET_DEBT_EBITDA, and a contradiction in receivables cannot support DSO.
      safeToSend: missing.length === 0 && warnings.length === 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface BalanceDispatchResult {
  outcome: "accepted" | "rejected" | "error" | "blocked" | "validated";
  clientBatchRef: string;
  documentsSent: number;
  httpStatus: number | null;
  detail: unknown;
  completeness: CompletenessReport;
}

/**
 * Sends the snapshot — but refuses unless BOTH conditions hold:
 *
 *   - `confirm: true` was passed explicitly, and
 *   - the snapshot is complete, or `overrideIncomplete: true` was also passed.
 *
 * Two separate flags, because they are two separate decisions: "I meant to
 * send" and "I accept that this picture is partial". Collapsing them into one
 * would let a routine send quietly publish an incomplete balance sheet.
 */
export async function dispatchBalanceSnapshot(options: {
  asOfDate: Date;
  confirm?: boolean;
  overrideIncomplete?: boolean;
}): Promise<BalanceDispatchResult> {
  const config = resolveConfig();
  const { batch, completeness } = await buildBalanceSnapshot({
    asOfDate: options.asOfDate,
    sbuCode: config.sbuCode,
  });

  const base = {
    clientBatchRef: batch.clientBatchRef,
    documentsSent: batch.documents.length,
    completeness,
  };

  if (!completeness.safeToSend && !options.overrideIncomplete) {
    return {
      ...base,
      outcome: "blocked",
      httpStatus: null,
      detail: {
        reason: "The snapshot is incomplete. A partial balance sheet is read as a whole one.",
        missing: completeness.missing,
        warnings: completeness.warnings,
      },
    };
  }

  if (!options.confirm || !config.credentials || !config.baseUrl) {
    return {
      ...base,
      outcome: "validated",
      httpStatus: null,
      detail: { reason: "Not confirmed — nothing sent.", payload: batch },
    };
  }

  const body = JSON.stringify(batch);
  const signed = signRequest({
    method: "POST",
    path: BALANCE_PATH,
    body,
    credentials: config.credentials,
  });

  try {
    const response = await fetch(new URL(BALANCE_PATH, config.baseUrl), {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: AbortSignal.timeout(30_000),
    });

    return {
      ...base,
      outcome: response.status === 200 ? "accepted" : "rejected",
      httpStatus: response.status,
      detail: await response.json().catch(() => null),
    };
  } catch (error) {
    return {
      ...base,
      outcome: "error",
      httpStatus: null,
      detail: {
        error: error instanceof Error ? error.message : String(error),
        recovery: `GET /ingest/v1/batches?clientBatchRef=${batch.clientBatchRef}`,
      },
    };
  }
}
