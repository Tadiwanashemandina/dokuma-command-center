import { z } from "zod";

/**
 * The finance contract — request schemas and vocabulary shared by the Express
 * routes and the React pages.
 *
 * Ported from `lib/validation/finance-schema.ts` with ONE deliberate change,
 * called out here because it is the only place this module departs from the
 * legacy behavior:
 *
 *   Money is a decimal STRING, not `z.coerce.number()`.
 *
 * The legacy schemas coerced every amount to a JS number, which round-trips it
 * through float64 before it ever reaches Decimal128 storage. That silently
 * defeats the reason `numeric(14,2)` was chosen in the first place (inventory
 * §10, D-12) — 0.1 + 0.2 is not 0.3, and these values are summed across
 * thousands of ledger rows to produce a balance somebody signs off on. The
 * same rule is already encoded for the Group feed in `sbu-kpis.ts` for exactly
 * this reason.
 *
 * Everything else — the field names, the max lengths, the enum members, the
 * "reason is required for every reversal" message — is preserved verbatim, so
 * a form that validated before still validates now.
 */

// ---------------------------------------------------------------------------
// Vocabulary — must match the Mongoose enums in server/src/db/models/finance.ts
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = ["bank", "cash", "mobile-money"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = ["debit", "credit"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * `xero-sync` is new. It exists so a row that arrived from Xero is
 * distinguishable from one a person typed, which matters at three points: the
 * import reconciler must not re-import it, the Xero push must not send it back
 * up (that is the duplicate-ledger loop), and a reversal of it has to be
 * pushed as a real Xero entry rather than silently diverging.
 */
export const TRANSACTION_SOURCES = ["manual", "excel-import", "xero-sync"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const REPORT_TYPES = ["daily", "weekly", "monthly"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = ["draft", "published"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const CREDITOR_STATUSES = ["outstanding", "partially_paid", "paid"] as const;
export type CreditorStatus = (typeof CREDITOR_STATUSES)[number];

export const PAYMENT_NOTICE_STATUSES = ["scheduled", "sent", "paid"] as const;
export type PaymentNoticeStatus = (typeof PAYMENT_NOTICE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, the shape every date-only column carries. */
export const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Not a valid calendar date",
  });

/**
 * A positive money amount as an exact decimal string.
 *
 * Accepts an unsigned literal with at most two decimal places. It rejects
 * `1e3`, `-5`, `.5` and `1.005` rather than rounding them: at the HTTP
 * boundary an ambiguous amount is a client bug, and rounding it here would
 * hide the bug inside a number somebody later reconciles against a bank
 * statement.
 *
 * `> 0` mirrors the `check (amount > 0)` constraint from migration 0014 —
 * direction is carried by `type`, and a correction is a reversal row, never a
 * negative amount.
 */
export const positiveMoneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Expected a positive amount with at most 2 decimal places")
  .refine((value) => Number(value) > 0, { message: "Amount must be greater than 0" });

/**
 * Money that may legitimately be zero or negative — an opening balance, a
 * budget figure, a report total. Same exactness rule, sign allowed.
 */
export const signedMoneyString = z
  .string()
  .trim()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, "Expected an amount with at most 2 decimal places");

/** `numeric(5,2)` percent, 0–100 inclusive. */
export const percentString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Expected a percentage with at most 2 decimal places")
  .refine((value) => Number(value) >= 0 && Number(value) <= 100, {
    message: "Percentage must be between 0 and 100",
  });

/**
 * A boolean arriving as a string — a query parameter or a multipart field.
 *
 * NOT `z.coerce.boolean()`. That is `Boolean(value)`, and every non-empty
 * string is truthy, so the string `"false"` becomes `true`. Since a query
 * parameter and a multipart field are ALWAYS strings, the coercing version
 * silently means "true unless absent" — which inverts the meaning of every
 * `?flag=false` a caller sends.
 *
 * This accepts the forms an HTTP client actually sends and rejects anything
 * else, so a typo is a 400 rather than a silent `true`.
 */
export const booleanFlag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no", "on", "off"])])
  .transform((value) =>
    typeof value === "boolean" ? value : ["true", "1", "yes", "on"].includes(value),
  );

/** Optional free text that normalizes "" to null, as the legacy forms did. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(ACCOUNT_TYPES),
  /** ISO-4217. Uppercased so "usd" and "USD" do not become two currencies. */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Expected a 3-letter ISO currency code")
    .transform((value) => value.toUpperCase())
    .default("USD"),
  opening_balance: signedMoneyString.default("0.00"),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const createTransactionSchema = z
  .object({
    account_id: z.string().uuid(),
    date: dateOnlyString,
    type: z.enum(TRANSACTION_TYPES),
    amount: positiveMoneyString,
    category: optionalText(200),
    counterparty: optionalText(200),
    description: optionalText(2000),
    reference_no: optionalText(200),
    is_dlap: booleanFlag.default(false),
    dlap_share_pct: percentString.nullish().transform((value) => value ?? null),
  })
  /**
   * A DLAP share on a non-DLAP row is meaningless, and a DLAP row with no
   * share silently contributes 0 to `computeDlapShare` — which reads as "this
   * partner is owed nothing" rather than "nobody filled this in". The legacy
   * schema allowed both; this is the one validation genuinely added rather
   * than ported, because both failure modes are invisible in the report.
   */
  .refine((value) => value.is_dlap || value.dlap_share_pct === null, {
    message: "A DLAP share percentage requires is_dlap to be set",
    path: ["dlap_share_pct"],
  })
  .refine((value) => !value.is_dlap || value.dlap_share_pct !== null, {
    message: "A DLAP transaction requires a share percentage",
    path: ["dlap_share_pct"],
  });
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const reverseTransactionSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required for every reversal").max(1000),
});
export type ReverseTransactionInput = z.infer<typeof reverseTransactionSchema>;

export const listTransactionsQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  from: dateOnlyString.optional(),
  to: dateOnlyString.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  is_dlap: booleanFlag.optional(),
});

// ---------------------------------------------------------------------------
// Creditors
// ---------------------------------------------------------------------------

export const createCreditorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount_owed: positiveMoneyString,
  due_date: dateOnlyString.nullish().transform((value) => value ?? null),
  status: z.enum(CREDITOR_STATUSES).default("outstanding"),
  notes: optionalText(2000),
});
export type CreateCreditorInput = z.infer<typeof createCreditorSchema>;

export const updateCreditorStatusSchema = z.object({
  status: z.enum(CREDITOR_STATUSES),
});

// ---------------------------------------------------------------------------
// Payment notices
// ---------------------------------------------------------------------------

export const createPaymentNoticeSchema = z.object({
  period: z.string().trim().min(1).max(50),
  payee: z.string().trim().min(1).max(200),
  amount: positiveMoneyString,
  due_date: dateOnlyString,
  status: z.enum(PAYMENT_NOTICE_STATUSES).default("scheduled"),
  notes: optionalText(2000),
});
export type CreatePaymentNoticeInput = z.infer<typeof createPaymentNoticeSchema>;

export const updatePaymentNoticeStatusSchema = z.object({
  status: z.enum(PAYMENT_NOTICE_STATUSES),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const generateDailyReportSchema = z.object({
  date: dateOnlyString.optional(),
});

export const weeklyReportFreeTextSchema = z.object({
  executive_summary: z.string().trim().max(5000),
  key_advancements: z.string().trim().max(5000),
  challenges: z.string().trim().max(5000),
  next_week_plan: z.string().trim().max(5000),
});
export type WeeklyReportFreeText = z.infer<typeof weeklyReportFreeTextSchema>;

export const monthlyReportFreeTextSchema = z.object({
  executive_summary: z.string().trim().max(5000),
  key_advancements: z.string().trim().max(5000),
  challenges: z.string().trim().max(5000),
  next_month_plan: z.string().trim().max(5000),
});
export type MonthlyReportFreeText = z.infer<typeof monthlyReportFreeTextSchema>;

/**
 * Period + free text + the publish decision, as the weekly/monthly "new"
 * pages submit it. `publish` drives the Save-draft vs Save-and-publish split;
 * the server additionally requires FINANCE_APPROVE to honour `true`, because
 * a finance_officer may draft but not publish.
 */
export const createPeriodReportSchema = z.object({
  period_start: dateOnlyString,
  period_end: dateOnlyString,
  publish: booleanFlag.default(false),
});

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Every money field on the wire is a fixed-scale decimal string. */
export interface AccountSummary {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: string;
  current_balance: string;
  is_active: boolean;
  /** Present only when this account is linked to a Xero bank account. */
  xero_account_id: string | null;
  xero_synced_at: string | null;
}

export interface CashPositionCurrency {
  currency: string;
  total_balance: string;
  accounts: { id: string; name: string; type: AccountType; current_balance: string }[];
}

export interface TransactionSummary {
  id: string;
  account_id: string;
  account_name: string | null;
  date: string;
  type: TransactionType;
  amount: string;
  category: string | null;
  counterparty: string | null;
  description: string | null;
  reference_no: string | null;
  is_dlap: boolean;
  dlap_share_pct: string | null;
  source: TransactionSource;
  reverses_transaction_id: string | null;
  is_reversed: boolean;
  receipt_path: string | null;
  created_by: string | null;
  created_at: string | null;
  xero_transaction_id: string | null;
}

export interface DlapSummary {
  total_amount: string;
  dokuma_share: string;
  transaction_count: number;
}

export interface TrendPoint {
  label: string;
  period_start: string;
  period_end: string;
  closing_balance: string;
}

export interface CreditorSummary {
  id: string;
  name: string;
  amount_owed: string;
  due_date: string | null;
  status: CreditorStatus;
  notes: string | null;
}

export interface UnusualTransaction {
  id: string;
  account_id: string;
  account_name: string | null;
  date: string;
  type: TransactionType;
  amount: string;
  category: string | null;
  counterparty: string | null;
  description: string | null;
}

export interface DailySnapshot {
  date: string;
  opening_balance: string;
  closing_balance: string;
  transactions_in: string;
  transactions_out: string;
  unusual_transactions: UnusualTransaction[];
}

/**
 * Weekly/monthly report body.
 *
 * `current_balance` and `closing_balance` are deliberately two fields, not one
 * (inventory §9): closing is the balance AT `period_end`; current is live at
 * generation time. For a report generated shortly after its period ends they
 * usually match, and the gap between them when they do not is the point — it
 * tells the reader how much has moved since. Collapsing them would destroy
 * that signal and is the single most likely "simplification" to be attempted
 * here, so both names are load-bearing.
 */
export interface PeriodReportData {
  period_start: string;
  period_end: string;
  opening_balance: string;
  current_balance: string;
  closing_balance: string;
  dlap: DlapSummary;
  trend: TrendPoint[];
  creditors: CreditorSummary[];
}
