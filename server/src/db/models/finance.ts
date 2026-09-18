import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import {
  uuidPk,
  uuidRef,
  money,
  dateOnly,
  currentDate,
  timestampOptions,
  createdAtOnly,
  PERCENT_SCALE,
  toDecimal128,
  decimalSetter,
  decimalToString,
  computeMarginPct,
} from "../types.js";

/**
 * Finance models. Source: supabase/migrations 0003, 0014, 0029. Inventory §5.2.
 *
 * All money is Decimal128 (D-12). `current_balance` is maintained by the
 * transaction service rather than a trigger — see services/finance/balances.ts,
 * which must run inside the same transaction as the insert (D-11).
 */

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = ["bank", "cash", "mobile-money"] as const;

const financeAccountSchema = new Schema(
  {
    _id: uuidPk,
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ACCOUNT_TYPES },
    currency: { type: String, required: true, default: "USD" },
    openingBalance: money({ required: true, default: 0 }),
    /**
     * Derived, not authoritative: recomputed from `openingBalance` plus the
     * full transaction history by `recomputeAccountBalance()`. It exists
     * because the Cash Position panel reads it directly (and, before this
     * migration, subscribed to it over Supabase Realtime). Treat
     * `getAccountBalanceAsOf()` as the source of truth if the two ever differ.
     */
    currentBalance: money({ required: true, default: 0 }),
    isActive: { type: Boolean, required: true, default: true },

    /**
     * Xero linkage. Null for an account that exists only here.
     *
     * `xeroAccountId` is Xero's `AccountID` for the corresponding bank
     * account; `xeroAccountCode` is the human-facing code from the chart of
     * accounts, kept for display and reconciliation. A linked account still
     * carries its own `openingBalance` — Xero's balance is not imported as
     * an opening figure, because doing that alongside the transaction pull
     * would double-count every historical entry.
     */
    xeroAccountId: { type: String, default: null },
    xeroAccountCode: { type: String, default: null },
    xeroSyncedAt: { type: Date, default: null },
  },
  createdAtOnly,
);

// Partial + unique: at most one local account per Xero account, while any
// number of unlinked accounts keep a null value. A plain unique index would
// reject the second unlinked account, since Mongo treats missing as a value.
financeAccountSchema.index(
  { xeroAccountId: 1 },
  {
    unique: true,
    name: "uniq_finance_account_xero",
    partialFilterExpression: { xeroAccountId: { $type: "string" } },
  },
);

export type FinanceAccountDoc = InferSchemaType<typeof financeAccountSchema>;
export const FinanceAccount: Model<FinanceAccountDoc> = model<FinanceAccountDoc>(
  "FinanceAccount",
  financeAccountSchema,
  "finance_accounts",
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPES = ["debit", "credit"] as const;
/**
 * `xero-sync` marks a row that came DOWN from Xero rather than being typed
 * here. It is what stops the push service sending it back up — the loop that
 * would otherwise duplicate every synced entry in the real ledger.
 */
export const TRANSACTION_SOURCES = ["manual", "excel-import", "xero-sync"] as const;

const financeTransactionSchema = new Schema(
  {
    _id: uuidPk,
    /**
     * ON DELETE RESTRICT (0014) — an account with transactions cannot be
     * deleted. Enforced in cascade.ts, since Mongo will not refuse it for us.
     */
    accountId: uuidRef("FinanceAccount", { required: true }),
    date: dateOnly({ required: true, default: currentDate }),
    type: { type: String, required: true, enum: TRANSACTION_TYPES },
    /**
     * CHECK (amount > 0) — 0014. A negative amount is never valid: direction
     * is carried by `type`, and a correction is a reversal row, not a negative
     * one. Validated here and again by zod at the boundary.
     */
    amount: {
      ...money({ required: true }),
      validate: {
        validator: (v: unknown) => v !== null && v !== undefined && Number(v.toString()) > 0,
        message: "amount must be greater than 0",
      },
    },
    category: { type: String, default: null },
    counterparty: { type: String, default: null },
    description: { type: String, default: null },
    referenceNo: { type: String, default: null },
    isDlap: { type: Boolean, required: true, default: false },
    dlapSharePct: {
      type: Schema.Types.Decimal128,
      default: null,
      set: decimalSetter(PERCENT_SCALE),
    },
    source: { type: String, required: true, default: "manual", enum: TRANSACTION_SOURCES },
    /**
     * Xero's `BankTransactionID` (pulled down) or the id Xero assigned to an
     * entry we pushed up. Either way it means "this row and that Xero entry
     * are the same fact", which is what keeps the sync from re-creating it.
     *
     * Direction is recoverable from `source`: `xero-sync` came down, anything
     * else with an id went up.
     */
    xeroTransactionId: { type: String, default: null },
    /** Xero's row version, used to detect an upstream edit on the next pull. */
    xeroUpdatedAt: { type: Date, default: null },
    /**
     * Self-reference to the transaction this one offsets. A reversal is a real
     * equal-and-opposite entry, never a delete or a hidden flag (0014), which
     * is what keeps the balance arithmetic free of special cases and the audit
     * trail complete.
     */
    reversesTransactionId: uuidRef("FinanceTransaction"),
    isReversed: { type: Boolean, required: true, default: false },
    // Storage path convention `<transaction_id>/<timestamp>-<name>` (0029) is
    // load-bearing for the receipts bucket policy — see storage rules.
    receiptPath: { type: String, default: null },
    createdBy: uuidRef("User"),
  },
  timestampOptions,
);

// idx (account_id, date) — every balance/report query filters this pair.
financeTransactionSchema.index({ accountId: 1, date: 1 }, { name: "idx_finance_txn_account_date" });
financeTransactionSchema.index({ date: 1 }, { name: "idx_finance_txn_date" });
// Reversal lookups: "has this transaction already been reversed?"
financeTransactionSchema.index(
  { reversesTransactionId: 1 },
  {
    name: "idx_finance_txn_reverses",
    partialFilterExpression: { reversesTransactionId: { $type: "string" } },
  },
);
/**
 * At most one local row per Xero entry.
 *
 * This is the constraint the sync's idempotency actually rests on. The
 * reconciler upserts on this key, so a pull that runs twice — a retry, an
 * overlapping cron, a cursor that was not advanced — converges instead of
 * duplicating. Partial, so the many rows with no Xero id are unaffected.
 */
financeTransactionSchema.index(
  { xeroTransactionId: 1 },
  {
    unique: true,
    name: "uniq_finance_txn_xero",
    partialFilterExpression: { xeroTransactionId: { $type: "string" } },
  },
);

export type FinanceTransactionDoc = InferSchemaType<typeof financeTransactionSchema>;
export const FinanceTransaction: Model<FinanceTransactionDoc> = model<FinanceTransactionDoc>(
  "FinanceTransaction",
  financeTransactionSchema,
  "finance_transactions",
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REPORT_TYPES = ["daily", "weekly", "monthly"] as const;
export const REPORT_STATUSES = ["draft", "published"] as const;

const financeReportSchema = new Schema(
  {
    _id: uuidPk,
    type: { type: String, required: true, enum: REPORT_TYPES },
    periodStart: dateOnly({ required: true }),
    periodEnd: dateOnly({ required: true }),
    // jsonb → Mixed. The report body is a structured snapshot whose shape
    // varies by report type; zod validates it per type at the boundary.
    content: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    generatedBy: uuidRef("User"),
    generatedAt: { type: Date, required: true, default: () => new Date() },
    publishedBy: uuidRef("User"),
    publishedAt: { type: Date, default: null },
    status: { type: String, required: true, default: "draft", enum: REPORT_STATUSES },
  },
  { timestamps: false },
);

financeReportSchema.index({ type: 1, periodStart: 1 }, { name: "idx_finance_reports_type_period" });

export type FinanceReportDoc = InferSchemaType<typeof financeReportSchema>;
export const FinanceReport: Model<FinanceReportDoc> = model<FinanceReportDoc>(
  "FinanceReport",
  financeReportSchema,
  "finance_reports",
);

// ---------------------------------------------------------------------------
// Creditors & payment notices
// ---------------------------------------------------------------------------

export const CREDITOR_STATUSES = ["outstanding", "partially_paid", "paid"] as const;

const financeCreditorSchema = new Schema(
  {
    _id: uuidPk,
    name: { type: String, required: true },
    amountOwed: money({ required: true }),
    dueDate: dateOnly(),
    status: { type: String, required: true, default: "outstanding", enum: CREDITOR_STATUSES },
    notes: { type: String, default: null },

    /**
     * Set when this creditor was derived from a Xero ACCPAY invoice (a bill).
     * `amountOwed` then tracks Xero's `AmountDue`, and `status` is mapped from
     * it rather than edited here — see services/xero/sync-invoices.ts.
     */
    xeroInvoiceId: { type: String, default: null },
    xeroContactId: { type: String, default: null },
    xeroSyncedAt: { type: Date, default: null },
  },
  timestampOptions,
);

financeCreditorSchema.index({ status: 1, dueDate: 1 }, { name: "idx_finance_creditors_status_due" });
financeCreditorSchema.index(
  { xeroInvoiceId: 1 },
  {
    unique: true,
    name: "uniq_finance_creditor_xero_invoice",
    partialFilterExpression: { xeroInvoiceId: { $type: "string" } },
  },
);

export type FinanceCreditorDoc = InferSchemaType<typeof financeCreditorSchema>;
export const FinanceCreditor: Model<FinanceCreditorDoc> = model<FinanceCreditorDoc>(
  "FinanceCreditor",
  financeCreditorSchema,
  "finance_creditors",
);

export const PAYMENT_NOTICE_STATUSES = ["scheduled", "sent", "paid"] as const;

const financePaymentNoticeSchema = new Schema(
  {
    _id: uuidPk,
    period: { type: String, required: true },
    payee: { type: String, required: true },
    amount: money({ required: true }),
    dueDate: dateOnly({ required: true }),
    status: { type: String, required: true, default: "scheduled", enum: PAYMENT_NOTICE_STATUSES },
    notes: { type: String, default: null },
  },
  timestampOptions,
);

financePaymentNoticeSchema.index({ dueDate: 1 }, { name: "idx_finance_notices_due_date" });

export type FinancePaymentNoticeDoc = InferSchemaType<typeof financePaymentNoticeSchema>;
export const FinancePaymentNotice: Model<FinancePaymentNoticeDoc> = model<FinancePaymentNoticeDoc>(
  "FinancePaymentNotice",
  financePaymentNoticeSchema,
  "finance_payment_notices",
);

// ---------------------------------------------------------------------------
// Project finance & company totals (0003)
// ---------------------------------------------------------------------------

const projectFinanceSchema = new Schema(
  {
    _id: uuidPk,
    // unique — one finance row per project. ON DELETE CASCADE (0003).
    projectId: uuidRef("Project", { required: true }),
    budgetUsd: money(),
    costToDateUsd: money(),
    revenuePipelineUsd: money(),
    contractedRevenueUsd: money(),
    receivablesUsd: money(),
    asOfDate: dateOnly({ required: true, default: currentDate }),
  },
  createdAtOnly,
);

projectFinanceSchema.index({ projectId: 1 }, { unique: true, name: "uniq_project_finance_project" });

/**
 * `v_project_margins` (0003) — margin is derived, never stored, so it cannot
 * drift out of sync with budget/cost. Returns null when budget is absent or
 * zero, matching the view's CASE exactly.
 *
 * Delegates to `computeMarginPct` rather than carrying its own arithmetic.
 * The `/project-finance` endpoint cannot use this virtual — virtuals are not
 * materialised on a `.lean()` result without the `mongoose-lean-virtuals`
 * plugin, which this project does not use — so it calls the same function
 * directly. Two implementations of one formula would agree until the day they
 * did not, and the disagreement would surface as a margin that differs
 * depending on which code path rendered it.
 */
projectFinanceSchema.virtual("marginPct").get(function (this: ProjectFinanceDoc): number | null {
  return computeMarginPct(
    decimalToString(this.budgetUsd),
    decimalToString(this.costToDateUsd),
  );
});

export type ProjectFinanceDoc = InferSchemaType<typeof projectFinanceSchema>;
export const ProjectFinance: Model<ProjectFinanceDoc> = model<ProjectFinanceDoc>(
  "ProjectFinance",
  projectFinanceSchema,
  "project_finance",
);

const financeCompanyTotalsSchema = new Schema(
  {
    _id: uuidPk,
    asOfDate: dateOnly({ required: true }),
    revenuePipelineUsd: money({ required: true }),
    contractedRevenueUsd: money({ required: true }),
    outstandingReceivablesUsd: money({ required: true }),
  },
  createdAtOnly,
);

// unique as_of_date (0003) — one authoritative snapshot per day; the three
// headline USD KPIs read the row with the newest date.
financeCompanyTotalsSchema.index(
  { asOfDate: -1 },
  { unique: true, name: "uniq_finance_company_totals_date" },
);

export type FinanceCompanyTotalsDoc = InferSchemaType<typeof financeCompanyTotalsSchema>;
export const FinanceCompanyTotals: Model<FinanceCompanyTotalsDoc> = model<FinanceCompanyTotalsDoc>(
  "FinanceCompanyTotals",
  financeCompanyTotalsSchema,
  "finance_company_totals",
);
