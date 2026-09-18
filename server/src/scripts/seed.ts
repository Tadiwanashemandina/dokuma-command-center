import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "../db/connection.js";
import { currentDate } from "../db/types.js";
import {
  ActivityRecord,
  AiDailyBrief,
  Client,
  DeliveryMetric,
  FinanceAccount,
  FinanceCompanyTotals,
  FinanceCreditor,
  FinancePaymentNotice,
  FinanceTransaction,
  Meeting,
  MeetingActionItem,
  Milestone,
  Project,
  ProjectFinance,
  RiskIssueDecision,
  Task,
  ensureIndexes,
  resetDatabase,
} from "../db/models/index.js";
import { recomputeAccountBalance } from "../services/finance/balances.js";
import { refreshKpiFeed } from "../services/kpi.js";
import {
  ACTIVITY_RECORDS,
  CLIENTS,
  COMPANY_TOTALS,
  DAILY_BRIEF,
  DELIVERY_REPOS,
  MEETINGS,
  PROJECTS,
  RISKS,
  TASK_ASSIGNEES_DUE,
  TASK_ASSIGNEES_OVERDUE,
  TASK_STATUSES,
  dateOffset,
} from "./seed-data.js";

/**
 * Idempotent seed.
 *
 * The SQL seeds were explicitly NOT idempotent — the README warns that
 * re-running duplicates rows, and seed_finance.sql repeats the warning in its
 * header. That is a genuine footgun, so this version resets the collections it
 * owns before inserting. Prompt 3 asks for "an idempotent seed process".
 *
 *   npm run db:seed --workspace @dokuma/server
 *
 * Refuses to run against a database whose name does not look disposable unless
 * SEED_ALLOW_NON_DEV=true, so a stray invocation cannot wipe production.
 *
 * The CEO KPI figures reproduce the exact confirmed values from the concept
 * doc: 12 projects (7 green / 3 amber / 2 red), 6 critical blockers across
 * 3 distinct projects, USD 4.2m / 2.1m / 480k, 78.0% utilisation. Tasks due
 * this week (87) and overdue (19) are rolling windows that drift as real dates
 * pass — documented expected behavior, not a bug.
 */

function assertDisposableDatabase(): void {
  const name = mongoose.connection.name;
  const looksDisposable = /(^|[-_])(dev|test|local|seed|dokuma)($|[-_])/i.test(name);

  if (!looksDisposable && process.env["SEED_ALLOW_NON_DEV"] !== "true") {
    throw new Error(
      `Refusing to seed database "${name}": the name does not look like a development or ` +
        `test database. Set SEED_ALLOW_NON_DEV=true to override.`,
    );
  }
}

async function seedPortfolio(): Promise<Map<string, string>> {
  const clientIds = new Map<string, string>();
  for (const client of CLIENTS) {
    const id = randomUUID();
    await Client.create({ _id: id, ...client });
    clientIds.set(client.name, id);
  }

  const projectIds = new Map<string, string>();
  for (const project of PROJECTS) {
    const id = randomUUID();
    await Project.create({
      _id: id,
      name: project.name,
      ownerName: project.ownerName,
      status: project.status,
      budgetUsd: project.budgetUsd,
      startDate: dateOffset(project.start),
      targetEndDate: dateOffset(project.end),
      description: project.description,
      clientId: clientIds.get(project.client) ?? null,
    });
    projectIds.set(project.name, id);
  }

  // Two milestones per project, matching the cross-join in seed.sql.
  for (const projectId of projectIds.values()) {
    await Milestone.create([
      {
        _id: randomUUID(),
        projectId,
        name: "Requirements sign-off",
        dueDate: dateOffset(-20),
        status: "done",
      },
      {
        _id: randomUUID(),
        projectId,
        name: "Go-live readiness review",
        dueDate: dateOffset(15),
        status: "on_track",
      },
    ]);
  }

  // The SQL used `array_agg(id order by name)`, and the modulo indexing below
  // depends on that same ordering.
  const orderedProjectIds = [...projectIds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, id]) => id);

  const pick = <T>(arr: readonly T[], n: number): T => arr[n % arr.length]!;

  // Exactly 87 open tasks due within the next 7 days.
  const dueTasks = Array.from({ length: 87 }, (_, n) => ({
    _id: randomUUID(),
    projectId: pick(orderedProjectIds, n),
    title: `Due-this-week task ${n}`,
    assigneeName: pick(TASK_ASSIGNEES_DUE, n),
    dueDate: dateOffset(n % 8),
    status: pick(TASK_STATUSES, n),
  }));

  // Exactly 19 open tasks already overdue.
  const overdueTasks = Array.from({ length: 19 }, (_, n) => ({
    _id: randomUUID(),
    projectId: pick(orderedProjectIds, n),
    title: `Overdue task ${n}`,
    assigneeName: pick(TASK_ASSIGNEES_OVERDUE, n),
    dueDate: dateOffset(-(1 + (n % 14))),
    status: pick(TASK_STATUSES, n),
  }));

  // Completed tasks for realism — excluded from both KPI windows by status.
  const doneTasks = Array.from({ length: 20 }, (_, n) => ({
    _id: randomUUID(),
    projectId: pick(orderedProjectIds, n),
    title: `Completed task ${n}`,
    assigneeName: "Team",
    dueDate: dateOffset(-(5 + n)),
    status: "done" as const,
  }));

  await Task.insertMany([...dueTasks, ...overdueTasks, ...doneTasks]);

  for (const risk of RISKS) {
    await RiskIssueDecision.create({
      _id: randomUUID(),
      type: risk.type,
      title: risk.title,
      description: risk.description,
      projectId: risk.project === null ? null : (projectIds.get(risk.project) ?? null),
      ownerName: risk.ownerName,
      dueDate: dateOffset(risk.dueOffset),
      severity: risk.severity,
      probability: risk.probability,
      impact: risk.impact,
      status: risk.status,
      department: risk.department,
    });
  }

  return projectIds;
}

async function seedFinanceSnapshot(projectIds: Map<string, string>): Promise<void> {
  await FinanceCompanyTotals.create({
    _id: randomUUID(),
    asOfDate: currentDate(),
    ...COMPANY_TOTALS,
  });

  // project_finance derives from each project's budget. The SQL used a random
  // 0.35–0.70 factor for cost_to_date; a deterministic factor is used here so
  // repeated seeds produce identical data and margin assertions stay stable.
  for (const project of PROJECTS) {
    const budget = Number.parseFloat(project.budgetUsd);
    const costFactor = 0.35 + ((project.name.length % 8) / 8) * 0.35;

    await ProjectFinance.create({
      _id: randomUUID(),
      projectId: projectIds.get(project.name)!,
      budgetUsd: project.budgetUsd,
      costToDateUsd: (budget * costFactor).toFixed(2),
      revenuePipelineUsd: (budget * 0.4).toFixed(2),
      contractedRevenueUsd: (budget * 0.55).toFixed(2),
      receivablesUsd: (budget * 0.08).toFixed(2),
      asOfDate: currentDate(),
    });
  }
}

async function seedActivityAndDelivery(projectIds: Map<string, string>): Promise<void> {
  for (const record of ACTIVITY_RECORDS) {
    await ActivityRecord.create({
      _id: randomUUID(),
      personName: record.personName,
      role: record.role,
      department: record.department,
      // LazyBoss rule: activity_date is ALWAYS the import date (D-18).
      activityDate: currentDate(),
      hoursToday: record.hoursToday,
      onProjectMinutes: record.on,
      offProjectMinutes: record.off,
      screenshotsCount: record.screenshots,
      storageUsedMb: record.storageMb,
      lastSeenAt: new Date(Date.now() - record.lastSeenMinutesAgo * 60_000),
      status: record.status,
      source: "csv",
    });
  }

  for (const repo of DELIVERY_REPOS) {
    for (let d = 0; d <= 6; d += 1) {
      await DeliveryMetric.create({
        _id: randomUUID(),
        projectId: projectIds.get(repo.project) ?? null,
        repoName: repo.repo,
        metricDate: dateOffset(-d),
        commitsCount: repo.commitsBase + (d % repo.commitsMod),
        deploysCount: repo.deployEvery > 0 && d % repo.deployEvery === 0 ? 1 : 0,
        openDefectsCount: repo.openBase + (d % repo.openMod),
        closedDefectsCount: d % repo.closedMod,
        source: "illustrative",
      });
    }
  }
}

async function seedMeetingsAndBrief(): Promise<void> {
  for (const meeting of MEETINGS) {
    const meetingId = randomUUID();
    await Meeting.create({
      _id: meetingId,
      title: meeting.title,
      meetingDate: dateOffset(meeting.dateOffset),
      attendees: [...meeting.attendees],
      sourceNotes: meeting.sourceNotes,
    });

    for (const item of meeting.actionItems) {
      await MeetingActionItem.create({
        _id: randomUUID(),
        meetingId,
        description: item.description,
        ownerName: item.ownerName,
        dueDate: dateOffset(item.dueOffset),
        status: item.status,
      });
    }
  }

  await AiDailyBrief.create({
    _id: randomUUID(),
    briefDate: currentDate(),
    ...DAILY_BRIEF,
  });
}

/** Ported from seed_finance.sql. */
async function seedFinanceModule(): Promise<void> {
  const accounts = [
    { name: "Dokuma Operating Account", type: "bank", opening: "50000.00" },
    { name: "Dokuma Petty Cash", type: "cash", opening: "2000.00" },
    { name: "EcoCash Merchant", type: "mobile-money", opening: "5000.00" },
  ] as const;

  const accountIds = new Map<string, string>();
  for (const account of accounts) {
    const id = randomUUID();
    await FinanceAccount.create({
      _id: id,
      name: account.name,
      type: account.type,
      currency: "USD",
      openingBalance: account.opening,
      currentBalance: account.opening,
      isActive: true,
    });
    accountIds.set(account.name, id);
  }

  const operatingId = accountIds.get("Dokuma Operating Account")!;

  // ~25 days of ordinary transactions, so the 30-day trailing average behind
  // the unusual-transaction check has real data.
  for (let n = 1; n <= 25; n += 1) {
    const isDlap = n % 4 === 0;
    await FinanceTransaction.create({
      _id: randomUUID(),
      accountId: operatingId,
      date: dateOffset(-n),
      type: n % 3 === 0 ? "credit" : "debit",
      amount: (400 + ((n * 17) % 600)).toFixed(2),
      category: isDlap ? "DLAP conveyancer fees" : "Operating expenses",
      counterparty: isDlap ? "Independent Conveyancer Network" : "Various",
      description: `Routine transaction ${n}`,
      isDlap,
      dlapSharePct: isDlap ? "15.00" : null,
      source: "manual",
    });
  }

  // One deliberately oversized transaction today — well over 2x the ~$650
  // trailing average — so the daily report's unusual-transaction flag has
  // something real to catch during verification.
  await FinanceTransaction.create({
    _id: randomUUID(),
    accountId: operatingId,
    date: currentDate(),
    type: "debit",
    amount: "9500.00",
    category: "Equipment purchase",
    counterparty: "Regional IT Suppliers",
    description: "Bulk laptop purchase for the Bulawayo onboarding team",
    source: "manual",
  });

  const pettyCashId = accountIds.get("Dokuma Petty Cash")!;
  const ecocashId = accountIds.get("EcoCash Merchant")!;

  const otherTransactions = [
    { accountId: pettyCashId, offset: -2, type: "debit", amount: "85.00", category: "Office supplies", counterparty: "Local vendor", description: "Stationery" },
    { accountId: pettyCashId, offset: -1, type: "debit", amount: "40.00", category: "Transport", counterparty: "Taxi", description: "Client visit transport" },
    { accountId: ecocashId, offset: -3, type: "credit", amount: "1200.00", category: "Client payment", counterparty: "Independent Conveyancer Network", description: "Mobile money receipt" },
    { accountId: ecocashId, offset: -1, type: "debit", amount: "300.00", category: "Vendor payment", counterparty: "Local supplier", description: "Mobile money payout" },
  ] as const;

  for (const txn of otherTransactions) {
    await FinanceTransaction.create({
      _id: randomUUID(),
      accountId: txn.accountId,
      date: dateOffset(txn.offset),
      type: txn.type,
      amount: txn.amount,
      category: txn.category,
      counterparty: txn.counterparty,
      description: txn.description,
      source: "manual",
    });
  }

  // The balance trigger fires per insert in Postgres; applying it once per
  // account after the bulk load reaches the same end state.
  for (const accountId of accountIds.values()) {
    await recomputeAccountBalance(accountId);
  }

  await FinanceCreditor.insertMany([
    { _id: randomUUID(), name: "Regional IT Suppliers", amountOwed: "9500.00", dueDate: dateOffset(14), status: "outstanding", notes: "Bulk laptop purchase, Net 30 terms." },
    { _id: randomUUID(), name: "Harare Office Landlord", amountOwed: "1800.00", dueDate: dateOffset(5), status: "outstanding", notes: "Monthly office rent." },
    { _id: randomUUID(), name: "Zesa Holdings", amountOwed: "420.00", dueDate: dateOffset(-3), status: "partially_paid", notes: "Electricity — partial payment made." },
  ]);

  // `to_char(current_date, 'FMMonth YYYY')` → e.g. "September 2026".
  const period = currentDate().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  await FinancePaymentNotice.insertMany([
    { _id: randomUUID(), period, payee: "Regional IT Suppliers", amount: "9500.00", dueDate: dateOffset(14), status: "scheduled", notes: null },
    { _id: randomUUID(), period, payee: "Harare Office Landlord", amount: "1800.00", dueDate: dateOffset(5), status: "scheduled", notes: null },
    { _id: randomUUID(), period, payee: "Zesa Holdings", amount: "210.00", dueDate: dateOffset(10), status: "sent", notes: "Remaining balance after partial payment." },
  ]);
}

/**
 * Seeds every collection, assuming an open connection.
 *
 * Exported so the verification script can seed the disposable replica set it
 * already owns, instead of shelling out to this file and having to hand it a
 * connection string. Resets first, so it is safe to call twice.
 */
export async function seedAll({ quiet = false }: { quiet?: boolean } = {}): Promise<void> {
  const log = (message: string) => {
    if (!quiet) console.log(message);
  };

  log("[seed] resetting owned collections…");
  await resetDatabase();

  log("[seed] ensuring indexes…");
  await ensureIndexes();

  log("[seed] portfolio (clients, projects, milestones, tasks, risks)…");
  const projectIds = await seedPortfolio();

  log("[seed] finance snapshot…");
  await seedFinanceSnapshot(projectIds);

  log("[seed] activity + delivery metrics…");
  await seedActivityAndDelivery(projectIds);

  log("[seed] meetings + daily brief…");
  await seedMeetingsAndBrief();

  log("[seed] finance module (accounts, transactions, creditors, notices)…");
  await seedFinanceModule();

  log("[seed] refreshing KPI feed…");
  await refreshKpiFeed();
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertDisposableDatabase();

  console.log(`[seed] database: "${mongoose.connection.name}"`);
  await seedAll();
  console.log("[seed] done.");

  await disconnectFromDatabase();
}

/**
 * Only run as a CLI when this file is the entry point. Without the guard,
 * importing `seedAll` would also kick off a full seed against whatever
 * MONGODB_URI happened to be set.
 */
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
    void disconnectFromDatabase();
  });
}
