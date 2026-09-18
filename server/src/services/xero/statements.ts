import { XeroStatement, FinanceCompanyTotals, XeroInvoice } from "../../db/models/index.js";
import { toDecimal128, toDateOnly, currentDate } from "../../db/types.js";
import { toScaled, fromScaled } from "../finance/balances.js";
import { xeroRequest } from "./client.js";
import { xeroAmountToString } from "./mapping.js";

/**
 * Xero's computed financial statements — Profit & Loss and Balance Sheet.
 *
 * These are the only figures in the integration that Xero *derives* rather
 * than stores, and that changes how they must be treated. Re-running the same
 * report months later can legitimately return different numbers, because the
 * period may have been reopened and adjusted. A board pack has to be
 * reproducible, so each fetch is snapshotted with the period it covers and the
 * time it was taken (`XeroStatement`), and the snapshot — not a live call — is
 * what any report reads.
 *
 * This matters specifically for the Group spine measures. `GROUP-REPORTING.md`
 * records that REVENUE and EBITDA are `derived` and the capture endpoint
 * REJECTS a typed figure, because the Group platform computes them from source
 * documents. Nothing here changes that: these snapshots are Dokuma's own view
 * for its own reports. They are not posted upward, and wiring them into the
 * SBU feed would create the second divergent source of truth that rule exists
 * to prevent.
 */

// ---------------------------------------------------------------------------
// Report response shape
// ---------------------------------------------------------------------------

interface XeroReportCell {
  Value?: string | number;
  Attributes?: { Value: string; Id: string }[];
}

interface XeroReportRow {
  RowType: string;
  Title?: string;
  Cells?: XeroReportCell[];
  Rows?: XeroReportRow[];
}

interface XeroReportPayload {
  Reports?: {
    ReportID: string;
    ReportName: string;
    ReportTitles?: string[];
    ReportDate?: string;
    Rows?: XeroReportRow[];
  }[];
}

/**
 * Finds a row by its label and returns its last numeric cell.
 *
 * Xero's reports are a nested section structure whose exact row labels depend
 * on the organisation's chart of accounts, so this searches rather than
 * indexing a fixed position. The LAST cell is taken because a report requested
 * with comparison periods puts the current period first and prior periods
 * after — but a single-period report has only one value cell, and last is
 * correct in both cases only when no comparisons are requested, which is why
 * `fetchProfitAndLoss` deliberately asks for none.
 *
 * Returns null rather than 0 when the row is absent. Zero and "this
 * organisation does not report that line" are different facts, and conflating
 * them would put a confident 0.00 for EBITDA on a report.
 */
function findRowValue(rows: XeroReportRow[] | undefined, labels: string[]): string | null {
  if (!rows) return null;

  const wanted = labels.map((l) => l.toLowerCase());

  for (const row of rows) {
    const label = row.Cells?.[0]?.Value;
    if (typeof label === "string" && wanted.includes(label.trim().toLowerCase())) {
      const cells = row.Cells ?? [];
      const valueCell = cells[cells.length - 1];
      if (valueCell?.Value !== undefined && valueCell.Value !== "") {
        return xeroAmountToString(valueCell.Value);
      }
    }

    const nested = findRowValue(row.Rows, labels);
    if (nested !== null) return nested;
  }

  return null;
}

/** Decimal128 or null, without turning an absent line into a zero. */
function decimalOrNull(value: string | null) {
  return value === null ? null : toDecimal128(value);
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

export interface StatementSnapshot {
  id: string;
  type: "profit-and-loss" | "balance-sheet";
  periodStart: string;
  periodEnd: string;
  revenue: string | null;
  grossProfit: string | null;
  netProfit: string | null;
  totalAssets: string | null;
  totalLiabilities: string | null;
  netAssets: string | null;
}

/**
 * Fetches and snapshots the P&L for a period.
 *
 * No comparison periods are requested (`periods=0`), which keeps the response
 * to a single value column and makes `findRowValue`'s "last cell" unambiguous.
 * If a trend is wanted, it comes from several snapshots rather than from one
 * multi-column report — those snapshots are already stored, and reading the
 * trend from history rather than from a live re-computation is the whole point
 * of storing them.
 */
export async function fetchProfitAndLoss(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<StatementSnapshot> {
  const payload = await xeroRequest<XeroReportPayload>(tenantId, "/Reports/ProfitAndLoss", {
    query: { fromDate: periodStart, toDate: periodEnd, standardLayout: "true" },
  });

  const rows = payload.Reports?.[0]?.Rows;

  // Label variants, because they differ between organisations and regions.
  const revenue = findRowValue(rows, ["Total Income", "Total Revenue", "Income"]);
  const grossProfit = findRowValue(rows, ["Gross Profit"]);
  const netProfit = findRowValue(rows, [
    "Net Profit",
    "Profit for the Period",
    "Net Profit After Tax",
    "Total Net Profit",
  ]);

  const doc = await XeroStatement.findOneAndUpdate(
    { tenantId, type: "profit-and-loss", periodStart: dayToDate(periodStart), periodEnd: dayToDate(periodEnd) },
    {
      $set: {
        revenue: decimalOrNull(revenue),
        grossProfit: decimalOrNull(grossProfit),
        netProfit: decimalOrNull(netProfit),
        lines: (rows ?? []) as unknown as Record<string, unknown>,
        fetchedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return {
    id: doc._id,
    type: "profit-and-loss",
    periodStart,
    periodEnd,
    revenue,
    grossProfit,
    netProfit,
    totalAssets: null,
    totalLiabilities: null,
    netAssets: null,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

/**
 * Fetches and snapshots the Balance Sheet as at a date.
 *
 * A balance sheet is a point-in-time statement, not a period one, so
 * `periodStart` and `periodEnd` are both set to the as-at date. Storing it
 * against the same unique key as the P&L keeps one collection and one lookup
 * shape; the `type` discriminates.
 */
export async function fetchBalanceSheet(
  tenantId: string,
  asAt: string,
): Promise<StatementSnapshot> {
  const payload = await xeroRequest<XeroReportPayload>(tenantId, "/Reports/BalanceSheet", {
    query: { date: asAt, standardLayout: "true" },
  });

  const rows = payload.Reports?.[0]?.Rows;

  const totalAssets = findRowValue(rows, ["Total Assets"]);
  const totalLiabilities = findRowValue(rows, ["Total Liabilities"]);
  const netAssets = findRowValue(rows, ["Net Assets", "Total Equity"]);

  const doc = await XeroStatement.findOneAndUpdate(
    { tenantId, type: "balance-sheet", periodStart: dayToDate(asAt), periodEnd: dayToDate(asAt) },
    {
      $set: {
        totalAssets: decimalOrNull(totalAssets),
        totalLiabilities: decimalOrNull(totalLiabilities),
        netAssets: decimalOrNull(netAssets),
        lines: (rows ?? []) as unknown as Record<string, unknown>,
        fetchedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return {
    id: doc._id,
    type: "balance-sheet",
    periodStart: asAt,
    periodEnd: asAt,
    revenue: null,
    grossProfit: null,
    netProfit: null,
    totalAssets,
    totalLiabilities,
    netAssets,
  };
}

function dayToDate(day: string): Date {
  return toDateOnly(new Date(`${day}T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// Company totals
// ---------------------------------------------------------------------------

/**
 * Recomputes today's `finance_company_totals` row from Xero data.
 *
 * `finance_company_totals` drives three headline KPIs on the CEO dashboard and
 * is `unique (as_of_date)` — one authoritative snapshot per day. This upserts
 * today's row rather than appending, so running the sync repeatedly in a day
 * refines the same figure instead of racing the unique index.
 *
 * Only `outstandingReceivablesUsd` is derived here, from AUTHORISED sales
 * invoices. The two pipeline figures are NOT touched: revenue pipeline and
 * contracted revenue are commercial forecasts that live in this system and
 * have no counterpart in Xero — Xero knows what has been invoiced, not what
 * has been promised. Overwriting them with an accounting figure would silently
 * replace a forward-looking number with a backward-looking one on a CEO's
 * dashboard, so the existing values are preserved on update.
 *
 * Currency: invoices are summed WITHOUT conversion, matching
 * `getTotalBalanceAsOf`'s existing behavior for company-wide totals (§9). For
 * a single-currency organisation this is exact; for a multi-currency one it is
 * the same known approximation the rest of the module already makes, and
 * fixing it is a decision about FX rates that belongs with the business.
 */
export async function recomputeCompanyTotalsFromXero(tenantId: string): Promise<{
  asOfDate: string;
  outstandingReceivables: string;
  invoiceCount: number;
}> {
  const invoices = await XeroInvoice.find({
    tenantId,
    status: "AUTHORISED",
  })
    .select("amountDue")
    .lean();

  let scaled = 0n;
  for (const invoice of invoices) {
    scaled += toScaled(invoice.amountDue);
  }

  const receivables = fromScaled(scaled);
  const asOf = currentDate();

  /**
   * Carry the pipeline figures forward from the most recent prior snapshot.
   *
   * These are commercial forecasts that live in this system and have no
   * counterpart in Xero — Xero knows what has been invoiced, not what has been
   * promised. The first Xero sync of a day creates that day's row, and if it
   * seeded them to zero it would blank two headline CEO KPIs every morning at
   * 03:30. Defaulting to zero is the exact failure this function exists to
   * avoid, so the fallback is the previous day's figures, not a constant.
   *
   * `$setOnInsert` cannot express this: the values must also survive a second
   * run on the same day, when the row already exists and `$set` would apply.
   * So the prior values are read first and re-written explicitly.
   */
  const [todayRow, previous] = await Promise.all([
    FinanceCompanyTotals.findOne({ asOfDate: asOf }).lean(),
    FinanceCompanyTotals.findOne({ asOfDate: { $lt: asOf } })
      .sort({ asOfDate: -1 })
      .lean(),
  ]);

  const carried = todayRow ?? previous;

  const update: Record<string, unknown> = {
    outstandingReceivablesUsd: toDecimal128(receivables),
  };

  // Only written when a value actually exists to carry. Omitting the field
  // leaves whatever is already there, rather than asserting a zero.
  if (carried?.revenuePipelineUsd != null) {
    update["revenuePipelineUsd"] = carried.revenuePipelineUsd;
  }
  if (carried?.contractedRevenueUsd != null) {
    update["contractedRevenueUsd"] = carried.contractedRevenueUsd;
  }

  await FinanceCompanyTotals.updateOne(
    { asOfDate: asOf },
    {
      $set: update,
      // Required on the schema, so an insert with no carried value still needs
      // something. Zero is honest here: there is no prior figure to carry.
      $setOnInsert: {
        ...(update["revenuePipelineUsd"] === undefined
          ? { revenuePipelineUsd: toDecimal128("0") }
          : {}),
        ...(update["contractedRevenueUsd"] === undefined
          ? { contractedRevenueUsd: toDecimal128("0") }
          : {}),
      },
    },
    { upsert: true },
  );

  return {
    asOfDate: asOf.toISOString().slice(0, 10),
    outstandingReceivables: receivables,
    invoiceCount: invoices.length,
  };
}
