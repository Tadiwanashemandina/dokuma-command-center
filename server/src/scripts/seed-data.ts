/**
 * The seed dataset, ported from supabase/seed.sql, seed_finance.sql and
 * seed_hr.sql.
 *
 * The CEO KPI figures are EXACT confirmed values from the Dokuma AI Executive
 * Command Centre concept doc and must reproduce precisely:
 *
 *   12 active projects · 7 Green / 3 Amber / 2 Red · 6 critical blockers
 *   USD 4.2m pipeline · USD 2.1m contracted · USD 480k receivables
 *   78.0% team utilisation · 3 high-risk projects
 *
 * "Tasks due this week" (87) and "Overdue tasks" (19) are rolling,
 * date-relative windows: they land on exactly 87/19 the moment the seed runs
 * and drift as real dates pass. That is documented expected behavior, not a
 * bug (seed.sql header, README).
 */

import { addDays, currentDate } from "../db/types.js";

/**
 * `current_date + offset`, as a UTC-midnight Date.
 *
 * Date-only columns are stored as UTC midnight (see `db/types.ts`), so every
 * offset the SQL seeds expressed as `current_date + interval 'n days'` is
 * built through the same normalizer the schemas use.
 */
export function dateOffset(days: number): Date {
  return addDays(currentDate(), days);
}

export const CLIENTS = [
  {
    name: "Deeds Registries Department",
    industry: "Government / Public Sector",
    primaryContactName: "S. Chikwanha",
    primaryContactEmail: "schikwanha@deeds.gov.zw",
    relationshipOwner: "Webster Maposa",
    tier: "strategic",
    notes:
      "Government partner under the DLAP arrangement — data residency and classification safeguards apply.",
    department: null,
  },
  {
    name: "Fossil Group Holdings",
    industry: "Group / Conglomerate",
    primaryContactName: "Collins Jimu",
    primaryContactEmail: "collins.jimu@fossilgroup.com",
    relationshipOwner: "Webster Maposa",
    tier: "strategic",
    notes:
      "Group Digital Transformation Initiative sponsor; Dokuma architecture proposed as Group platform core.",
    department: null,
  },
  {
    name: "Independent Conveyancer Network",
    industry: "Legal Services",
    primaryContactName: "T. Mangwiro",
    primaryContactEmail: "t.mangwiro@iconveyancers.co.zw",
    relationshipOwner: "Don Yambira",
    tier: "key",
    notes: "Represents the 300+ firm / 1,000+ conveyancer onboarding programme.",
    // Tagged 'finance' by migration 0030's backfill.
    department: "finance",
  },
  {
    name: "Dokuma Internal",
    industry: "Internal",
    primaryContactName: "Lorraine Shoko",
    primaryContactEmail: "lorraine.shoko@dokuma.co.zw",
    relationshipOwner: "Lorraine Shoko",
    tier: "standard",
    notes: "Internal-only initiatives with no external client.",
    department: "finance",
  },
] as const;

/** 7 green / 3 amber / 2 red = 12 total. */
export const PROJECTS = [
  { name: "DLAP Conveyancer Onboarding Phase 2", ownerName: "Don Yambira", status: "green", budgetUsd: "620000.00", start: -120, end: 60, description: "Onboarding the next tranche of conveyancer firms onto the DLAP platform.", client: "Independent Conveyancer Network" },
  { name: "Client Portal Revamp", ownerName: "Tanaka Mangwiro", status: "green", budgetUsd: "180000.00", start: -60, end: 45, description: "Redesign of the client-facing conveyancer portal.", client: "Independent Conveyancer Network" },
  { name: "Finance Reporting Automation", ownerName: "Lorraine Shoko", status: "green", budgetUsd: "95000.00", start: -90, end: 20, description: "Automating monthly management accounts preparation.", client: "Dokuma Internal" },
  { name: "Mobile App v2 Rollout", ownerName: "Nicole Maposa", status: "green", budgetUsd: "210000.00", start: -75, end: 30, description: "Second-generation Dokuma mobile application.", client: "Dokuma Internal" },
  { name: "AI Daily Brief Rollout", ownerName: "Godwin Ndarevani", status: "green", budgetUsd: "60000.00", start: -30, end: 40, description: "Executive daily brief generation pipeline.", client: "Dokuma Internal" },
  { name: "BYO3 Admin Register Automation", ownerName: "Tribute Mhaka", status: "green", budgetUsd: "130000.00", start: -100, end: 15, description: "Automating the Bulawayo Phase 3 admin register.", client: "Independent Conveyancer Network" },
  { name: "Group Command Centre Integration", ownerName: "Webster Maposa", status: "green", budgetUsd: "340000.00", start: -45, end: 90, description: "Aligning Dokuma's command centre architecture with the Group platform.", client: "Fossil Group Holdings" },
  { name: "eConveyancer Platform Upgrade", ownerName: "Jethro Sithole", status: "amber", budgetUsd: "275000.00", start: -80, end: 25, description: "Core platform upgrade for the eConveyancer application.", client: "Independent Conveyancer Network" },
  { name: "Data Warehouse Migration", ownerName: "Mphokuhle Ncube", status: "amber", budgetUsd: "150000.00", start: -50, end: 35, description: "Migrating reporting data to the new warehouse.", client: "Dokuma Internal" },
  { name: "Regional Expansion — Eswatini", ownerName: "Collins Jimu", status: "amber", budgetUsd: "400000.00", start: -40, end: 120, description: "Extending DLAP-style delivery into Eswatini.", client: "Fossil Group Holdings" },
  { name: "Deeds Registries API Integration", ownerName: "Webster Maposa", status: "red", budgetUsd: "220000.00", start: -150, end: -10, description: "Direct API integration with the Deeds Registries Department — behind schedule.", client: "Deeds Registries Department" },
  { name: "Security & Compliance Hardening", ownerName: "Collins Jimu", status: "red", budgetUsd: "110000.00", start: -70, end: 5, description: "Zimbabwe Cyber and Data Protection Act alignment work — critical path blocked.", client: "Dokuma Internal" },
] as const;

export const TASK_ASSIGNEES_DUE = [
  "Tanaka Mangwiro", "Nicole Maposa", "Godwin Ndarevani", "Tribute Mhaka",
  "Jethro Sithole", "Mphokuhle Ncube", "Don Yambira", "Lorraine Shoko",
  "Collins Jimu", "Webster Maposa",
] as const;

export const TASK_ASSIGNEES_OVERDUE = [
  "Tanaka Mangwiro", "Nicole Maposa", "Godwin Ndarevani", "Tribute Mhaka",
  "Jethro Sithole", "Mphokuhle Ncube", "Don Yambira", "Lorraine Shoko",
] as const;

export const TASK_STATUSES = ["todo", "in_progress", "blocked"] as const;

/**
 * 6 open critical risks across exactly 3 distinct projects, so
 * critical_blockers = 6 and high_risk_projects = 3.
 */
export const RISKS = [
  { type: "risk", title: "Deeds Registries API contract delay", description: "Government counterpart has not confirmed the integration contract window.", project: "Deeds Registries API Integration", ownerName: "Webster Maposa", dueOffset: 5, severity: "critical", probability: "high", impact: "high", status: "open", department: null },
  { type: "risk", title: "Legacy API rate limits", description: "Deeds Registries legacy endpoint throttles under production load.", project: "Deeds Registries API Integration", ownerName: "Collins Jimu", dueOffset: 10, severity: "critical", probability: "medium", impact: "high", status: "open", department: null },
  { type: "risk", title: "Compliance sign-off outstanding", description: "Zimbabwe Cyber and Data Protection Act review not yet signed off by legal.", project: "Security & Compliance Hardening", ownerName: "Collins Jimu", dueOffset: 3, severity: "critical", probability: "high", impact: "high", status: "open", department: null },
  { type: "risk", title: "Penetration test findings unresolved", description: "Three high-severity findings from the last pentest remain open.", project: "Security & Compliance Hardening", ownerName: "Jethro Sithole", dueOffset: 7, severity: "critical", probability: "high", impact: "high", status: "open", department: null },
  { type: "risk", title: "Warehouse migration data-loss exposure", description: "Cutover plan has no verified rollback path yet.", project: "Data Warehouse Migration", ownerName: "Mphokuhle Ncube", dueOffset: 12, severity: "critical", probability: "medium", impact: "high", status: "open", department: null },
  { type: "risk", title: "Reporting downtime during cutover", description: "Executive reporting will be unavailable for an unconfirmed window during migration.", project: "Data Warehouse Migration", ownerName: "Lorraine Shoko", dueOffset: 12, severity: "critical", probability: "medium", impact: "medium", status: "open", department: null },
  { type: "issue", title: "Eswatini data residency clarification needed", description: "Hosting location not yet confirmed against local regulation.", project: "Regional Expansion — Eswatini", ownerName: "Collins Jimu", dueOffset: 20, severity: "high", probability: null, impact: null, status: "open", department: null },
  { type: "issue", title: "Conveyancer training backlog", description: "Several firms still awaiting onboarding training slots.", project: "DLAP Conveyancer Onboarding Phase 2", ownerName: "Don Yambira", dueOffset: 8, severity: "medium", probability: null, impact: null, status: "mitigating", department: null },
  // The four titles below are tagged 'finance' by migration 0030's backfill.
  { type: "decision", title: "Approve Phase 3 budget contingency", description: "Exec decision needed on releasing the 15% contingency for Phase 3.", project: "eConveyancer Platform Upgrade", ownerName: "Webster Maposa", dueOffset: 4, severity: "high", probability: null, impact: null, status: "open", department: "finance" },
  { type: "decision", title: "Confirm Group resourcing split", description: "Whether part of the Command Centre build is funded from the Group transformation budget.", project: null, ownerName: "Webster Maposa", dueOffset: 14, severity: "medium", probability: null, impact: null, status: "open", department: "finance" },
  { type: "issue", title: "Mobile app crash on older Android versions", description: "Crash reports on Android 9 devices post-release.", project: "Mobile App v2 Rollout", ownerName: "Nicole Maposa", dueOffset: -2, severity: "medium", probability: null, impact: null, status: "open", department: null },
  { type: "risk", title: "Key engineer concentration on Finance Automation", description: "Single point of failure — one engineer holds all context.", project: "Finance Reporting Automation", ownerName: "Lorraine Shoko", dueOffset: 30, severity: "low", probability: "low", impact: "medium", status: "mitigating", department: "finance" },
  { type: "decision", title: "Retire manual weekly report", description: "Confirm the manual DLAP weekly report is retired now the module is live.", project: "DLAP Conveyancer Onboarding Phase 2", ownerName: "Don Yambira", dueOffset: -5, severity: "low", probability: null, impact: null, status: "closed", department: "finance" },
] as const;

/**
 * Every row is exactly 390 on / 110 off = 78.0%, so ANY subset aggregates to
 * exactly 78.0% regardless of headcount. The 5.00-hour rows use 234/66, which
 * is the same ratio. Do not "tidy" these numbers.
 */
export const ACTIVITY_RECORDS = [
  { personName: "Tanaka Mangwiro", role: "Business Systems Analyst", department: "Delivery", hoursToday: "8.33", on: 390, off: 110, screenshots: 142, storageMb: "380.50", lastSeenMinutesAgo: 5, status: "online" },
  { personName: "Nicole Maposa", role: "Mobile Engineer", department: "Engineering", hoursToday: "8.33", on: 390, off: 110, screenshots: 168, storageMb: "410.20", lastSeenMinutesAgo: 2, status: "online" },
  { personName: "Godwin Ndarevani", role: "Backend Engineer", department: "Engineering", hoursToday: "8.33", on: 390, off: 110, screenshots: 155, storageMb: "395.00", lastSeenMinutesAgo: 10, status: "online" },
  { personName: "Tribute Mhaka", role: "QA Analyst", department: "Delivery", hoursToday: "8.33", on: 390, off: 110, screenshots: 133, storageMb: "300.10", lastSeenMinutesAgo: 20, status: "online" },
  { personName: "Jethro Sithole", role: "Platform Engineer", department: "Engineering", hoursToday: "8.33", on: 390, off: 110, screenshots: 149, storageMb: "360.70", lastSeenMinutesAgo: 1, status: "online" },
  { personName: "Mphokuhle Ncube", role: "Data Engineer", department: "Engineering", hoursToday: "8.33", on: 390, off: 110, screenshots: 121, storageMb: "290.40", lastSeenMinutesAgo: 15, status: "online" },
  { personName: "Don Yambira", role: "Commercial Manager", department: "Commercial", hoursToday: "8.33", on: 390, off: 110, screenshots: 60, storageMb: "120.00", lastSeenMinutesAgo: 30, status: "online" },
  { personName: "Lorraine Shoko", role: "CFO", department: "Finance", hoursToday: "8.33", on: 390, off: 110, screenshots: 45, storageMb: "90.30", lastSeenMinutesAgo: 25, status: "online" },
  { personName: "Collins Jimu", role: "CTO", department: "Engineering", hoursToday: "8.33", on: 390, off: 110, screenshots: 58, storageMb: "110.60", lastSeenMinutesAgo: 8, status: "online" },
  { personName: "Webster Maposa", role: "CEO", department: "Executive", hoursToday: "8.33", on: 390, off: 110, screenshots: 40, storageMb: "80.20", lastSeenMinutesAgo: 3, status: "online" },
  { personName: "Alex Chirwa", role: "Junior Developer", department: "Engineering", hoursToday: "5.00", on: 234, off: 66, screenshots: 98, storageMb: "210.00", lastSeenMinutesAgo: 40, status: "offline" },
  { personName: "Nomsa Dube", role: "Support Analyst", department: "Delivery", hoursToday: "5.00", on: 234, off: 66, screenshots: 87, storageMb: "195.40", lastSeenMinutesAgo: 55, status: "offline" },
  { personName: "Prince Moyo", role: "QA Engineer", department: "Delivery", hoursToday: "5.00", on: 234, off: 66, screenshots: 102, storageMb: "220.80", lastSeenMinutesAgo: 45, status: "offline" },
  { personName: "Ruth Chikafu", role: "Product Analyst", department: "Commercial", hoursToday: "5.00", on: 234, off: 66, screenshots: 71, storageMb: "160.30", lastSeenMinutesAgo: 90, status: "offline" },
  { personName: "Simon Gwara", role: "DevOps Engineer", department: "Engineering", hoursToday: "5.00", on: 234, off: 66, screenshots: 110, storageMb: "250.10", lastSeenMinutesAgo: 12, status: "online" },
  { personName: "Faith Muronda", role: "HR & People Ops", department: "People", hoursToday: "5.00", on: 234, off: 66, screenshots: 52, storageMb: "100.90", lastSeenMinutesAgo: 75, status: "offline" },
] as const;

export const DELIVERY_REPOS = [
  { repo: "dokuma/mobile-app", project: "Mobile App v2 Rollout", commitsBase: 5, commitsMod: 4, deployEvery: 3, openBase: 3, openMod: 3, closedMod: 5 },
  { repo: "dokuma/client-portal", project: "Client Portal Revamp", commitsBase: 3, commitsMod: 3, deployEvery: 4, openBase: 2, openMod: 2, closedMod: 4 },
  { repo: "dokuma/deeds-api-integration", project: "Deeds Registries API Integration", commitsBase: 2, commitsMod: 2, deployEvery: 0, openBase: 6, openMod: 3, closedMod: 2 },
] as const;

export const MEETINGS = [
  {
    title: "DLAP Stakeholders Sync",
    dateOffset: -3,
    attendees: ["Don Yambira", "Tanaka Mangwiro", "Webster Maposa"],
    sourceNotes: "Discussed onboarding backlog and training capacity.",
    actionItems: [
      { description: "Schedule additional training slots for pending firms", ownerName: "Don Yambira", dueOffset: 5, status: "open" },
      { description: "Circulate updated onboarding tracker", ownerName: "Tanaka Mangwiro", dueOffset: -1, status: "open" },
    ],
  },
  {
    title: "Exco Financial Review",
    dateOffset: -7,
    attendees: ["Lorraine Shoko", "Webster Maposa", "Don Yambira"],
    sourceNotes: "Reviewed management accounts and receivables ageing.",
    actionItems: [
      { description: "Follow up on outstanding receivables over 60 days", ownerName: "Lorraine Shoko", dueOffset: 2, status: "open" },
      { description: "Prepare FY2027 revenue projection draft", ownerName: "Lorraine Shoko", dueOffset: 21, status: "open" },
    ],
  },
  {
    title: "Security & Compliance Working Session",
    dateOffset: -2,
    attendees: ["Collins Jimu", "Jethro Sithole"],
    sourceNotes: "Walked through outstanding pentest findings and remediation plan.",
    actionItems: [
      { description: "Patch high-severity findings on API gateway", ownerName: "Jethro Sithole", dueOffset: 3, status: "open" },
      { description: "Get legal sign-off on data protection review", ownerName: "Collins Jimu", dueOffset: 3, status: "open" },
    ],
  },
  {
    title: "Group Digital Transformation Check-in",
    dateOffset: -10,
    attendees: ["Webster Maposa", "Collins Jimu"],
    sourceNotes: "Aligned Dokuma command centre architecture with Group-wide platform plans.",
    actionItems: [
      { description: "Draft Group resourcing proposal for exec review", ownerName: "Webster Maposa", dueOffset: 14, status: "open" },
      { description: "Share data model documentation with Group Working Team", ownerName: "Collins Jimu", dueOffset: -4, status: "done" },
    ],
  },
] as const;

export const COMPANY_TOTALS = {
  revenuePipelineUsd: "4200000.00",
  contractedRevenueUsd: "2100000.00",
  outstandingReceivablesUsd: "480000.00",
} as const;

export const DAILY_BRIEF = {
  headline: "Three critical blockers need executive attention this week.",
  body:
    "Portfolio health is broadly stable: 7 of 12 projects are Green. Two Red projects — Deeds Registries API Integration and Security & Compliance Hardening — account for all 6 open critical risks and both need an executive decision this week. Team utilisation is holding at 78%. Outstanding receivables sit at $480k; Finance flagged one account over 60 days overdue for follow-up. Recommended focus today: unblock the Deeds Registries contract timeline and confirm the compliance sign-off before the Security & Compliance Hardening milestone slips further.",
  generatedBy: "stub",
} as const;
