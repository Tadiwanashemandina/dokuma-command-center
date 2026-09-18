import {
  FinanceAccount,
  FinanceCreditor,
  FinanceTransaction,
  XeroContact,
  XeroInvoice,
  XeroSyncState,
  type XeroResource,
} from "../../db/models/index.js";
import { toDecimal128, toDateOnly, currentDate } from "../../db/types.js";
import { recomputeAccountBalance } from "../finance/balances.js";
import { withTransaction } from "../../db/connection.js";
import { xeroRequest, xeroPaged } from "./client.js";
import {
  parseXeroDate,
  parseXeroDateOnly,
  xeroAmountToString,
  xeroTypeToTransactionType,
  isTransferType,
  xeroInvoiceStatusToCreditorStatus,
} from "./mapping.js";

/**
 * Pulling data down from Xero.
 *
 * Two invariants hold across every resource here, and both exist to make the
 * sync safely re-runnable:
 *
 *   1. Every write is an UPSERT keyed on the Xero id. Running the same sync
 *      twice — a retry, an overlapping cron, a manual "sync now" during a
 *      scheduled run — converges rather than duplicating. The unique partial
 *      indexes on `xeroTransactionId` / `xeroInvoiceId` enforce this at the
 *      database level, so a bug here fails loudly instead of quietly writing
 *      a second copy.
 *
 *   2. The `lastModifiedSince` cursor advances ONLY after a resource's pull
 *      fully succeeds. Advancing it optimistically would permanently skip
 *      every record in a page that failed halfway: the next run asks for
 *      changes after the cursor, so those rows are never seen again.
 *
 * The cursor is also deliberately rewound by a small overlap window on each
 * run — see `cursorFor` below.
 */

export interface SyncOutcome {
  resource: XeroResource;
  created: number;
  updated: number;
  skipped: number;
  truncated: boolean;
}

/**
 * How far to rewind the cursor on each run.
 *
 * Xero's `UpdatedDateUTC` is stamped on their servers, and a record committed
 * during the previous run can carry a timestamp fractionally before the cursor
 * we stored. Asking only for strictly-newer changes would skip it forever.
 * Five minutes of overlap costs a few redundant upserts — which are idempotent
 * — and closes that window.
 */
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

async function cursorFor(tenantId: string, resource: XeroResource): Promise<Date | null> {
  const state = await XeroSyncState.findOne({ tenantId, resource }).lean();
  if (!state?.lastModifiedSince) return null;
  return new Date(state.lastModifiedSince.getTime() - CURSOR_OVERLAP_MS);
}

async function markRunning(tenantId: string, resource: XeroResource): Promise<void> {
  await XeroSyncState.updateOne(
    { tenantId, resource },
    { $set: { status: "running", lastRunAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Records the outcome of a run.
 *
 * `lastModifiedSince` is only written on success, and is set to the time the
 * run STARTED rather than the time it finished. Anything modified while the
 * run was in flight is then picked up next time instead of being stranded
 * between the two timestamps.
 */
async function markFinished(
  tenantId: string,
  resource: XeroResource,
  startedAt: Date,
  outcome: Omit<SyncOutcome, "resource">,
  error: unknown = null,
): Promise<void> {
  if (error !== null) {
    await XeroSyncState.updateOne(
      { tenantId, resource },
      {
        $set: {
          status: "failed",
          lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
        },
      },
      { upsert: true },
    );
    return;
  }

  await XeroSyncState.updateOne(
    { tenantId, resource },
    {
      $set: {
        status: "ok",
        lastError: null,
        lastSuccessAt: new Date(),
        lastCreated: outcome.created,
        lastUpdated: outcome.updated,
        lastSkipped: outcome.skipped,
        // Not advanced on a truncated run: there are more pages behind the
        // hard limit, and moving the cursor would skip them permanently.
        ...(outcome.truncated ? {} : { lastModifiedSince: startedAt }),
      },
    },
    { upsert: true },
  );
}

/** Wraps a resource pull in the run bookkeeping. */
async function runResource(
  tenantId: string,
  resource: XeroResource,
  work: (since: Date | null) => Promise<Omit<SyncOutcome, "resource">>,
): Promise<SyncOutcome> {
  const startedAt = new Date();
  await markRunning(tenantId, resource);

  try {
    const since = await cursorFor(tenantId, resource);
    const outcome = await work(since);
    await markFinished(tenantId, resource, startedAt, outcome);
    return { resource, ...outcome };
  } catch (error) {
    await markFinished(
      tenantId,
      resource,
      startedAt,
      { created: 0, updated: 0, skipped: 0, truncated: false },
      error,
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Accounts (chart of accounts → bank accounts)
// ---------------------------------------------------------------------------

interface XeroAccountPayload {
  AccountID: string;
  Code?: string;
  Name: string;
  Type: string;
  Status?: string;
  CurrencyCode?: string;
  BankAccountNumber?: string;
  UpdatedDateUTC?: string;
}

/**
 * Pulls Xero's BANK accounts and links them to local finance accounts.
 *
 * Only `Type == "BANK"` is imported. The rest of the chart of accounts —
 * revenue, expense, equity — are categories in a double-entry ledger, not
 * places money sits; importing them as `finance_accounts` would add their
 * notional balances into the cash position, which is supposed to answer "how
 * much money do we actually have".
 *
 * A Xero bank account with no local counterpart is CREATED with a zero
 * opening balance. It is deliberately not seeded with Xero's current balance:
 * the transaction pull that follows replays the account's history, and an
 * opening balance on top of that would double-count every entry.
 */
async function syncAccounts(tenantId: string, since: Date | null) {
  const { items, truncated } = await xeroPaged<XeroAccountPayload>(
    tenantId,
    "/Accounts",
    (payload) => payload["Accounts"] as XeroAccountPayload[] | undefined,
    { modifiedSince: since, query: { where: 'Type=="BANK"' } },
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const account of items) {
    if (account.Type?.toUpperCase() !== "BANK") {
      skipped += 1;
      continue;
    }

    const existing = await FinanceAccount.findOne({ xeroAccountId: account.AccountID }).lean();

    if (existing) {
      await FinanceAccount.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: account.Name,
            xeroAccountCode: account.Code ?? null,
            currency: account.CurrencyCode ?? existing.currency,
            // ARCHIVED in Xero means the account is closed. Deactivating
            // rather than deleting keeps its transactions and its history.
            isActive: (account.Status ?? "ACTIVE").toUpperCase() === "ACTIVE",
            xeroSyncedAt: new Date(),
          },
        },
      );
      updated += 1;
      continue;
    }

    await FinanceAccount.create({
      name: account.Name,
      type: "bank",
      currency: account.CurrencyCode ?? "USD",
      openingBalance: toDecimal128("0"),
      currentBalance: toDecimal128("0"),
      isActive: (account.Status ?? "ACTIVE").toUpperCase() === "ACTIVE",
      xeroAccountId: account.AccountID,
      xeroAccountCode: account.Code ?? null,
      xeroSyncedAt: new Date(),
    });
    created += 1;
  }

  return { created, updated, skipped, truncated };
}

// ---------------------------------------------------------------------------
// Bank transactions
// ---------------------------------------------------------------------------

interface XeroBankTransactionPayload {
  BankTransactionID: string;
  Type: string;
  Status?: string;
  Date?: string;
  Reference?: string;
  Total?: number;
  IsReconciled?: boolean;
  UpdatedDateUTC?: string;
  BankAccount?: { AccountID?: string; Name?: string };
  Contact?: { ContactID?: string; Name?: string };
  LineItems?: { Description?: string; AccountCode?: string }[];
}

/**
 * Pulls bank transactions into `finance_transactions`.
 *
 * Four categories are skipped, each for a specific reason:
 *
 *   - DELETED / VOIDED status: these are not entries, they are the absence of
 *     one. An existing local row for a now-voided transaction is REVERSED
 *     rather than deleted, preserving the never-delete rule (§9).
 *   - TRANSFER types: a transfer between two linked bank accounts appears
 *     once from each side and would be counted twice.
 *   - Transactions on an account this system has not linked: there is nowhere
 *     to put them, and inventing an account would create a balance nobody
 *     asked for.
 *   - Unrecognised `Type` values: better skipped and counted than guessed at,
 *     since guessing the direction wrong inverts a balance.
 */
async function syncBankTransactions(tenantId: string, since: Date | null) {
  const { items, truncated } = await xeroPaged<XeroBankTransactionPayload>(
    tenantId,
    "/BankTransactions",
    (payload) => payload["BankTransactions"] as XeroBankTransactionPayload[] | undefined,
    { modifiedSince: since },
  );

  // Linked accounts, resolved once rather than per transaction.
  const linked = await FinanceAccount.find({ xeroAccountId: { $ne: null } })
    .select("_id xeroAccountId")
    .lean();
  const accountByXeroId = new Map(
    linked
      .filter((a): a is typeof a & { xeroAccountId: string } => a.xeroAccountId !== null)
      .map((a) => [a.xeroAccountId, a._id]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const touchedAccounts = new Set<string>();

  for (const txn of items) {
    const status = (txn.Status ?? "AUTHORISED").toUpperCase();
    const xeroAccountId = txn.BankAccount?.AccountID;
    const localAccountId = xeroAccountId ? accountByXeroId.get(xeroAccountId) : undefined;

    if (!localAccountId || isTransferType(txn.Type)) {
      skipped += 1;
      continue;
    }

    /**
     * A transaction voided or deleted upstream.
     *
     * If it was never imported, skip it. If it WAS imported, it has already
     * moved a balance here, so it must be undone — and the only sanctioned way
     * to undo anything in this ledger is an offsetting reversal (§9). Deleting
     * the row would silently rewrite history that a published report may
     * already have reported on.
     */
    if (status === "DELETED" || status === "VOIDED") {
      const existing = await FinanceTransaction.findOne({
        xeroTransactionId: txn.BankTransactionID,
      }).lean();

      // `== null` rather than `=== null`: a lean document written before the
      // field existed reads back `undefined`, and a strict check would treat
      // such a row as an existing reversal and decline to reverse it — leaving
      // a voided transaction counted in the balance permanently.
      if (existing && !existing.isReversed && existing.reversesTransactionId == null) {
        await withTransaction("xeroVoidReversal", async (session) => {
          await FinanceTransaction.create(
            [
              {
                accountId: existing.accountId,
                date: currentDate(),
                type: existing.type === "debit" ? "credit" : "debit",
                amount: existing.amount,
                category: existing.category,
                counterparty: existing.counterparty,
                description: `Reversal of ${existing._id}: voided in Xero`,
                referenceNo: existing.referenceNo,
                isDlap: existing.isDlap,
                dlapSharePct: existing.dlapSharePct,
                source: "xero-sync",
                reversesTransactionId: existing._id,
                createdBy: null,
              },
            ],
            { session, ordered: true },
          );

          await FinanceTransaction.updateOne(
            { _id: existing._id },
            { $set: { isReversed: true } },
            { session },
          );

          await recomputeAccountBalance(existing.accountId, session);
        });
        touchedAccounts.add(existing.accountId);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const type = xeroTypeToTransactionType(txn.Type);
    if (type === null) {
      skipped += 1;
      continue;
    }

    const date = parseXeroDateOnly(txn.Date);
    if (date === null) {
      skipped += 1;
      continue;
    }

    const amount = xeroAmountToString(txn.Total);
    // Xero permits a zero-total transaction; this ledger's `amount > 0` check
    // does not, and a zero entry moves no balance anyway.
    if (Number(amount) <= 0) {
      skipped += 1;
      continue;
    }

    const description =
      txn.LineItems?.map((line) => line.Description).filter(Boolean).join("; ") || null;

    const fields = {
      accountId: localAccountId,
      date: toDateOnly(new Date(`${date}T00:00:00Z`)),
      type,
      amount: toDecimal128(amount),
      counterparty: txn.Contact?.Name ?? null,
      description,
      referenceNo: txn.Reference ?? null,
      source: "xero-sync" as const,
      xeroTransactionId: txn.BankTransactionID,
      xeroUpdatedAt: parseXeroDate(txn.UpdatedDateUTC),
    };

    /**
     * A single atomic upsert keyed on the Xero id.
     *
     * NOT `findOne`-then-`create`: that pair is a check-then-act race, and two
     * overlapping runs — a manual "sync now" during the 03:30 cron, or a
     * retried invocation — can both observe "not present" and both insert. The
     * unique partial index then rejects the loser with a duplicate-key error,
     * which aborts the whole resource and discards its cursor advance.
     *
     * Letting the database resolve it means a concurrent run converges instead
     * of failing, which is the property the index was added for.
     *
     * An upstream EDIT updates in place rather than being reversed and
     * reposted: Xero treats an edit as the same entry (its id is unchanged),
     * and creating a reversal pair for every upstream typo correction would
     * bury the real reversals in noise.
     */
    const result = await FinanceTransaction.updateOne(
      { xeroTransactionId: txn.BankTransactionID },
      {
        $set: fields,
        // Only on insert — an edit must not reset the creator or resurrect a
        // row that was reversed here.
        $setOnInsert: { createdBy: null },
      },
      { upsert: true },
    );

    touchedAccounts.add(localAccountId);
    if (result.upsertedCount > 0) created += 1;
    else updated += 1;
  }

  /**
   * Balances are recomputed once per touched account at the end, not per row.
   *
   * `recomputeAccountBalance` replays the account's whole history, so calling
   * it inside the loop is O(transactions²) on a first sync. The trade is that
   * balances are briefly stale mid-run — acceptable here because the sync is
   * not the write path a user is watching, and unlike `createTransaction`
   * there is no user-visible moment between the two.
   */
  for (const accountId of touchedAccounts) {
    await withTransaction("xeroSyncRecompute", (session) =>
      recomputeAccountBalance(accountId, session),
    );
  }

  return { created, updated, skipped, truncated };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

interface XeroContactPayload {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  ContactStatus?: string;
  UpdatedDateUTC?: string;
}

async function syncContacts(tenantId: string, since: Date | null) {
  const { items, truncated } = await xeroPaged<XeroContactPayload>(
    tenantId,
    "/Contacts",
    (payload) => payload["Contacts"] as XeroContactPayload[] | undefined,
    { modifiedSince: since },
  );

  let created = 0;
  let updated = 0;

  for (const contact of items) {
    const result = await XeroContact.updateOne(
      { xeroContactId: contact.ContactID },
      {
        $set: {
          tenantId,
          name: contact.Name,
          emailAddress: contact.EmailAddress ?? null,
          isCustomer: contact.IsCustomer ?? false,
          isSupplier: contact.IsSupplier ?? false,
          contactStatus: contact.ContactStatus ?? null,
          xeroUpdatedAt: parseXeroDate(contact.UpdatedDateUTC),
          syncedAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) created += 1;
    else updated += 1;
  }

  return { created, updated, skipped: 0, truncated };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

interface XeroInvoicePayload {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  Type: string;
  Status: string;
  CurrencyCode?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  Date?: string;
  DueDate?: string;
  FullyPaidOnDate?: string;
  UpdatedDateUTC?: string;
  Contact?: { ContactID?: string; Name?: string };
}

/**
 * Pulls invoices, splitting them by direction.
 *
 *   ACCREC (sales invoices)  → `xero_invoices`, which is what "outstanding
 *                              receivables" is computed from.
 *   ACCPAY (bills)           → `finance_creditors`, which is the payables
 *                              register the finance team already works from.
 *
 * A bill synced into `finance_creditors` carries `xeroInvoiceId`, and the
 * creditors route refuses to hand-edit the status of such a row — Xero owns
 * it, and an edit here would be overwritten by the next sync without warning.
 */
async function syncInvoices(tenantId: string, since: Date | null) {
  const { items, truncated } = await xeroPaged<XeroInvoicePayload>(
    tenantId,
    "/Invoices",
    (payload) => payload["Invoices"] as XeroInvoicePayload[] | undefined,
    { modifiedSince: since },
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const invoice of items) {
    const type = invoice.Type?.toUpperCase();
    const status = invoice.Status?.toUpperCase() ?? "DRAFT";

    if (type === "ACCREC") {
      const result = await XeroInvoice.updateOne(
        { xeroInvoiceId: invoice.InvoiceID },
        {
          $set: {
            tenantId,
            invoiceNumber: invoice.InvoiceNumber ?? null,
            reference: invoice.Reference ?? null,
            contactId: invoice.Contact?.ContactID ?? null,
            contactName: invoice.Contact?.Name ?? null,
            status,
            currency: invoice.CurrencyCode ?? "USD",
            subTotal: toDecimal128(xeroAmountToString(invoice.SubTotal)),
            totalTax: toDecimal128(xeroAmountToString(invoice.TotalTax)),
            total: toDecimal128(xeroAmountToString(invoice.Total)),
            amountDue: toDecimal128(xeroAmountToString(invoice.AmountDue)),
            amountPaid: toDecimal128(xeroAmountToString(invoice.AmountPaid)),
            issueDate: dateOrNull(invoice.Date),
            dueDate: dateOrNull(invoice.DueDate),
            fullyPaidOnDate: dateOrNull(invoice.FullyPaidOnDate),
            xeroUpdatedAt: parseXeroDate(invoice.UpdatedDateUTC),
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      );

      if (result.upsertedCount > 0) created += 1;
      else updated += 1;
      continue;
    }

    if (type === "ACCPAY") {
      const amountDue = xeroAmountToString(invoice.AmountDue);
      const amountPaid = xeroAmountToString(invoice.AmountPaid);

      /**
       * A fully settled or voided bill with nothing outstanding is still
       * upserted (so a previously-outstanding row flips to `paid`), but a bill
       * that was never seen here AND is already settled is skipped — importing
       * a historical paid bill adds a row to the payables register that nobody
       * needs to act on.
       */
      const existing = await FinanceCreditor.findOne({
        xeroInvoiceId: invoice.InvoiceID,
      }).lean();

      if (!existing && Number(amountDue) <= 0) {
        skipped += 1;
        continue;
      }

      const creditorStatus = xeroInvoiceStatusToCreditorStatus(status, Number(amountPaid));

      const result = await FinanceCreditor.updateOne(
        { xeroInvoiceId: invoice.InvoiceID },
        {
          $set: {
            name: invoice.Contact?.Name ?? invoice.InvoiceNumber ?? "Unknown supplier",
            /**
             * `amountOwed` tracks what is still DUE, not the invoice total —
             * the payables register answers "what do we still owe".
             *
             * Zero is stored as zero on a settled bill. The `positiveMoneyString`
             * rule that forbids that applies to HAND-ENTERED creditors, where a
             * zero row is a data-entry mistake; here it is a fact, and floring
             * it to a token amount would invent a debt that does not exist and
             * would then be summed into the payables total.
             */
            amountOwed: toDecimal128(amountDue),
            dueDate: dateOrNull(invoice.DueDate),
            status: creditorStatus,
            xeroContactId: invoice.Contact?.ContactID ?? null,
            xeroSyncedAt: new Date(),
          },
        },
        { upsert: true },
      );

      if (result.upsertedCount > 0) created += 1;
      else updated += 1;
      continue;
    }

    skipped += 1;
  }

  return { created, updated, skipped, truncated };
}

/** Xero date → a date-only Date, or null. */
function dateOrNull(value: unknown): Date | null {
  const day = parseXeroDateOnly(value);
  return day === null ? null : toDateOnly(new Date(`${day}T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Runs a full sync for one tenant.
 *
 * Order matters: accounts before transactions (a transaction needs its account
 * linked, or it is skipped), contacts before invoices (for the name lookup).
 * Sequential rather than parallel — Xero's concurrency limit is 5 per tenant
 * and the paged pulls inside each resource already use it.
 *
 * A failure in one resource does not abort the rest. Each records its own
 * failure state, and a Xero outage mid-run should not leave four resources
 * un-synced because the first one timed out.
 */
export async function syncTenant(
  tenantId: string,
  resources: XeroResource[] = ["accounts", "contacts", "bank-transactions", "invoices"],
): Promise<{ outcomes: SyncOutcome[]; errors: { resource: XeroResource; message: string }[] }> {
  const outcomes: SyncOutcome[] = [];
  const errors: { resource: XeroResource; message: string }[] = [];

  const runners: Record<string, (since: Date | null) => Promise<Omit<SyncOutcome, "resource">>> = {
    accounts: (since) => syncAccounts(tenantId, since),
    contacts: (since) => syncContacts(tenantId, since),
    "bank-transactions": (since) => syncBankTransactions(tenantId, since),
    invoices: (since) => syncInvoices(tenantId, since),
  };

  for (const resource of resources) {
    const runner = runners[resource];
    if (!runner) continue;

    try {
      outcomes.push(await runResource(tenantId, resource, runner));
    } catch (error) {
      errors.push({
        resource,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { outcomes, errors };
}
