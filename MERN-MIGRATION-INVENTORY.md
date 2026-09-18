# MERN Migration Inventory — Dokuma Command Centre

**Status: inventory only. No code has been migrated.** This document is the
complete audit of what exists today (Next.js 14 App Router + Supabase/Postgres)
and what each piece becomes in the MERN target (MongoDB + Express + React +
Node). Ambiguities are listed in §10 with a proposed decision for each.

**Scope rule applied throughout:** behavior is preserved exactly unless a
change is explicitly flagged in §10 and approved. Where Postgres provides
something Mongo does not (generated columns, views, triggers, RLS), the
document states *where that behavior moves to*, not that it disappears.

**Coverage:** 30 page routes, 5 API route handlers, 26 Server Actions,
35 tables, 4 views, 9 SQL functions, 3 triggers, 4 storage buckets.
§11 is the validation matrix proving every route and action has an entry.

---

## 0. Critical finding: a partial Mongo migration is already in the tree

This is not a greenfield migration. Read this section before planning any work.

`lib/supabase/server.ts` currently contains a **hand-written Mongo-backed shim
that impersonates the Supabase client API** (`LocalQueryBuilder`, `localClient`)
— a ~150-line reimplementation of `.from().select().eq().order()` on top of the
`mongodb` driver, plus a local email/password auth store (`users`,
`local_sessions` collections, scrypt hashing). `mongodb@^7.6.0` is already a
dependency; `MONGODB_ONLY=true` is already in `.env.local.example`.

Uncommitted working-tree changes (per `git status`) touch exactly the files
that shim affects: `lib/supabase/*`, `lib/rate-limit.ts`, the login page and
action, plus a new `app/api/auth/` directory.

### What the shim does NOT implement

These are silent behavior regressions in the current working tree, and each is
a real migration work item, not a Mongo-vs-Postgres design question:

| Capability | Shim behavior today | Consequence |
| --- | --- | --- |
| `supabase.rpc(...)` | returns `{ data: [], error: null }` unconditionally | `refresh_kpi_feed`, `get_account_balance_as_of`, `get_unusual_transactions` are **no-ops**. Every balance is 0; daily reports are empty. |
| RLS | absent entirely | The only authorization left is app-level `requireRole()`. The second of SECURITY.md's two independent layers is gone. |
| MFA | `getAuthenticatorAssuranceLevel()` hard-codes `aal1`, `listFactors()` returns empty | `requireRole()` redirects Finance/HR roles to `/account/mfa/enroll` forever — and since `hasVerifiedTotpFactor()` is also always false, enrollment can never complete. **Finance/HR roles are effectively locked out.** |
| Storage | `upload`/`createSignedUrl` return an error object | Receipt and JD-attachment upload paths fail. |
| Realtime (`channel`) | no-op stub in `lib/supabase/client.ts` | Cash Position panel renders server data, never live-updates. |
| Joined selects (`select("*, projects(name)")`) | fields containing `(` are **dropped** from the projection | Every embedded-relation column renders `—`. |
| `count`, `head: true` | `count` returns post-filter length; `head` ignored | HR dashboard KPI counts unreliable. |
| Triggers | absent | `current_balance` and `leave_balances.days_used` never recompute. |
| Generated column `days_remaining` | absent | Leave balance remaining is undefined. |

**Proposed decision (D-0):** Treat the shim as a throwaway bridge, not the
migration target. The real migration replaces it with an Express API + Mongoose
models per this document; the shim is deleted, not extended. Extending a
Supabase-API-shaped facade over Mongo would permanently lock the codebase into
PostgREST query semantics it no longer needs.

---

## 1. Target architecture

| Layer | Today | Target |
| --- | --- | --- |
| Frontend | Next.js 14 App Router, RSC, Server Actions | React 18 + Vite + React Router; all data via `fetch` to Express |
| API | Server Actions + 5 route handlers | Express 4 REST API, `/api/*` |
| Auth | Supabase Auth, cookie session, TOTP MFA | Express session — JWT in `httpOnly` cookie; `speakeasy`/`otplib` TOTP |
| AuthZ | `requireRole()` + Postgres RLS | `requireRole` middleware + **mandatory per-query scope filters** (§4.3) |
| DB | Postgres 15 (Supabase) | MongoDB 7 + Mongoose |
| Files | Supabase Storage, 4 private buckets | GridFS or S3-compatible; signed-URL equivalent (§10, D-7) |
| Realtime | Supabase Realtime `postgres_changes` | Socket.IO or SSE (§10, D-6) |
| Rate limit | Upstash Redis / Mongo TTL fallback | `express-rate-limit` + Mongo store (already prototyped) |
| Email | Resend REST API | Unchanged — no Supabase coupling |
| PDF | `@react-pdf/renderer` in a route handler | Unchanged — moves to an Express handler |

### Proposed repo layout

```
client/                 React + Vite SPA
  src/routes/           one folder per current app/ route
  src/components/       ported near-verbatim from components/
server/
  src/models/           Mongoose schemas (§5)
  src/routes/           Express routers (§3)
  src/services/         ported from lib/ (§7)
  src/middleware/       requireAuth, requireRole, requireMfa, scope, rateLimit
  src/validation/       zod schemas — ported verbatim (§8)
```

---

## 2. Page routes → frontend routes

All 30 pages. "Auth" is the current `requireRole()` / `getProfile()` gate.
Every dashboard route additionally requires an authenticated session via
`middleware.ts` → `updateSession()`, and the Finance/HR four-role set
additionally requires AAL2 (MFA) — see §4.4.

### 2.1 Auth & account

| # | Route | Source | Capability | Auth | Target route | Express dependency |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/login` | `app/(auth)/login/page.tsx` | Email/password form, `?next=` redirect, brand panel | Public | `/login` | `POST /api/auth/login` |
| 2 | `/account/mfa/enroll` | `app/(dashboard)/account/mfa/enroll/page.tsx` + `enroll-form.tsx` | TOTP enroll: QR + secret, verify code. Redirects to `/` if not an MFA role or already AAL2; to `verify` if a factor exists | Session; MFA roles only | `/account/mfa/enroll` | `POST /api/auth/mfa/enroll`, `/verify` |
| 3 | `/account/mfa/verify` | `app/(dashboard)/account/mfa/verify/page.tsx` + `verify-form.tsx` | TOTP challenge for an existing factor. Redirects to `enroll` if no factor | Session; MFA roles only | `/account/mfa/verify` | `POST /api/auth/mfa/challenge` |

### 2.2 Executive

| # | Route | Source | Capability | Auth | Target | Express |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | `/` | `app/(dashboard)/page.tsx` | CEO Home: 10 KPI cards, GAR bar, AI daily brief. **Non-exec roles are redirected to `roleHomePath(role)`** | All 9 roles pass `requireRole`, then admin/exec only | `/` | `GET /api/kpis/ceo-dashboard`, `GET /api/briefs/latest` |
| 5 | `/company` | `app/(dashboard)/company/page.tsx` | Company overview: same KPI view + upcoming milestones + open critical risks | admin, exec | `/company` | `GET /api/kpis/ceo-dashboard`, `/api/milestones?upcoming`, `/api/risks?critical` |

### 2.3 Portfolio, people, risk, clients, delivery, meetings

| # | Route | Source | Capability | Auth | Target | Express |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | `/projects` | `projects/page.tsx` | Project list: status, owner, budget, dates | Any authenticated (no `requireRole`; layout `getProfile` gate only) | `/projects` | `GET /api/projects` |
| 7 | `/projects/[id]` | `projects/[id]/page.tsx` | Project detail + milestones + 20 tasks + risks; `notFound()` on miss | Any authenticated | `/projects/:id` | `GET /api/projects/:id` (aggregated) |
| 8 | `/people` | `people/page.tsx` | LazyBoss team summary + per-person activity | admin, exec | `/people` | `GET /api/people/activity` |
| 9 | `/risks` | `risks/page.tsx` | Risks/issues/decisions table, **department-scoped** (§4.5) | Any authenticated (`getProfile`) | `/risks` | `GET /api/risks` |
| 10 | `/clients` | `clients/page.tsx` | Clients by tier + linked projects, **department-scoped** | Any authenticated (`getProfile`) | `/clients` | `GET /api/clients` |
| 11 | `/delivery` | `delivery/page.tsx` | Delivery metrics: commits, deploys, defects | Any authenticated | `/delivery` | `GET /api/delivery-metrics` |
| 12 | `/meetings` | `meetings/page.tsx` | Meetings + action items | Any authenticated | `/meetings` | `GET /api/meetings` |

> **Note:** routes 6, 7, 11, 12 call **neither** `requireRole` nor `getProfile`
> in the page itself. Their only gate is the dashboard layout's `getProfile()`
> plus middleware, with RLS as the real data boundary. See §10, D-2.

### 2.4 Finance (9 routes)

All require `["admin","exec","finance_officer","finance_manager"]` unless noted.
`canWrite` = admin/finance_officer/finance_manager; `canEditStatus` = admin/finance_manager.

| # | Route | Source | Capability | Auth | Target | Express |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | `/finance` | `finance/page.tsx` | Cash Position (realtime), 3 company-total KPIs, per-project finance table w/ computed margin | 4 finance-tier | `/finance` | `GET /api/finance/cash-position`, `/api/finance/company-totals`, `/api/finance/project-finance` |
| 14 | `/finance/transactions` | `finance/transactions/page.tsx` | Last 100 transactions, CSV export, create/reverse/receipt (write roles) | 4 finance-tier | `/finance/transactions` | `GET /api/finance/transactions?limit=100`, `/api/finance/accounts` |
| 15 | `/finance/creditors` | `finance/creditors/page.tsx` | Creditors by due date, CSV export, create + status edit | 4 finance-tier | `/finance/creditors` | `GET /api/finance/creditors` |
| 16 | `/finance/payment-notices` | `finance/payment-notices/page.tsx` | Current-month notices, CSV, PDF link, create + status edit. **Fires `checkPaymentNoticesDueSoon()` on page load** | 4 finance-tier | `/finance/payment-notices` | `GET /api/finance/payment-notices?month=current` |
| 17 | `/finance/reports` | `finance/reports/page.tsx` | Report list + "Generate daily" button | 4 finance-tier | `/finance/reports` | `GET /api/finance/reports` |
| 18 | `/finance/reports/[id]` | `finance/reports/[id]/page.tsx` | Report detail, publish button, PDF link; `notFound()` on miss | 4 finance-tier | `/finance/reports/:id` | `GET /api/finance/reports/:id` |
| 19 | `/finance/reports/weekly/new` | `finance/reports/weekly/new/page.tsx` | Weekly draft: computed figures + 4 free-text fields; Save-draft / Save-&-publish | admin, finance_officer, finance_manager | `/finance/reports/weekly/new` | `GET /api/finance/reports/weekly/preview` |
| 20 | `/finance/reports/monthly/new` | `finance/reports/monthly/new/page.tsx` | Monthly draft, same shape | admin, finance_officer, finance_manager | `/finance/reports/monthly/new` | `GET /api/finance/reports/monthly/preview` |
| 21 | `/finance/import` | `finance/import/page.tsx` + `import-wizard.tsx` | Excel/CSV import wizard: upload → preview → column-map → commit | admin, finance_officer, finance_manager | `/finance/import` | `POST /api/finance/import/preview`, `/commit` |

### 2.5 HR (8 routes)

`HR_ALL` = `["admin","exec","employee","supervisor","hr_officer","hr_manager"]`.

| # | Route | Source | Capability | Auth | Target | Express |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | `/hr` | `hr/page.tsx` | HR dashboard: headcount, pending leave, open roles (HR-tier only), expiring training | HR_ALL | `/hr` | `GET /api/hr/dashboard` |
| 23 | `/hr/employees` | `hr/employees/page.tsx` | Employee directory + CSV export | HR_ALL | `/hr/employees` | `GET /api/hr/employees` |
| 24 | `/hr/employees/[id]` | `hr/employees/[id]/page.tsx` | **Employee 360**: profile, JD history + attachment, leave, balances, reviews, training, attendance (LazyBoss-or-manual), internal tasks, Jira tasks. `notFound()` if RLS hid the row | HR_ALL | `/hr/employees/:id` | `GET /api/hr/employees/:id` (aggregated) |
| 25 | `/hr/leave` | `hr/leave/page.tsx` | Leave requests (scoped), decision buttons, CSV | HR_ALL | `/hr/leave` | `GET /api/hr/leave-requests` |
| 26 | `/hr/leave/new` | `hr/leave/new/page.tsx` | Submit leave; redirects to `/hr/leave` if caller has no employee record | admin, employee, supervisor, hr_officer, hr_manager | `/hr/leave/new` | `GET /api/hr/leave-types` |
| 27 | `/hr/performance` | `hr/performance/page.tsx` | Review list + create (supervisor/HR-tier), CSV | HR_ALL | `/hr/performance` | `GET /api/hr/performance-reviews` |
| 28 | `/hr/training` | `hr/training/page.tsx` | Training records + expiring-soon, CSV. **Fires `checkTrainingExpiringSoon()` on load** | HR_ALL | `/hr/training` | `GET /api/hr/training-records` |
| 29 | `/hr/recruitment` | `hr/recruitment/page.tsx` | Openings, candidates, application pipeline w/ stage select | admin, exec, hr_officer, hr_manager | `/hr/recruitment` | `GET /api/hr/recruitment` |

### 2.6 Admin

| # | Route | Source | Capability | Auth | Target | Express |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | `/admin/import/lazyboss-csv` | `admin/import/lazyboss-csv/page.tsx` | LazyBoss CSV upload form | **admin only** | `/admin/import/lazyboss-csv` | `POST /api/admin/import/lazyboss-csv` |

### 2.7 Layouts

| Source | Behavior | Target |
| --- | --- | --- |
| `app/layout.tsx` | Root: Inter + Source Serif 4 via `next/font/google`, global CSS | `client/src/main.tsx` + `index.html`; fonts self-hosted (§10, D-9) |
| `app/(auth)/layout.tsx` | White full-height wrapper | `AuthLayout` component |
| `app/(dashboard)/layout.tsx` | `getProfile()` → redirect `/login`; loads notifications; renders `NavSidebar` + `TopHeader` | `DashboardLayout` + `<RequireAuth>` route guard; notifications via `GET /api/notifications` |

---

## 3. API routes and Server Actions → Express endpoints

### 3.1 Existing API route handlers (5)

| Source | Method | Auth | Rate limit | Target endpoint | Notes |
| --- | --- | --- | --- | --- | --- |
| `app/api/auth/login/route.ts` | POST | Public | **5 / 60s per IP** | `POST /api/auth/login` | Sets `dokuma_local_session` cookie: `httpOnly`, `sameSite:strict`, 7d. Returns `{next}` or 401/429 |
| `app/api/auth/signout/route.ts` | POST | Session | — | `POST /api/auth/logout` | Deletes session record + cookie |
| `app/api/kpi-feed/route.ts` | GET | Session (RLS) | **30 / 60s per IP** | `GET /api/kpi-feed` | Group-platform polling contract. `force-dynamic`. Returns `{data:[{company,metric_name,value,unit,as_of_date,updated_at}]}` |
| `app/api/finance/payment-notices/[id]/pdf/route.tsx` | GET | 4 finance-tier | — | `GET /api/finance/payment-notices/:id/pdf` | `@react-pdf/renderer` → `renderToBuffer`, `application/pdf` |
| `app/api/finance/reports/[id]/pdf/route.tsx` | GET | 4 finance-tier | — | `GET /api/finance/reports/:id/pdf` | Dispatches on `report.type` → Daily/Weekly/Monthly document |

### 3.2 Server Actions (26)

Every action calls `requireRole()` **first**, then zod-validates, then writes via
the service-role client, then writes `audit_log`, then `revalidatePath`.
In Express: `requireRole` middleware → zod body parse → service → audit → JSON
response. `revalidatePath` has no analogue — the client refetches (§10, D-3).

#### Auth

| Action | Source | Auth | Validation | Target | Writes |
| --- | --- | --- | --- | --- | --- |
| `loginAction` | `(auth)/login/actions.ts` | Public | Raw strings; rate-limited by IP | `POST /api/auth/login` | session |

> `loginAction` and `app/api/auth/login/route.ts` are **duplicate login paths**.
> The login page currently `fetch`es the route handler; the Server Action is
> dead code in the working tree. See §10, D-1.

#### Finance — transactions

| Action | Source | Auth | Validation | Target | Writes |
| --- | --- | --- | --- | --- | --- |
| `createTransactionAction` | `finance/transactions/actions.ts` | admin, fin_officer, fin_manager | `createTransactionSchema` | `POST /api/finance/transactions` | `finance_transactions` (+balance recompute), `audit_log` |
| `reverseTransactionAction` | same | admin, fin_officer, fin_manager | `reverseTransactionSchema` (reason required) | `POST /api/finance/transactions/:id/reverse` | offsetting txn, `is_reversed=true`, `audit_log` |
| `uploadReceiptAction` | same | admin, fin_officer, fin_manager | `validateDocumentFile` (10MB, PDF/Word/image) | `POST /api/finance/transactions/:id/receipt` | storage, `receipt_path`, `audit_log` |
| `getReceiptUrlAction` | same | 4 finance-tier | path string | `GET /api/finance/transactions/:id/receipt-url` | none (60s signed URL) |

#### Finance — creditors / notices / reports / import

| Action | Source | Auth | Validation | Target | Writes |
| --- | --- | --- | --- | --- | --- |
| `createCreditorAction` | `finance/creditors/actions.ts` | admin, fin_officer, fin_manager | `createCreditorSchema` | `POST /api/finance/creditors` | `finance_creditors`, `audit_log` |
| `updateCreditorStatusAction` | same | **admin, fin_manager** | inline enum `outstanding\|partially_paid\|paid` | `PATCH /api/finance/creditors/:id/status` | status, `audit_log` |
| `createPaymentNoticeAction` | `finance/payment-notices/actions.ts` | admin, fin_officer, fin_manager | `createPaymentNoticeSchema` | `POST /api/finance/payment-notices` | notice, `audit_log` |
| `updatePaymentNoticeStatusAction` | same | **admin, fin_manager** | inline enum `scheduled\|sent\|paid` | `PATCH /api/finance/payment-notices/:id/status` | status, `audit_log` |
| `generateDailyReportAction` | `finance/reports/actions.ts` | admin, fin_officer, fin_manager | date string, defaults today | `POST /api/finance/reports/daily` | report (immediately `published`), `audit_log` |
| `createWeeklyReportAction` | same | admin, fin_officer, fin_manager | `weeklyReportFreeTextSchema` | `POST /api/finance/reports/weekly` | report, `audit_log`, approval step + notify if draft |
| `createMonthlyReportAction` | same | admin, fin_officer, fin_manager | `monthlyReportFreeTextSchema` | `POST /api/finance/reports/monthly` | report, `audit_log`, approval step + notify if draft |
| `publishReportAction` | same | **admin, fin_manager** | `report_id` | `POST /api/finance/reports/:id/publish` | status, `audit_log`, approval decision, notify author |
| `previewImportAction` | `finance/import/actions.ts` | admin, fin_officer, fin_manager | extension allowlist + 5MB cap | `POST /api/finance/import/preview` | none |
| `commitImportAction` | same | admin, fin_officer, fin_manager | `mapAndValidateRows` — **all-or-nothing** | `POST /api/finance/import/commit` | `finance_transactions` bulk, `audit_log` |

> `publishImmediately` is passed via `.bind(null, true\|false)`, not a form
> field (React does not guarantee a button's `name`/`value` survives a Server
> Action `formAction`). In REST this becomes an explicit `{publish: boolean}`
> body field. Note the guard: publish only takes effect if the actor is
> admin/finance_manager (`canPublish`), so a finance_officer clicking
> "Save & publish" still gets a draft. **Preserve this.**

#### HR

| Action | Source | Auth | Validation | Target | Writes |
| --- | --- | --- | --- | --- | --- |
| `submitLeaveRequestAction` | `hr/leave/actions.ts` | admin, employee, supervisor, hr_officer, hr_manager | `submitLeaveRequestSchema` | `POST /api/hr/leave-requests` | request (`pending_supervisor`), `audit_log`, approval step, notify supervisor |
| `supervisorDecisionAction` | same | **admin, supervisor** | `leaveDecisionSchema` + **ownership re-check** | `POST /api/hr/leave-requests/:id/supervisor-decision` | status→`pending_hr`\|`rejected`, `audit_log`, approval, notify |
| `hrDecisionAction` | same | admin, hr_officer, hr_manager | `leaveDecisionSchema` | `POST /api/hr/leave-requests/:id/hr-decision` | status→`approved`\|`rejected`, balance trigger, `audit_log`, notify |
| `createPerformanceReviewAction` | `hr/performance/actions.ts` | admin, supervisor, hr_officer, hr_manager | `createPerformanceReviewSchema` | `POST /api/hr/performance-reviews` | review, `audit_log` |
| `createTrainingRecordAction` | `hr/training/actions.ts` | admin, hr_officer, hr_manager | `createTrainingRecordSchema` | `POST /api/hr/training-records` | record, `audit_log` |
| `createJobOpeningAction` | `hr/recruitment/actions.ts` | admin, hr_officer, hr_manager | `createJobOpeningSchema` | `POST /api/hr/job-openings` | opening, `audit_log` |
| `createCandidateAction` | same | admin, hr_officer, hr_manager | `createCandidateSchema` | `POST /api/hr/candidates` | candidate + application, `audit_log` |
| `updateApplicationStageAction` | same | admin, hr_officer, hr_manager | `updateApplicationStageSchema` | `PATCH /api/hr/applications/:id/stage` | stage, `audit_log` |
| `uploadJdAttachmentAction` | `hr/employees/[id]/actions.ts` | admin, hr_officer, hr_manager | `validateDocumentFile` | `POST /api/hr/job-descriptions/:id/attachment` | storage, `attachment_path`, `audit_log` |
| `getJdAttachmentUrlAction` | same | HR_ALL | path string | `GET /api/hr/job-descriptions/:id/attachment-url` | none |

#### Admin

| Action | Source | Auth | Validation | Target | Writes |
| --- | --- | --- | --- | --- | --- |
| `importLazyBossCsv` | `admin/import/lazyboss-csv/actions.ts` | **admin only** | `lazyBossCsvRowSchema` per row; papaparse | `POST /api/admin/import/lazyboss-csv` | `activity_records` upsert on `(person_name,activity_date,source)`, `refresh_kpi_feed()`, `audit_log` |

> Unlike the Excel import (all-or-nothing), the LazyBoss import is
> **partial-success**: invalid rows are skipped and reported, valid rows commit.
> `activity_date` is **always "today"**, never read from the file.
> **Preserve both behaviors.**

---

## 4. Auth, roles, MFA, session, authorization, rate limiting

### 4.1 Roles (9)

`admin`, `exec`, `viewer`, `finance_officer`, `finance_manager`, `employee`,
`supervisor`, `hr_officer`, `hr_manager` — a `CHECK` constraint on
`profiles.role` (0001 → 0012 → 0019). New signups default to `viewer` via the
`handle_new_user` trigger on `auth.users`.

**Target:** `role` field on the `User` model with a Mongoose enum (identical
list). The auto-profile trigger becomes user-creation service logic.

### 4.2 Session

| Aspect | Today | Target |
| --- | --- | --- |
| Identity | Supabase Auth (email/password) | Own users collection; `bcrypt`/`scrypt` password hash |
| Cookie | `@supabase/ssr` cookies, hardened via `hardenCookieOptions`: `secure` in prod, `sameSite:strict`, **`httpOnly:false` deliberately** | `httpOnly:true` — see §10, D-4 |
| Shim cookie | `dokuma_local_session`, `httpOnly:true`, `sameSite:strict`, 7 days | Same shape, signed JWT |
| Route gate | `middleware.ts` → `updateSession()`; public paths `/login`, `/api/auth/login`; else redirect `/login?next=<path>` | `<RequireAuth>` guard client-side + `requireAuth` middleware server-side |
| Profile load | `getProfile()`, React `cache()`-memoized per request | `req.user` populated once by `requireAuth` |

### 4.3 Authorization — two layers, one of which has no Mongo equivalent

**Layer 1 — app-level `requireRole(allowed[])`:** redirects to `/login` if
unauthenticated, `/` if wrong role. Ports directly to Express middleware that
returns 401/403 (the redirect becomes the client's job).

**Layer 2 — Postgres RLS.** Mongo has no row-level security. Every RLS policy
must be re-expressed as a **mandatory query filter in the data-access layer**.
This is the single highest-risk item in the migration: RLS fails closed by
default; a forgotten Mongoose filter fails **open**.

Full RLS policy translation table:

| Table | RLS policy (0011/0013/0016/0025/0027/0028) | Required Mongo filter |
| --- | --- | --- |
| `profiles` | `id = auth.uid()` | `{_id: req.user.id}` |
| `projects`, `milestones`, `tasks`, `delivery_metrics`, `meetings`, `meeting_action_items`, `kpi_feed`, `ai_daily_briefs`, `leave_types` | `current_role() is not null` | authenticated only, no row filter |
| `risks_issues_decisions`, `clients` | `current_role() is not null` **+ app-level department scope** | see §4.5 |
| `project_finance`, `finance_company_totals` | `current_role() in (admin,exec)` | role gate only |
| `activity_records` | `current_role() in (admin,exec)` | role gate only |
| `finance_accounts`, `finance_transactions`, `finance_reports`, `finance_creditors`, `finance_payment_notices` | `current_role() in (admin,exec,finance_officer,finance_manager)` | role gate only |
| `audit_log` | `current_role() in (admin,exec,finance_manager)` | role gate only |
| `employees` | `user_id = auth.uid() OR is_supervisor_of(id) OR role in (admin,exec,hr_officer,hr_manager)` | `{$or:[{userId}, {supervisorId: myEmployeeId}]}` unless HR-tier |
| `job_descriptions` | `role in (admin,exec,hr_officer,hr_manager,supervisor,employee)` | role gate only (deliberately broad) |
| `leave_balances`, `leave_requests`, `performance_reviews`, `training_records`, `attendance_records`, `employee_tasks`, `jira_tasks_cache` | `employee_id = current_employee_id() OR is_supervisor_of(employee_id) OR role in (admin,exec,hr_officer,hr_manager)` | `{employeeId: {$in: [me, ...myReports]}}` unless HR-tier |
| `job_openings`, `candidates`, `applications` | `role in (admin,exec,hr_officer,hr_manager)` | role gate only |
| `approvals` | managers **or** `decided_by = uid` **or** (leave_request whose employee is self/direct-report) | compound `$or` |
| `notifications` | select + update `user_id = auth.uid()` | `{userId: req.user.id}` on **both** |

**There are no INSERT/UPDATE/DELETE policies anywhere** (except
`notifications_update_own_read_at`). Every write goes through the service-role
client after `requireRole()`. In Express this is the natural default — there is
no direct-from-browser DB access at all, which structurally removes the reason
RLS existed. **But** `scripts/rls-tests.mjs` (11 cross-role checks) must be
rewritten against the HTTP API so this is still verified, not assumed.

**Proposed decision (D-5):** implement scoping as a **required `scope` argument**
on every repository function — not an optional filter — so omitting it is a
compile-time error rather than a silent data leak.

### 4.4 MFA

- Required for exactly 4 roles: `finance_officer`, `finance_manager`,
  `hr_officer`, `hr_manager` (`MFA_REQUIRED_ROLES`). admin/exec deliberately exempt.
- `requireRole()` checks AAL: AAL1 → redirect `/account/mfa/verify` if a verified
  TOTP factor exists, else `/account/mfa/enroll`.
- Supabase quirk documented in SECURITY.md: `listFactors().totp` contains only
  **verified** factors; unverified appear only in `.all`. The enroll page clears
  stale unverified factors before re-enrolling.

**Target:** `otplib` or `speakeasy`. `User` gains `mfa: {secret, verifiedAt,
pendingSecret}`. Session JWT carries `aal: "aal1"|"aal2"`. A `requireMfa`
middleware replicates the redirect logic as 403 + `{reason:"mfa_required",
next:"enroll"|"verify"}` for the client to act on. The Supabase
verified-vs-unverified quirk disappears — model it explicitly with
`pendingSecret` vs `secret`.

### 4.5 Department scoping

`lib/department-scope.ts` → `departmentScopeForRole()`:
- finance_officer/finance_manager → `"finance"`
- employee/supervisor/hr_officer/hr_manager → `"hr"`
- admin/exec/viewer → `null` (see everything)

Applied to `risks_issues_decisions` and `clients` via a `department` column
(`CHECK in ('finance','hr')`, nullable). **There is deliberately no fallback to
untagged rows** — a scoped role sees only explicitly tagged rows; `null` rows are
exec-only. ONBOARDING §7 flags this as intentional and HR's views as legitimately
empty. **Preserve exactly** — port `departmentScopeForRole` verbatim and apply
`{department: scope}` when scope is non-null.

### 4.6 Rate limiting

`lib/rate-limit.ts` has three backends in priority order: Mongo TTL collection
(`rate_limit_windows`, fixed window, TTL index) → Upstash Redis sliding window →
in-memory. Limits: **login 5/60s**, **kpi-feed 30/60s**, keyed by
`x-forwarded-for` first IP, fallback `"unknown"`.

**Target:** keep the Mongo store (already written and Express-compatible).
One semantic difference to preserve or explicitly change: the Mongo backend is a
**fixed** window, Upstash is a **sliding** window. Prefer porting the existing
implementation directly — it is already correct and dependency-light.

### 4.7 Audit logging

Every mutating action writes `audit_log {actor_id, actor_role, action,
entity_type, entity_id, metadata}`. **Target:** Express middleware or an
explicit `audit()` service call per handler. Keep the same `action` string
vocabulary so historical rows stay queryable.

---

## 5. Database → MongoDB models

35 tables. Mongo naming: `snake_case` table → PascalCase model, camelCase fields.
`uuid` PKs stay as UUID strings so seed data and FK values survive (§10, D-8).

### 5.1 Core

| Table | Model | Key fields | Relationships | Constraints/indexes to enforce in app |
| --- | --- | --- | --- | --- |
| `profiles` | `Profile` (merge into `User`, D-10) | id, full_name, role, created_at | 1-1 `auth.users` | role enum (9) |
| `projects` | `Project` | name, owner_name, status, budget_usd, start_date, target_end_date, description, client_id | → `clients` (set null) | status enum green/amber/red; idx client_id |
| `milestones` | `Milestone` | project_id, name, due_date, status | → projects (cascade) | status enum pending/on_track/at_risk/done; idx project_id |
| `tasks` | `Task` | project_id, title, assignee_name, due_date, status | → projects (cascade) | status enum todo/in_progress/blocked/done; idx project_id, due_date |
| `clients` | `Client` | name, industry, primary_contact_name/email, relationship_owner, tier, notes, **department** | ← projects | tier enum strategic/key/standard; department enum finance/hr |
| `risks_issues_decisions` | `RiskIssueDecision` | type, title, description, project_id, owner_name, due_date, severity, probability, impact, status, **department** | → projects (set null) | type/severity/probability/impact/status enums; idx type, status, project_id |
| `delivery_metrics` | `DeliveryMetric` | project_id, repo_name, metric_date, commits/deploys/open_defects/closed_defects, source | → projects | **unique (repo_name, metric_date, source)**; idx project_id, metric_date |
| `meetings` | `Meeting` | title, meeting_date, attendees `text[]`, source_notes | ← action items | attendees → array of string |
| `meeting_action_items` | `MeetingActionItem` | meeting_id, description, owner_name, due_date, status | → meetings (cascade) | status enum open/done; idx meeting_id |
| `activity_records` | `ActivityRecord` | person_name, role, department, activity_date, hours_today, on/off_project_minutes, screenshots_count, storage_used_mb, last_seen_at, status, source | — (matched to employees by `full_name`) | **unique (person_name, activity_date, source)**; idx activity_date |
| `ai_daily_briefs` | `AiDailyBrief` | brief_date **unique**, headline, body, generated_by | — | unique brief_date |
| `kpi_feed` | `KpiFeed` | company, metric_name, value, unit, as_of_date, updated_at | — | **unique (company, metric_name, as_of_date)** |
| `audit_log` | `AuditLog` | actor_id, actor_role, action, entity_type, entity_id, metadata | → users (set null) | idx (entity_type, entity_id), created_at |
| `approvals` | `Approval` | approvable_type, approvable_id, step, status, decided_by, decided_at, comment | polymorphic | status enum; idx (approvable_type, approvable_id), status |
| `notifications` | `Notification` | user_id, type, title, body, link, read_at | → users (cascade) | idx (user_id, created_at desc) |

### 5.2 Finance

| Table | Model | Key fields | Constraints |
| --- | --- | --- | --- |
| `finance_accounts` | `FinanceAccount` | name, type, currency, opening_balance, **current_balance**, is_active | type enum bank/cash/mobile-money; `current_balance` maintained by trigger → §5.5 |
| `finance_transactions` | `FinanceTransaction` | account_id, date, type, amount, category, counterparty, description, reference_no, is_dlap, dlap_share_pct, source, reverses_transaction_id, is_reversed, receipt_path, created_by | **`amount > 0`**; type enum debit/credit; source enum manual/excel-import; self-ref FK; idx (account_id,date), date |
| `finance_reports` | `FinanceReport` | type, period_start, period_end, **content jsonb**, generated_by/at, published_by/at, status | type enum daily/weekly/monthly; status enum draft/published; idx (type, period_start). `content` → Mixed subdocument |
| `finance_creditors` | `FinanceCreditor` | name, amount_owed, due_date, status, notes | status enum outstanding/partially_paid/paid |
| `finance_payment_notices` | `FinancePaymentNotice` | period, payee, amount, due_date, status, notes | status enum scheduled/sent/paid; idx due_date |
| `project_finance` | `ProjectFinance` | project_id **unique**, budget/cost_to_date/revenue_pipeline/contracted_revenue/receivables, as_of_date | unique project_id |
| `finance_company_totals` | `FinanceCompanyTotals` | as_of_date **unique**, revenue_pipeline, contracted_revenue, outstanding_receivables | unique as_of_date |

### 5.3 HR

| Table | Model | Key fields | Constraints |
| --- | --- | --- | --- |
| `employees` | `Employee` | full_name, role_title, department, employment_date, **supervisor_id (self-ref)**, status, **user_id unique**, jira_account_id | status enum active/on-leave/exited; idx supervisor_id, user_id |
| `job_descriptions` | `JobDescription` | employee_id, role_title, responsibilities, reporting_line, requirements, **version**, effective_date, attachment_path | **CHECK (employee_id OR role_title not null)**; idx (employee_id, version desc). Versioned — never overwritten |
| `leave_types` | `LeaveType` | name **unique**, days_per_year | unique name |
| `leave_balances` | `LeaveBalance` | **PK (employee_id, leave_type_id, year)**, days_allocated, days_used, **days_remaining GENERATED** | compound unique; `days_remaining` → Mongoose virtual |
| `leave_requests` | `LeaveRequest` | employee_id, leave_type_id, start/end_date, days_requested, reason, **status**, supervisor_id, supervisor_decision_at/comment, hr_decision_at/comment | `days_requested > 0`; status enum pending_supervisor/pending_hr/approved/rejected; idx employee_id, supervisor_id, status |
| `job_openings` | `JobOpening` | title, department, status, opened_at | status enum open/closed |
| `candidates` | `Candidate` | full_name, email, phone, resume_url | — |
| `applications` | `Application` | job_opening_id, candidate_id, stage, updated_at | **unique (job_opening_id, candidate_id)**; stage enum (6); idx (job_opening_id, stage) |
| `performance_reviews` | `PerformanceReview` | employee_id, period, reviewer_id, **goals jsonb**, rating, comments, status | status enum draft/submitted/acknowledged; idx employee_id |
| `training_records` | `TrainingRecord` | employee_id, course_name, provider, completed_at, certificate_url, expires_at | idx employee_id, expires_at |
| `attendance_records` | `AttendanceRecord` | employee_id, date, status, source | **unique (employee_id, date)**; status enum present/absent/late/on_leave; source enum manual/lazyboss |
| `employee_tasks` | `EmployeeTask` | employee_id, title, description, due_date, status, created_by | status enum todo/in_progress/done; idx employee_id |
| `jira_tasks_cache` | `JiraTaskCache` | employee_id, jira_issue_key, summary, status, due_date, url, fetched_at | **unique (employee_id, jira_issue_key)**; idx employee_id |

### 5.4 Views → aggregation pipelines / services

| View | Definition | Target |
| --- | --- | --- |
| `v_ceo_dashboard_kpis` | 12 scalar subqueries: project counts by status, tasks due next 7d, overdue tasks, critical blockers, 3 finance totals (latest `as_of_date`), team utilisation %, high-risk project count | `services/kpis.ts` — one function issuing parallel `countDocuments`/aggregations. **Must stay the single source of truth shared with `kpi_feed`** |
| `v_project_margins` | `(budget − cost_to_date)/budget × 100` | Computed virtual. *(Note: not read by any page today — `/finance` recomputes the margin inline.)* |
| `v_leave_requests` | Passthrough of `leave_requests` with **column-level masking**: `reason` is `null` unless caller is admin/exec/hr_officer/hr_manager **or** the employee themselves. `security_invoker = true` (fixed in 0026) | `services/leave.ts` — masking applied in the serializer, **not** left to each route. Supervisors see dates/type/days, never the reason |
| `v_training_expiring_soon` | `training_records` where `expires_at` between today and +30d. `security_invoker = true` | Query with a date-range filter |

### 5.5 Functions & triggers → services

| Object | Behavior | Target |
| --- | --- | --- |
| `current_role()` | caller's `profiles.role` | `req.user.role` |
| `current_employee_id()` | employee row for `auth.uid()` | `req.user.employeeId`, resolved by `requireAuth` |
| `is_supervisor_of(emp)` | is caller the supervisor of emp | `services/employees.isSupervisorOf()` |
| `get_account_balance_as_of(acct, date)` | `opening_balance + Σcredits − Σdebits` where `date <= as_of` | Aggregation `$group`/`$sum` in `services/finance/balances.ts` |
| `get_unusual_transactions(acct, date)` | flags txns on `date` with `abs(amount) > 2 × trailing-30-day avg abs(amount)`, window **excludes** `date` itself | Aggregation pipeline. **Preserve the exclusion** — it prevents a large txn inflating its own baseline |
| `refresh_kpi_feed()` | upserts 12 metrics from `v_ceo_dashboard_kpis` into `kpi_feed` on `(company, metric_name, as_of_date)` | `services/kpis.refreshKpiFeed()`, called by the LazyBoss import |
| `handle_new_user()` trigger | auto-creates a `profiles` row (role `viewer`) on signup | User-creation service |
| `recompute_account_balance()` trigger | **AFTER INSERT** on `finance_transactions` → recompute `current_balance`. Also what drives the realtime Cash Position panel | Post-write call in the transaction service. **Must be inside a Mongo transaction with the insert** (§10, D-11) |
| `recompute_leave_balance()` trigger | **AFTER UPDATE** on `leave_requests`, only when status transitions **to** `approved` (`OLD.status <> 'approved'`) → upsert `leave_balances`, `days_used += days_requested` | `services/hr/leave.ts`, inside the hrDecision transaction. **Preserve the OLD-status guard** or approving twice double-counts |

### 5.6 Storage buckets

Four private buckets: `jd-documents`, `contracts`, `payslips`, `receipts`.
No INSERT policies — uploads go through the service-role client after
`requireRole()`. SELECT policies:

| Bucket | Read access |
| --- | --- |
| `jd-documents` | admin, exec, hr_officer, hr_manager, supervisor, employee |
| `contracts` | admin, hr_officer, hr_manager **or** object path prefix = own employee id |
| `payslips` | same as contracts |
| `receipts` | admin, exec, finance_officer, finance_manager |

`contracts`/`payslips` have **no upload UI yet** — deliberate (SECURITY.md §4).
Path conventions `<employee_id>/<filename>` (HR) and
`<transaction_id>/<timestamp>-<name>` (receipts) are load-bearing for the
folder-prefix policy. **Preserve them.**

### 5.7 Seed data

| File | Contents | Migration note |
| --- | --- | --- |
| `supabase/seed.sql` (251 ln) | projects (12: 7 green/3 amber/2 red), milestones, 3 task batches, project_finance, company totals ($4.2m pipeline / $2.1m contracted / $480k receivables), risks, clients, activity_records (78.0% utilisation), delivery_metrics, 4 meetings + 4 action-item batches, ai_daily_briefs | Convert to `seed.js` using the same literal values. **The concept-doc KPI figures must reproduce exactly.** "Tasks due this week" (87) / "Overdue" (19) are date-relative and *expected* to drift |
| `supabase/seed_finance.sql` (59 ln) | finance_accounts, 3 transaction batches, creditors, payment notices | Same |
| `supabase/seed_hr.sql` (193 ln) | employees, 2 JD batches, leave_types, leave_balances, 3 leave_request batches, job_openings, candidates, applications, performance_reviews, 2 training batches, attendance, employee_tasks | Same. Leave requests are seeded at various statuses — do **not** let the approval trigger re-fire during seeding |
| Test accounts | 9 accounts `<role>@dokuma.local`, password `DokumaTest123!` | Must be created by the seed script (no Supabase Auth). **README and ONBOARDING both say rotate before real rollout** |

---

## 6. Postgres features with no Mongo equivalent

| Feature | Used for | Replacement |
| --- | --- | --- |
| Row Level Security | the entire second authz layer | Mandatory scope filters (§4.3, D-5) |
| Views | 4 views incl. column masking | Services + serializers (§5.4) |
| Triggers | balance + leave-balance recompute, profile autocreate | Explicit service calls in transactions (§5.5) |
| Generated columns | `leave_balances.days_remaining` | Mongoose virtual |
| `CHECK` constraints | ~30 enums + `amount > 0` + JD either-or | Mongoose `enum`/`min`/`validate` — **and** zod at the boundary |
| Compound `UNIQUE` | 7 constraints (§5.1–5.3) | Compound unique indexes; **upserts must target the same key set** |
| `ON DELETE CASCADE / SET NULL` | 20+ FKs | Explicit cascade in services or Mongoose middleware |
| `jsonb` | `finance_reports.content`, `performance_reviews.goals`, `audit_log.metadata` | Native — the one thing Mongo does *better* |
| `text[]` | `meetings.attendees` | Native array |
| `numeric(14,2)` | all money | **`Decimal128`, not `Number`** (§10, D-12) |
| Realtime publication | Cash Position live panel | Socket.IO / SSE (D-6) |
| `auth.users` | identity store | Own `User` collection |

---

## 7. Imports that must be replaced

### 7.1 Next.js

| Import | Files | Replacement |
| --- | --- | --- |
| `next/navigation` (`redirect`, `notFound`, `useRouter`, `usePathname`, `useSearchParams`) | ~20 | `react-router-dom`: `<Navigate>`, `useNavigate`, `useLocation`, `useSearchParams`; `notFound()` → 404 response + error boundary |
| `next/headers` (`cookies`, `headers`) | `lib/supabase/server.ts`, login action | `req.cookies`, `req.headers` |
| `next/cache` (`revalidatePath`) | 9 action files | Client refetch / React Query invalidation (D-3) |
| `next/server` (`NextResponse`, `NextRequest`) | 5 route handlers + middleware | Express `req`/`res` |
| `next/link` | nav, subnavs, several pages | `react-router-dom` `<Link>` |
| `next/image` | login page, nav sidebar | `<img>` + explicit sizing |
| `next/font/google` | `app/layout.tsx` | Self-hosted fonts (D-9) |
| `"use server"` / `"use client"` | 12 action files / ~20 components | Removed entirely |
| React `cache()` | `getProfile` | Per-request memo on `req` |

### 7.2 Supabase

| Import | Files | Replacement |
| --- | --- | --- |
| `@supabase/ssr` `createServerClient`/`createBrowserClient` | `lib/supabase/server.ts`, `client.ts` | Mongoose models + Express session |
| `@supabase/supabase-js` `SupabaseClient` type | server.ts, mfa.ts, leave.ts | Deleted |
| `createClient()` (server) | ~25 files | Service-layer calls |
| `createServiceRoleClient()` | ~12 files | Same services — the privileged/unprivileged split disappears; **authorization must move into the service scope argument** |
| `createClient()` (browser) | `nav-sidebar`, `notification-bell`, `cash-position-panel`, both MFA forms | `fetch` to Express + socket client |
| `supabase.auth.*` | login, signout, MFA, `getProfile`, `getCurrentEmployee`, `notify` | Own auth service |
| `supabase.storage.*` | `lib/storage/documents.ts` | GridFS/S3 (D-7) |
| `supabase.channel()` | `cash-position-panel.tsx` | Socket.IO (D-6) |
| `Database` type from `types/database.types.ts` | ~6 files | Types generated from Mongoose schemas. **Keep the hand-appended literal-union block** (`UserRole`, `ProjectStatus`, `LeaveRequestStatus`, …) — README step 6 warns it is hand-written, not generated |
| `hardenCookieOptions` | server.ts, login action | Express cookie options |

### 7.3 Node/server-only

| Import | Files | Note |
| --- | --- | --- |
| `node:crypto` (`scryptSync`, `randomBytes`, `randomUUID`, `timingSafeEqual`) | `lib/supabase/server.ts` shim | Keep — already Node-native |
| `mongodb` driver | server.ts shim, rate-limit.ts | Replace shim usage with Mongoose; keep for the rate-limit store |
| `@upstash/ratelimit`, `@upstash/redis` | rate-limit.ts | Optional — keep or drop with Vercel |
| `xlsx` | `lib/finance/import.ts` | Keep. **Two unpatched advisories** — mitigations (server-only parse, 5MB cap, per-row zod) must be preserved verbatim |
| `papaparse` | LazyBoss import | Keep |
| `@react-pdf/renderer` | 2 PDF routes + 4 documents | Keep — works under plain Node |
| `zod` | all validation | Keep verbatim |
| `Buffer` | storage, jira-client | Keep |

### 7.4 Unaffected

`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`,
`radix-ui`, `sonner`, `next-themes` (→ own theme provider), all of
`components/ui/*`, and `lib/utils.ts` formatters. `lib/hr/jira-client.ts` is
already a plain `fetch` client with zero Supabase coupling — ports as-is.

---

## 8. Validation strategy

**Principle preserved from SECURITY.md:** client-side validation is a UX nicety;
the server-side zod parse is the gate. Every zod schema in
`lib/validation/*.ts` ports **verbatim** — same field names, same limits, same
error messages.

| Layer | Today | Target |
| --- | --- | --- |
| HTTP boundary | zod `safeParse` in each Server Action | zod in Express middleware (`validate(schema)`), 400 + `{error}` on failure |
| Domain | Postgres CHECK/UNIQUE/FK | Mongoose enum/min/required/unique + explicit FK-existence checks |
| Files | `validateDocumentFile` 10MB + PDF/Word/image; import 5MB + `.xlsx/.xls/.csv` | Identical, via `multer` limits **plus** the same in-handler checks |
| Rows | per-row zod on every imported row | Identical |

Schemas to port: `finance-schema.ts` (7), `hr-schema.ts` (8),
`lazyboss-csv-schema.ts` (1), plus `importedRowSchema` inside `import.ts`.

Two inline validations bypass zod today and should be **converted to zod** for
consistency (behavior-identical): `updateCreditorStatusAction`'s
`["outstanding","partially_paid","paid"]` and
`updatePaymentNoticeStatusAction`'s `["scheduled","sent","paid"]`.

---

## 9. Feature-by-feature behavior to preserve

### Finance
- **Reversal, never deletion.** A reversal is a real offsetting transaction row
  linked by `reverses_transaction_id`; the original gets `is_reversed = true`.
  Nothing is ever deleted. Double-reversal is blocked explicitly.
- **Cash position is grouped by currency, never summed across currencies** —
  except `getTotalBalanceAsOf`, which deliberately *does* mix currencies for
  company-wide report totals. Both behaviors are intentional; keep both.
- **"Current Balance" ≠ "Closing Balance"** in weekly/monthly reports: closing
  is the balance at `period_end`, current is live at generation time.
  Documented in `lib/finance/reports.ts`. Keep both fields.
- Daily reports are **immediately published**, no draft step. Weekly/monthly
  default to draft and create a `finance_manager_signoff` approval step.
- Unusual-transaction detection: `>2× trailing-30-day average`, window excludes
  the check date.
- Payment notices page shows **current calendar month only** (UTC-computed range).
- Excel import is **all-or-nothing**; any invalid row aborts the whole import.

### HR
- Leave is a **real state machine**: `pending_supervisor → pending_hr →
  approved|rejected`. `supervisorDecisionAction` re-checks that the actor is the
  request's actual supervisor — role alone is insufficient.
- `leave_balances.days_used` increments **only** on the transition into
  `approved`.
- **Leave-reason masking**: supervisors never see `reason`. Enforced centrally
  in the view, not per-page — keep it centralized.
- Employee 360 attendance **prefers LazyBoss `activity_records` (matched by
  `full_name`) and falls back to manual `attendance_records`** — never both.
- Job descriptions are **versioned**, never overwritten; current = highest
  `version`.
- Jira tasks: 15-minute cache in `jira_tasks_cache`, refreshed on page view
  (pull, not cron). **Jira being down falls back to stale cache, never throws.**
- Performance review rating/comments are deliberately **not** masked
  (SECURITY.md judgment call #1).

### Notifications
- In-app write is unconditional; the Resend email leg is **best-effort and
  non-fatal** — a failed email must never fail the business action.
- Trigger checks (`checkPaymentNoticesDueSoon`, `checkTrainingExpiringSoon`) run
  **on page load**, not on a cron, and are **deduped per `(user, link, type)`**
  so revisiting a page does not re-notify.
- Resend custom domain `dokuma.co.zw` is **not DNS-verified** — emails currently
  fail (non-fatally) by design.

### LazyBoss
- Pluggable adapter (`CsvLazyBossAdapter` / `ApiLazyBossAdapter`), selected by
  `LAZYBOSS_SOURCE`. **No public API exists** as of 2026-08-18; the API adapter
  throws a descriptive error by design. Both adapters converge on
  `activity_records`. Keep the seam.
- Import upserts on `(person_name, activity_date, source)` and immediately
  refreshes `kpi_feed`. `activity_date` is always today's date.

### CSV export
- Pure client-side: the server builds **already-formatted** string rows, the
  button joins + quotes (`"` → `""`) and triggers a Blob download. No accessor
  functions cross the boundary. Present on 6 pages. Ports unchanged.

### PDF
- Server-rendered via `renderToBuffer`. 4 documents + shared `styles.ts`.
  Ports unchanged to an Express handler.

### KPI feed
- `/api/kpi-feed` is the **unconfirmed Group-platform contract** — README and
  ONBOARDING both flag that neither the transport (table vs. endpoint) nor the
  auth model (session vs. scoped API key) is agreed. It is currently
  session-authenticated. **Do not change the contract during migration**; see
  §10, D-13.

---

## 10. Ambiguities — each with a proposed decision

| # | Ambiguity | Proposed decision |
| --- | --- | --- |
| **D-0** | The in-tree Mongo shim over the Supabase API — extend or discard? | **Discard.** Build the Express API per this document; delete `LocalQueryBuilder`. The shim silently no-ops RPC, RLS, MFA, storage, realtime, triggers and joined selects (§0) — shipping on it means shipping those regressions. |
| **D-1** | Two login paths: `loginAction` (Server Action) and `/api/auth/login` (route). The page uses the route; the action is dead code. | **Keep one: `POST /api/auth/login`.** Delete `loginAction`. Both already rate-limit identically, so no behavior is lost. |
| **D-2** | 4 pages (`/projects`, `/projects/[id]`, `/delivery`, `/meetings`) have no `requireRole()` — they relied on RLS + the layout gate. Removing RLS removes their only data-layer gate. | **Add explicit `requireAuth` (any authenticated role) on their endpoints.** This matches today's effective behavior (`current_role() is not null`) and makes it explicit rather than incidental. Not a behavior change. |
| **D-3** | `revalidatePath` has no REST analogue. | **React Query** with per-resource invalidation mirroring each action's current `revalidatePath` calls (e.g. a reversal invalidates both `transactions` and `finance` — it revalidates both today). |
| **D-4** | Session cookie is `httpOnly:false` today — a *documented, accepted* trade-off because the browser Supabase client must read it. | **Switch to `httpOnly:true`.** The reason for `false` disappears entirely once there is no browser DB client — SECURITY.md itself names "route every client-side auth/realtime call through the server" as the real fix, which is exactly what this migration does. **This is a security improvement and needs explicit sign-off** as a deliberate change from documented behavior. |
| **D-5** | RLS → app-layer filters is the highest-risk step (RLS fails closed; a missing filter fails open). | **Make `scope` a required parameter** on every repository function; add an integration test per §4.3 row; **rewrite `scripts/rls-tests.mjs` as HTTP-level cross-role tests** and treat it as a merge gate. |
| **D-6** | Realtime Cash Position panel. | **Socket.IO**, room per resource; the transaction service emits `finance_accounts:updated` after the balance recompute. Fallback: 30s polling. Preserves the "Live" badge behavior. |
| **D-7** | Supabase Storage → ? | **GridFS** for parity (single Mongo dependency, no new vendor, private by default). Signed URLs → short-lived (60s, matching today) signed tokens on `GET /api/files/:id`. Enforce the four buckets' read rules (§5.6) as middleware, **including the `<employee_id>/` folder-prefix rule** for contracts/payslips. S3 is the alternative if file volume grows. |
| **D-8** | UUID PKs vs Mongo `ObjectId`. | **Keep UUID strings** in `_id`. Seed data, all FK values, storage path conventions and `audit_log.entity_id` all carry UUIDs today; switching to ObjectId would require rewriting every seed file and would break the zod `.uuid()` validators guarding 10+ endpoints. |
| **D-9** | `next/font/google` replacement. | **Self-host Inter + Source Serif 4** via `@fontsource`. README explicitly chose Source Serif 4 because it "renders consistently on Vercel regardless of client OS" — a CDN `<link>` reintroduces the failure mode that choice avoided. |
| **D-10** | `profiles` + `auth.users` are separate today (Supabase forces the split). | **Merge into one `User` model** (`email`, `passwordHash`, `fullName`, `role`, `mfa`). `Employee.user_id` still points at it. Removes `handle_new_user` entirely. |
| **D-11** | Trigger atomicity: the balance recompute and leave-balance increment are DB-atomic today. | **Use Mongo multi-document transactions** (requires a replica set — a single-node RS is fine for dev). Without this, a crash between insert and recompute leaves `current_balance` permanently wrong. `lib/finance/transactions.ts` already notes its sequential inserts are "atomic-enough"; the balance trigger is *not* — it is genuinely atomic today and must stay so. |
| **D-12** | `numeric(14,2)` money in Mongo. | **`Decimal128`.** JS `Number` is float64 — unacceptable for ledger balances summed across thousands of rows. Costs a `.toString()` at the serialization boundary. |
| **D-13** | `/api/kpi-feed` Group contract is unconfirmed (README + ONBOARDING). | **Freeze the contract as-is** — same path, same JSON shape, same session auth, same 30/60s limit. A migration is the wrong time to resolve an open cross-team question. Re-raise separately. |
| **D-14** | `viewer` role has no home route (`roleHomePath` default → `/projects`) and no module of its own. | **Preserve exactly.** Out of scope for this migration; note it for product. |
| **D-15** | `checkPaymentNoticesDueSoon` / `checkTrainingExpiringSoon` fire on page load, adding latency to a GET. | **Preserve the pull-based trigger** (behavior parity), but move it **after** the response in the Express handler (or into a `setImmediate` task) so it no longer blocks the render. Dedupe is per `(user, link, type)` and must remain. |
| **D-16** | `xlsx` has two advisories with **no upstream fix**. | **Keep `xlsx` + all three existing mitigations** (server-only parse, 5MB cap, per-row zod). Re-evaluate `exceljs` as a follow-up, not as part of this migration. |
| **D-17** | Next.js 14 was kept over 16 as an accepted risk. | **Moot** — the migration removes Next.js entirely. The 5 Next-derived `npm audit` findings disappear; `xlsx` (D-16) remains. |
| **D-18** | LazyBoss `activity_records` ↔ `employees` matched by `full_name` string. Fragile. | **Preserve the name match** (behavior parity) and add a nullable `employee_id` to `ActivityRecord` for a future proper link. Do not change the matching rule in this migration. |
| **D-19** | `contracts`/`payslips` buckets have policies but no UI. | **Port the policies, build no UI.** Matches the deliberate decision in SECURITY.md §4. |
| **D-20** | Jira uses a **personal** API token tied to the previous owner (ONBOARDING §5). | **Port as-is** (env-var driven, no code change), and flag the service-account replacement as an ops task. Not a migration blocker. |

---

## 11. Validation — every route and action has an entry

### 11.1 Page routes: 30 / 30

`find app -name page.tsx` → 30. Mapped in §2: rows 1–3 (auth/MFA), 4–5 (exec),
6–12 (portfolio/people/risk/clients/delivery/meetings), 13–21 (finance),
22–29 (HR), 30 (admin). **✔ complete**

### 11.2 API route handlers: 5 / 5

`app/api/auth/login`, `app/api/auth/signout`, `app/api/kpi-feed`,
`app/api/finance/payment-notices/[id]/pdf`,
`app/api/finance/reports/[id]/pdf` — all in §3.1. **✔ complete**

### 11.3 Server Actions: 26 / 26

`grep -c "export async function"` across the 12 `actions.ts` files → 26:

| File | Actions | In §3.2 |
| --- | --- | --- |
| `(auth)/login/actions.ts` | 1 | ✔ |
| `admin/import/lazyboss-csv/actions.ts` | 1 | ✔ |
| `finance/creditors/actions.ts` | 2 | ✔ |
| `finance/import/actions.ts` | 2 | ✔ |
| `finance/payment-notices/actions.ts` | 2 | ✔ |
| `finance/reports/actions.ts` | 4 | ✔ |
| `finance/transactions/actions.ts` | 4 | ✔ |
| `hr/employees/[id]/actions.ts` | 2 | ✔ |
| `hr/leave/actions.ts` | 3 | ✔ |
| `hr/performance/actions.ts` | 1 | ✔ |
| `hr/recruitment/actions.ts` | 3 | ✔ |
| `hr/training/actions.ts` | 1 | ✔ |
| **Total** | **26** | **✔ complete** |

### 11.4 Layouts: 3 / 3 (§2.7) · Middleware: 1 / 1 (§4.2)

### 11.5 Database objects

35 tables (§5.1–5.3), 4 views (§5.4), 9 functions + 3 triggers (§5.5),
4 storage buckets (§5.6), 3 seed files (§5.7). **✔ complete**

---

## 12. Suggested migration order

1. **Foundation** — Express + Mongoose scaffold, `User`/`Profile` model, seed script, connection handling.
2. **Auth** — login/logout/session/MFA/rate limiting. Nothing else works without it. (D-1, D-4, D-10)
3. **AuthZ** — `requireRole`, `requireMfa`, department scope, the §4.3 filter table, and the rewritten cross-role test suite **before** any module ships. (D-5)
4. **Read-only modules** — projects, delivery, meetings, risks, clients, people, KPI feed. Lowest risk, proves the data layer.
5. **Finance** — models, balance service + transaction atomicity (D-11), reports, PDF, import, realtime (D-6).
6. **HR** — employees, leave state machine + masking, recruitment, performance, training, Jira.
7. **Cross-cutting** — notifications, approvals, audit log, storage (D-7).
8. **Frontend** — React Router port, React Query wiring (D-3), component migration.
9. **Verification** — reproduce the seeded KPI figures exactly; re-run the cross-role suite; confirm every §9 behavior.
