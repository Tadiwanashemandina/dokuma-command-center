import { Router } from "express";
import { z } from "zod";
import {
  FINANCE_READ,
  FINANCE_WRITE,
  FINANCE_APPROVE,
  createAccountSchema,
  createTransactionSchema,
  reverseTransactionSchema,
  listTransactionsQuerySchema,
  createCreditorSchema,
  updateCreditorStatusSchema,
  createPaymentNoticeSchema,
  updatePaymentNoticeStatusSchema,
  generateDailyReportSchema,
  createPeriodReportSchema,
  weeklyReportFreeTextSchema,
  monthlyReportFreeTextSchema,
} from "@dokuma/shared";
import {
  FinanceAccount,
  FinanceCreditor,
  FinancePaymentNotice,
  FinanceReport,
  FinanceTransaction,
  ProjectFinance,
  FinanceCompanyTotals,
  Project,
  User,
} from "../db/models/index.js";
import { requireRole, requireAuthContext } from "../middleware/auth.js";
import { HttpError } from "../middleware/http-error.js";
import { audit } from "../services/audit.js";
import { handle, ok, pagination, page, uuidParam } from "./helpers.js";
import { dateOnly, money, timestamp, nullable } from "./serializers.js";
import { toDecimal128, toDateOnly, decimalToString, computeMarginPct } from "../db/types.js";
import { getCashPosition } from "../services/finance/balances.js";
import { createTransaction, reverseTransaction } from "../services/finance/transactions.js";
import {
  computeDailySnapshot,
  computeWeeklyReportData,
  computeMonthlyReportData,
  currentMonthRange,
  currentWeekRange,
  today,
  formatDay,
} from "../services/finance/reports.js";

/**
 * Finance (inventory §2.4, routes 13–21).
 *
 * The three role tiers from the legacy `requireRole()` calls are preserved
 * exactly, and the distinction between the second and third is the one that
 * matters:
 *
 *   FINANCE_READ    (admin, exec, finance_officer, finance_manager) — viewing.
 *   FINANCE_WRITE   (admin, finance_officer, finance_manager)       — creating.
 *   FINANCE_APPROVE (admin, finance_manager)                        — status
 *                                                                     changes
 *                                                                     and
 *                                                                     publishing.
 *
 * `exec` can read everything and write nothing. A finance_officer can draft a
 * report but not publish it, and can create a creditor but not mark it paid.
 * The inventory (§3.2) flags that the legacy UI showed a publish button to
 * anyone who could see the page, so a finance_officer clicking it got a
 * server-side rejection — the guard was right and the button was wrong. The
 * guard is ported as-is; the React page fixes the button.
 *
 * This router is NOT department-scoped. `finance_transactions` and friends
 * carry no `department` column — only `risks` and `clients` do (§4.5) — so
 * the role gate is the whole gate here, exactly as the RLS policies were.
 */

export const financeRouter = Router();

const readOnly = requireRole(FINANCE_READ);
const canWrite = requireRole(FINANCE_WRITE);
const canApprove = requireRole(FINANCE_APPROVE);

// ---------------------------------------------------------------------------
// Accounts & cash position
// ---------------------------------------------------------------------------

financeRouter.get(
  "/accounts",
  ...readOnly,
  handle(async (req, res) => {
    const includeInactive = req.query["include_inactive"] === "true";
    const filter = includeInactive ? {} : { isActive: true };

    const accounts = await FinanceAccount.find(filter).sort({ currency: 1, name: 1 }).lean();

    ok(
      res,
      accounts.map((account) => ({
        id: account._id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        opening_balance: money(account.openingBalance),
        current_balance: money(account.currentBalance),
        is_active: account.isActive,
        xero_account_id: nullable(account.xeroAccountId),
        xero_synced_at: timestamp(account.xeroSyncedAt),
      })),
    );
  }),
);

financeRouter.post(
  "/accounts",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = createAccountSchema.parse(req.body);

    const account = await FinanceAccount.create({
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalance: toDecimal128(input.opening_balance),
      // Seeded from the opening balance: with no transactions yet, the two are
      // by definition equal, and leaving it at 0 would show a funded account
      // as empty until its first transaction triggered a recompute.
      currentBalance: toDecimal128(input.opening_balance),
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_account_created",
      entityType: "finance_accounts",
      entityId: account._id,
      metadata: { name: input.name, type: input.type, currency: input.currency },
    });

    ok(res, { id: account._id }, 201);
  }),
);

/**
 * Cash position, grouped by currency.
 *
 * Never summed across currencies (§9) — the grouping is the point, and a
 * single total would be meaningless for an organisation holding USD and ZWL.
 * The one place currencies ARE mixed is `getTotalBalanceAsOf`, used for
 * company-wide report totals; both behaviors are intentional and both are kept.
 */
financeRouter.get(
  "/cash-position",
  ...readOnly,
  handle(async (_req, res) => {
    const position = await getCashPosition();

    ok(
      res,
      position.map((bucket) => ({
        currency: bucket.currency,
        total_balance: bucket.totalBalance,
        accounts: bucket.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          current_balance: a.currentBalance,
        })),
      })),
    );
  }),
);

// ---------------------------------------------------------------------------
// Company totals & project finance
// ---------------------------------------------------------------------------

/**
 * The three headline USD KPIs, from the row with the newest `as_of_date`.
 *
 * `finance_company_totals` is `unique (as_of_date)` — one authoritative
 * snapshot per day — so "latest" is a single sort, not an aggregation.
 */
financeRouter.get(
  "/company-totals",
  ...readOnly,
  handle(async (_req, res) => {
    const totals = await FinanceCompanyTotals.findOne().sort({ asOfDate: -1 }).lean();

    if (!totals) {
      // No snapshot yet is a real state, not an error — a fresh deployment has
      // none. Returning null lets the page say "no data" rather than render
      // three confident zeros.
      ok(res, null);
      return;
    }

    ok(res, {
      as_of_date: dateOnly(totals.asOfDate),
      revenue_pipeline_usd: money(totals.revenuePipelineUsd),
      contracted_revenue_usd: money(totals.contractedRevenueUsd),
      outstanding_receivables_usd: money(totals.outstandingReceivablesUsd),
    });
  }),
);

/**
 * Per-project finance with the computed margin.
 *
 * `marginPct` is the `v_project_margins` view: `(budget − cost) / budget × 100`,
 * null when budget is absent or zero. It is a virtual on the model rather than
 * a stored column so it cannot drift from the figures it derives from — and
 * it is computed here rather than in the page, which is what the legacy
 * `/finance` did inline.
 */
financeRouter.get(
  "/project-finance",
  ...readOnly,
  handle(async (_req, res) => {
    const rows = await ProjectFinance.find().lean();

    const projectIds = [...new Set(rows.map((r) => r.projectId))];
    const projects = projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select("name status").lean()
      : [];
    const projectById = new Map(projects.map((p) => [p._id, p]));

    ok(
      res,
      rows.map((row) => {
        const budget = decimalToString(row.budgetUsd);
        const cost = decimalToString(row.costToDateUsd);

        return {
          id: row._id,
          project_id: row.projectId,
          project_name: projectById.get(row.projectId)?.name ?? null,
          project_status: projectById.get(row.projectId)?.status ?? null,
          budget_usd: budget,
          cost_to_date_usd: cost,
          revenue_pipeline_usd: money(row.revenuePipelineUsd),
          contracted_revenue_usd: money(row.contractedRevenueUsd),
          receivables_usd: money(row.receivablesUsd),
          as_of_date: dateOnly(row.asOfDate),
          /**
           * `v_project_margins`, computed here rather than read from the
           * model's `marginPct` virtual.
           *
           * A virtual is not available on a `.lean()` result without the
           * `mongoose-lean-virtuals` plugin, which this project does not use —
           * reading it would yield `undefined` and render every project as
           * "no margin", which looks like data rather than a bug. Computing it
           * from `computeMarginPct` keeps one implementation shared with the
           * virtual, on the same exact-decimal helpers as every other figure.
           */
          margin_pct: computeMarginPct(budget, cost),
        };
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

financeRouter.get(
  "/transactions",
  ...readOnly,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const query = listTransactionsQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = {};
    if (query.account_id) filter["accountId"] = query.account_id;
    if (query.type) filter["type"] = query.type;
    if (query.is_dlap !== undefined) filter["isDlap"] = query.is_dlap;

    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range["$gte"] = toDateOnly(new Date(`${query.from}T00:00:00Z`));
      if (query.to) range["$lte"] = toDateOnly(new Date(`${query.to}T00:00:00Z`));
      filter["date"] = range;
    }

    const [items, total] = await Promise.all([
      // Newest first, as the transactions table ordered. `createdAt` breaks
      // the tie so two transactions on the same day have a stable order —
      // without it, pagination can show or skip a row between pages.
      FinanceTransaction.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      FinanceTransaction.countDocuments(filter),
    ]);

    // The `finance_accounts(name)` join the Supabase shim drops.
    const accountIds = [...new Set(items.map((i) => i.accountId))];
    const accounts = accountIds.length
      ? await FinanceAccount.find({ _id: { $in: accountIds } }).select("name").lean()
      : [];
    const accountNames = new Map(accounts.map((a) => [a._id, a.name]));

    ok(
      res,
      page(
        items.map((txn) => ({
          id: txn._id,
          account_id: txn.accountId,
          account_name: accountNames.get(txn.accountId) ?? null,
          date: dateOnly(txn.date),
          type: txn.type,
          amount: money(txn.amount),
          category: nullable(txn.category),
          counterparty: nullable(txn.counterparty),
          description: nullable(txn.description),
          reference_no: nullable(txn.referenceNo),
          is_dlap: txn.isDlap,
          dlap_share_pct: money(txn.dlapSharePct),
          source: txn.source,
          reverses_transaction_id: nullable(txn.reversesTransactionId),
          is_reversed: txn.isReversed,
          receipt_path: nullable(txn.receiptPath),
          created_by: nullable(txn.createdBy),
          created_at: timestamp((txn as { createdAt?: Date }).createdAt),
          xero_transaction_id: nullable(txn.xeroTransactionId),
        })),
        total,
        { limit, offset },
      ),
    );
  }),
);

financeRouter.post(
  "/transactions",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = createTransactionSchema.parse(req.body);

    const result = await createTransaction(input, auth.user.id as string);

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_transaction_created",
      entityType: "finance_transactions",
      entityId: result.id,
      metadata: { account_id: input.account_id, amount: input.amount, type: input.type },
    });

    ok(res, { id: result.id, current_balance: result.currentBalance }, 201);
  }),
);

/**
 * Reverses a transaction.
 *
 * A reversal is a real offsetting entry, never a delete (§9), and the reason
 * is mandatory — it is the only record of WHY the original was wrong, and it
 * ends up in the reversal's description where an auditor reading the ledger
 * will find it.
 */
financeRouter.post(
  "/transactions/:id/reverse",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const id = uuidParam(req);
    const { reason } = reverseTransactionSchema.parse(req.body);

    const result = await reverseTransaction(id, reason, auth.user.id as string);

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_transaction_reversed",
      entityType: "finance_transactions",
      entityId: result.originalId,
      metadata: {
        reason,
        reversal_transaction_id: result.id,
        amount: result.amount,
      },
    });

    ok(
      res,
      {
        id: result.id,
        original_id: result.originalId,
        current_balance: result.currentBalance,
      },
      201,
    );
  }),
);

// ---------------------------------------------------------------------------
// Creditors
// ---------------------------------------------------------------------------

financeRouter.get(
  "/creditors",
  ...readOnly,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const status = z.enum(["outstanding", "partially_paid", "paid"]).optional().parse(req.query["status"]);

    const filter = status ? { status } : {};

    const [items, total] = await Promise.all([
      // Due date ascending — the page is a "what is coming up" list, so the
      // soonest obligation is the one that belongs at the top.
      FinanceCreditor.find(filter).sort({ dueDate: 1 }).skip(offset).limit(limit).lean(),
      FinanceCreditor.countDocuments(filter),
    ]);

    ok(
      res,
      page(
        items.map((creditor) => ({
          id: creditor._id,
          name: creditor.name,
          amount_owed: money(creditor.amountOwed),
          due_date: dateOnly(creditor.dueDate),
          status: creditor.status,
          notes: nullable(creditor.notes),
          /**
           * Surfaced so the page can disable the status control on a
           * Xero-owned row. Editing it here would be silently reverted by the
           * next sync, which is worse than not offering the control.
           */
          xero_invoice_id: nullable(creditor.xeroInvoiceId),
        })),
        total,
        { limit, offset },
      ),
    );
  }),
);

financeRouter.post(
  "/creditors",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = createCreditorSchema.parse(req.body);

    const creditor = await FinanceCreditor.create({
      name: input.name,
      amountOwed: toDecimal128(input.amount_owed),
      dueDate: input.due_date === null ? null : toDateOnly(new Date(`${input.due_date}T00:00:00Z`)),
      status: input.status,
      notes: input.notes,
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_creditor_created",
      entityType: "finance_creditors",
      entityId: creditor._id,
      metadata: { name: input.name, amount_owed: input.amount_owed },
    });

    ok(res, { id: creditor._id }, 201);
  }),
);

/** Status edits are approve-tier (admin, finance_manager), not write-tier. */
financeRouter.patch(
  "/creditors/:id/status",
  ...canApprove,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const id = uuidParam(req);
    const { status } = updateCreditorStatusSchema.parse(req.body);

    const creditor = await FinanceCreditor.findById(id).select("xeroInvoiceId status").lean();
    if (!creditor) throw new HttpError(404, "Creditor not found.");

    /**
     * A Xero-owned row's status is derived from the invoice's amounts on every
     * sync. Accepting an edit here would appear to work and then silently
     * revert, which is the kind of behavior that makes people stop trusting
     * the system. Refusing with a reason is honest.
     */
    if (creditor.xeroInvoiceId !== null) {
      throw new HttpError(
        409,
        "This creditor is managed by Xero. Update the bill in Xero; the change will sync here.",
      );
    }

    await FinanceCreditor.updateOne({ _id: id }, { $set: { status } });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_creditor_status_updated",
      entityType: "finance_creditors",
      entityId: id,
      metadata: { from: creditor.status, to: status },
    });

    ok(res, { id, status });
  }),
);

// ---------------------------------------------------------------------------
// Payment notices
// ---------------------------------------------------------------------------

/**
 * Payment notices.
 *
 * Defaults to the CURRENT CALENDAR MONTH (§9), computed in UTC. `?month=all`
 * lifts the filter — the legacy page had no such escape hatch, but it also had
 * no pagination, and a finance manager looking for last month's notice
 * otherwise has no way to reach it.
 */
financeRouter.get(
  "/payment-notices",
  ...readOnly,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const month = req.query["month"] === "all" ? "all" : "current";

    let filter: Record<string, unknown> = {};
    if (month === "current") {
      const range = currentMonthRange();
      filter = {
        dueDate: {
          $gte: toDateOnly(new Date(`${range.start}T00:00:00Z`)),
          $lte: toDateOnly(new Date(`${range.end}T00:00:00Z`)),
        },
      };
    }

    const [items, total] = await Promise.all([
      FinancePaymentNotice.find(filter).sort({ dueDate: 1 }).skip(offset).limit(limit).lean(),
      FinancePaymentNotice.countDocuments(filter),
    ]);

    ok(res, {
      ...page(
        items.map((notice) => ({
          id: notice._id,
          period: notice.period,
          payee: notice.payee,
          amount: money(notice.amount),
          due_date: dateOnly(notice.dueDate),
          status: notice.status,
          notes: nullable(notice.notes),
        })),
        total,
        { limit, offset },
      ),
      /** Echoed so the page can title itself without recomputing the range. */
      month,
    });
  }),
);

financeRouter.post(
  "/payment-notices",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = createPaymentNoticeSchema.parse(req.body);

    const notice = await FinancePaymentNotice.create({
      period: input.period,
      payee: input.payee,
      amount: toDecimal128(input.amount),
      dueDate: toDateOnly(new Date(`${input.due_date}T00:00:00Z`)),
      status: input.status,
      notes: input.notes,
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_payment_notice_created",
      entityType: "finance_payment_notices",
      entityId: notice._id,
      metadata: { payee: input.payee, amount: input.amount, due_date: input.due_date },
    });

    ok(res, { id: notice._id }, 201);
  }),
);

financeRouter.patch(
  "/payment-notices/:id/status",
  ...canApprove,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const id = uuidParam(req);
    const { status } = updatePaymentNoticeStatusSchema.parse(req.body);

    const notice = await FinancePaymentNotice.findById(id).select("status").lean();
    if (!notice) throw new HttpError(404, "Payment notice not found.");

    await FinancePaymentNotice.updateOne({ _id: id }, { $set: { status } });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_payment_notice_status_updated",
      entityType: "finance_payment_notices",
      entityId: id,
      metadata: { from: notice.status, to: status },
    });

    ok(res, { id, status });
  }),
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

financeRouter.get(
  "/reports",
  ...readOnly,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);
    const type = z.enum(["daily", "weekly", "monthly"]).optional().parse(req.query["type"]);

    const filter = type ? { type } : {};

    const [items, total] = await Promise.all([
      FinanceReport.find(filter)
        .select("-content")
        .sort({ periodStart: -1, generatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      FinanceReport.countDocuments(filter),
    ]);

    const userIds = [
      ...new Set(
        items.flatMap((r) => [r.generatedBy, r.publishedBy]).filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("fullName email").lean()
      : [];
    const userById = new Map(users.map((u) => [u._id, u.fullName ?? u.email]));

    ok(
      res,
      page(
        items.map((report) => ({
          id: report._id,
          type: report.type,
          period_start: dateOnly(report.periodStart),
          period_end: dateOnly(report.periodEnd),
          status: report.status,
          generated_by: nullable(report.generatedBy),
          generated_by_name: userById.get(report.generatedBy ?? "") ?? null,
          generated_at: timestamp(report.generatedAt),
          published_by: nullable(report.publishedBy),
          published_by_name: userById.get(report.publishedBy ?? "") ?? null,
          published_at: timestamp(report.publishedAt),
        })),
        total,
        { limit, offset },
      ),
    );
  }),
);

financeRouter.get(
  "/reports/:id",
  ...readOnly,
  handle(async (req, res) => {
    const id = uuidParam(req);
    const report = await FinanceReport.findById(id).lean();
    if (!report) throw new HttpError(404, "Report not found.");

    ok(res, {
      id: report._id,
      type: report.type,
      period_start: dateOnly(report.periodStart),
      period_end: dateOnly(report.periodEnd),
      status: report.status,
      content: report.content,
      generated_by: nullable(report.generatedBy),
      generated_at: timestamp(report.generatedAt),
      published_by: nullable(report.publishedBy),
      published_at: timestamp(report.publishedAt),
    });
  }),
);

/**
 * Generates a daily report.
 *
 * Daily reports are PUBLISHED IMMEDIATELY with no draft step (§9), unlike
 * weekly and monthly. They are a mechanical end-of-day snapshot with no
 * free-text commentary, so there is nothing for a reviewer to approve.
 */
financeRouter.post(
  "/reports/daily",
  ...canWrite,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { date } = generateDailyReportSchema.parse(req.body ?? {});
    const target = date ?? today();

    const day = toDateOnly(new Date(`${target}T00:00:00Z`));

    /**
     * One daily report per day. Regenerating replaces the existing one rather
     * than stacking a second — the snapshot is deterministic for a given date
     * except for the live-balance fields, so two rows for one day would be
     * near-duplicates that differ only confusingly.
     */
    const existing = await FinanceReport.findOne({ type: "daily", periodStart: day }).lean();

    const snapshot = await computeDailySnapshot(target);

    if (existing) {
      await FinanceReport.updateOne(
        { _id: existing._id },
        {
          $set: {
            content: snapshot,
            generatedBy: auth.user.id as string,
            generatedAt: new Date(),
            status: "published",
            publishedBy: auth.user.id as string,
            publishedAt: new Date(),
          },
        },
      );

      await audit(req, {
        actorId: auth.user.id as string,
        actorRole: auth.role,
        action: "finance_report_regenerated",
        entityType: "finance_reports",
        entityId: existing._id,
        metadata: { type: "daily", date: target },
      });

      ok(res, { id: existing._id, regenerated: true });
      return;
    }

    const report = await FinanceReport.create({
      type: "daily",
      periodStart: day,
      periodEnd: day,
      content: snapshot,
      generatedBy: auth.user.id as string,
      generatedAt: new Date(),
      status: "published",
      publishedBy: auth.user.id as string,
      publishedAt: new Date(),
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_report_generated",
      entityType: "finance_reports",
      entityId: report._id,
      metadata: { type: "daily", date: target },
    });

    ok(res, { id: report._id, regenerated: false }, 201);
  }),
);

/**
 * Preview endpoints for the weekly/monthly "new report" pages.
 *
 * These compute the figures without persisting anything, so the draft form can
 * show the operator what they are commenting on before they commit to it.
 */
financeRouter.get(
  "/reports/weekly/preview",
  ...readOnly,
  handle(async (req, res) => {
    const range = currentWeekRange();
    const periodStart = (req.query["period_start"] as string | undefined) ?? range.start;
    const periodEnd = (req.query["period_end"] as string | undefined) ?? range.end;

    ok(res, await computeWeeklyReportData(periodStart, periodEnd));
  }),
);

financeRouter.get(
  "/reports/monthly/preview",
  ...readOnly,
  handle(async (req, res) => {
    const range = currentMonthRange();
    const periodStart = (req.query["period_start"] as string | undefined) ?? range.start;
    const periodEnd = (req.query["period_end"] as string | undefined) ?? range.end;

    ok(res, await computeMonthlyReportData(periodStart, periodEnd));
  }),
);

/**
 * Creates a weekly or monthly report.
 *
 * Both default to DRAFT (§9). `publish: true` is honoured only for
 * FINANCE_APPROVE — a finance_officer may draft but not publish, which is the
 * same split the legacy `publishReportAction` enforced. Rather than silently
 * downgrading the request to a draft, an officer asking to publish is told why
 * it did not happen.
 */
function periodReportHandler(type: "weekly" | "monthly") {
  return handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const period = createPeriodReportSchema.parse(req.body);
    const freeText =
      type === "weekly"
        ? weeklyReportFreeTextSchema.parse(req.body)
        : monthlyReportFreeTextSchema.parse(req.body);

    if (period.period_end < period.period_start) {
      throw new HttpError(400, "period_end cannot be before period_start.");
    }

    const canPublish = FINANCE_APPROVE.includes(auth.role);
    if (period.publish && !canPublish) {
      throw new HttpError(
        403,
        "Only a finance manager or administrator can publish a report. Save it as a draft for review.",
      );
    }

    const computed =
      type === "weekly"
        ? await computeWeeklyReportData(period.period_start, period.period_end)
        : await computeMonthlyReportData(period.period_start, period.period_end);

    const publishing = period.publish && canPublish;
    const now = new Date();

    const report = await FinanceReport.create({
      type,
      periodStart: toDateOnly(new Date(`${period.period_start}T00:00:00Z`)),
      periodEnd: toDateOnly(new Date(`${period.period_end}T00:00:00Z`)),
      // Computed figures and commentary in one body, so the published report
      // is a self-contained snapshot rather than something that re-derives
      // (and therefore changes) each time it is opened.
      content: { ...computed, ...freeText },
      generatedBy: auth.user.id as string,
      generatedAt: now,
      status: publishing ? "published" : "draft",
      publishedBy: publishing ? (auth.user.id as string) : null,
      publishedAt: publishing ? now : null,
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: publishing ? "finance_report_published" : "finance_report_drafted",
      entityType: "finance_reports",
      entityId: report._id,
      metadata: { type, period_start: period.period_start, period_end: period.period_end },
    });

    ok(res, { id: report._id, status: report.status }, 201);
  });
}

financeRouter.post("/reports/weekly", ...canWrite, periodReportHandler("weekly"));
financeRouter.post("/reports/monthly", ...canWrite, periodReportHandler("monthly"));

/** Publishing is approve-tier only. */
financeRouter.post(
  "/reports/:id/publish",
  ...canApprove,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const id = uuidParam(req);

    const report = await FinanceReport.findById(id).select("status type").lean();
    if (!report) throw new HttpError(404, "Report not found.");

    if (report.status === "published") {
      throw new HttpError(409, "This report is already published.");
    }

    const now = new Date();
    await FinanceReport.updateOne(
      { _id: id },
      { $set: { status: "published", publishedBy: auth.user.id as string, publishedAt: now } },
    );

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "finance_report_published",
      entityType: "finance_reports",
      entityId: id,
      metadata: { type: report.type },
    });

    ok(res, { id, status: "published", published_at: now.toISOString() });
  }),
);
