# Security

This document covers the security posture of the Dokuma Command Centre as of the Phase 3
(Shared Infrastructure, Security & Polish) build: what's in place, what was checked and how,
the dependency findings and why they're not fixed today, and the trade-offs made along the
way that are worth a second pair of eyes.

## Authentication & session management

- **Identity**: Supabase Auth (email/password), no custom auth code.
- **Cookies**: session cookies are set with `Secure` (production only — `NODE_ENV === "production"`)
  and `SameSite=Strict`, layered on top of `@supabase/ssr`'s defaults in
  [`lib/supabase/cookie-options.ts`](lib/supabase/cookie-options.ts), applied in both
  [`lib/supabase/server.ts`](lib/supabase/server.ts) and [`lib/supabase/middleware.ts`](lib/supabase/middleware.ts).
- **`HttpOnly` is deliberately left `false`.** This is a known, accepted trade-off, not an
  oversight: `@supabase/ssr`'s browser client needs to read the session cookie directly for
  `signInWithPassword`/sign-out and for the Finance Cash Position realtime subscription (see
  [`components/finance/cash-position-panel.tsx`](components/finance/cash-position-panel.tsx)).
  A full fix means routing every client-side auth/realtime call through Server Actions and
  re-architecting realtime auth — real work, out of scope for this pass. The actual blast
  radius if this is exploited is an XSS bug reading the session cookie; **no XSS vector is
  currently known** — there is zero use of `dangerouslySetInnerHTML` anywhere in the codebase
  (verified by repo-wide grep), and React escapes all rendered content by default.
- **Login now goes through a Server Action** ([`app/(auth)/login/actions.ts`](app/(auth)/login/actions.ts))
  instead of a direct client-side call to Supabase's auth API, specifically so a rate limiter
  can sit in front of it (see Rate limiting below). This also means the very first session
  cookie is set through our own hardened `setAll`, not the browser client's defaults.
- **MFA (TOTP)** is required for `finance_officer`, `finance_manager`, `hr_officer`, and
  `hr_manager` roles — see the dedicated section below. `admin`/`exec` are intentionally not
  forced into it, per the brief's own scoping of MFA to Finance and HR.

## Authorization

Two independent layers, by design — neither is trusted alone:

1. **App-level**: every restricted page and Server Action calls `requireRole([...])`
   ([`lib/supabase/server.ts`](lib/supabase/server.ts)), which redirects unauthenticated
   users to `/login` and wrong-role users to `/`.
2. **Database-level (RLS)**: every table has Row Level Security enabled with explicit
   per-role `select` policies. There are no client-side `insert`/`update`/`delete` policies
   anywhere in the schema — every write goes through a Server Action using the service-role
   client (which bypasses RLS) after the `requireRole()` + zod check above. RLS is what stops
   a signed-in user from reading data directly via the Supabase client that the UI wouldn't
   show them, regardless of what any given page renders.

[`scripts/rls-tests.mjs`](scripts/rls-tests.mjs) codifies the cross-role checks that were
verified by hand throughout Phases 1-3 (Finance/HR cross-domain isolation, employee row
scoping, leave-reason masking, private Storage bucket access) into a script you can re-run
after any future migration touches RLS:

```bash
node --env-file=.env.local scripts/rls-tests.mjs
```

All 11 checks pass against the live database as of this commit.

### The view-security bug this caught

`v_leave_requests` and `v_training_expiring_soon` were originally created as plain views,
which in Postgres **execute with the view owner's privileges by default, not the caller's** —
silently bypassing the underlying tables' RLS. A Supervisor could have seen every other
team's leave requests (though the reason-masking `case` expression still worked, since it
reads `auth.uid()` directly rather than relying on row filtering). Fixed in
[`0026_hr_view_security_invoker.sql`](supabase/migrations/0026_hr_view_security_invoker.sql)
via `alter view ... set (security_invoker = true)`, and re-verified live: a supervisor
session now sees only their own and their direct reports' rows.

## MFA

Uses Supabase Auth's native TOTP enroll/challenge/verify APIs — no new credential or
third-party dependency ([`lib/supabase/mfa.ts`](lib/supabase/mfa.ts)).

- `requireRole()` checks the session's Authenticator Assurance Level (AAL) for the four
  Finance/HR roles. A session at AAL1 is redirected to `/account/mfa/enroll` (no verified
  TOTP factor yet) or `/account/mfa/verify` (factor exists, this session hasn't cleared the
  challenge yet).
- `admin` and `exec` are never gated, per the brief's explicit scoping.
- Verified live end-to-end: enrolled a real TOTP factor as `finance-manager@dokuma.local`
  (computed an actual 6-digit code from the returned secret — not a mocked flow), confirmed
  a fresh sign-in routes to the challenge page rather than enrollment once a factor exists,
  and confirmed `exec` reaches Finance with zero MFA interruption.
- One auth-js quirk worth knowing: `listFactors()`'s per-type buckets (e.g. `.totp`) only
  ever contain **verified** factors — unverified ones only appear in `.all`. The enrollment
  page clears any stale unverified factor from `.all` before re-enrolling, since Supabase
  rejects a second enroll while one is pending.

## Rate limiting

Real, distributed rate limiting via Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`,
[`lib/rate-limit.ts`](lib/rate-limit.ts)) — not in-memory, so it holds across serverless
instances:

- **Login**: 5 attempts / 60s per IP, enforced inside the login Server Action.
- **`/api/kpi-feed`**: 30 requests / 60s per IP.

Verified live: 6 rapid login submissions got blocked on the 6th, and the sliding-window keys
were confirmed directly in the live Upstash instance (not just inferred from UI behavior).

Note: `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Vercel's Upstash Marketplace naming) are used
directly — `Redis.fromEnv()` expects different `UPSTASH_REDIS_REST_*` names and would not
have picked these up.

## Data protection

- **Service-role key isolation**: `SUPABASE_SERVICE_ROLE_KEY` is referenced only from
  server-only files (Server Actions and `lib/*` modules with no `"use client"` directive).
  Verified by repo-wide grep: every file importing `createServiceRoleClient` or referencing
  the env var directly was checked, and none carry a `"use client"` directive.
- **Document storage**: four private Supabase Storage buckets (`jd-documents`, `contracts`,
  `payslips`, `receipts`), all `public: false`. No bucket has an `insert` policy — uploads go
  through a Server Action using the service-role client after `requireRole()`, exactly like
  every other write path. Reads go through the caller's own cookie-session client generating
  a signed URL, so viewing is scoped by each bucket's own Storage RLS policy, not bypassed.
  Two buckets are wired to a real consumer (finance receipts, JD attachments); `contracts`
  and `payslips` have correct policies in place for the next real feature to use.
- **Upload validation**: size-capped at 10MB and type-restricted to PDF/Word/image
  ([`lib/storage/documents.ts`](lib/storage/documents.ts)) before anything touches Storage.
- **Excel import** (`xlsx`/SheetJS): file-size cap, then every row goes through zod
  validation before being written — a malformed row is rejected, not coerced. This is also
  the practical mitigation for `xlsx`'s known unpatched advisories (see Dependencies below):
  the parse only ever runs server-side, on a size-capped file, with strict schema validation
  of the output.
- **Audit logging**: every mutating Server Action across Finance and HR writes to
  `audit_log` (actor, action, entity, metadata). The one gap found during this pass — the
  LazyBoss CSV import — was fixed to match.

## Input validation

zod schemas validate every Server Action's input server-side
([`lib/validation/finance-schema.ts`](lib/validation/finance-schema.ts),
[`lib/validation/hr-schema.ts`](lib/validation/hr-schema.ts)) — client-side form validation
is a UX nicety, never the actual gate.

## OWASP Top 10 (2021) walkthrough

| Risk | Status |
| --- | --- |
| A01 Broken Access Control | RLS + `requireRole()` on every restricted path, verified cross-role (`scripts/rls-tests.mjs`). No client-side write policies anywhere. |
| A02 Cryptographic Failures | No custom crypto. TLS everywhere (Supabase, Vercel, Resend, Upstash all HTTPS-only). Secrets live in env vars, never in code or client bundles. |
| A03 Injection | No raw SQL string interpolation anywhere in the app (verified by grep) — all queries go through the Supabase client's parameterized query builder. zod validates all Server Action input. |
| A04 Insecure Design | Reversal-not-deletion for financial transactions; a real state-machine (not a status flag) for leave approval; two independent authorization layers rather than one. |
| A05 Security Misconfiguration | Cookie hardening (this pass); RLS enabled on every table; no debug endpoints; `.env*` and `.vercel` gitignored. |
| A06 Vulnerable Components | `npm audit` run and documented below — 6 high, 0 critical, with an explicit accepted-risk decision on the un-fixable ones. |
| A07 Identification & Auth Failures | Supabase Auth; MFA required for Finance/HR; rate-limited login; hardened cookies. |
| A08 Software & Data Integrity Failures | No unpinned script tags, no `eval`/dynamic `require` of remote code; dependencies come from `package-lock.json` only. |
| A09 Security Logging & Monitoring Failures | `audit_log` now covers every mutation across Finance, HR, and admin import. |
| A10 Server-Side Request Forgery | No user-controlled URLs are fetched server-side; the only outbound calls (Jira, Resend, Upstash) use hardcoded hostnames with server-only credentials. |

## Dependency audit

```
npm audit
6 high severity vulnerabilities
```

| Package | Issue | Fix available? |
| --- | --- | --- |
| `xlsx` | Prototype pollution + ReDoS (SheetJS advisories) | **No.** SheetJS stopped publishing patches to the npm registry for this line. Mitigated in application code (see Data protection above): server-side-only parsing, file-size cap, strict zod validation of every parsed row. |
| `next`, `eslint-config-next`, `@next/eslint-plugin-next`, `glob`, `postcss` (transitive via `next`) | Various, fixed in Next.js 16 | Only via a Next.js 14 → 16 **major** version bump. |

**Decision (confirmed with the project owner): accept this as a documented risk for now.**
A same-day Next.js 14→16 major bump across a working, tested 30+ route application — App
Router behavior, middleware, server actions, and every third-party integration (Supabase,
Resend, Upstash) would all need re-validation — carries more real risk than the vulnerabilities
themselves in the near term. `npm audit fix` (non-force) was run and confirmed it resolves
nothing, as expected. **Upgrade path when scheduled**: bump `next` and `eslint-config-next`
to latest 16.x, re-run the full manual verification pass in this document plus
`scripts/rls-tests.mjs`, re-run `npm audit`.

## Judgment calls worth a second look

These were flagged during the build rather than silently decided:

1. **`performance_reviews.rating`/`comments` have no masking view**, unlike leave reason.
   Reasoning: a performance rating is something the reviewing Supervisor typically wrote
   themselves, and RLS already limits visibility to self/the-employee's-own-supervisor/
   HR-tier — that supervisor legitimately needs to see what they assessed. If this should be
   masked further (e.g. from the employee themselves, or between review cycles), that's a
   product decision, not a security gap in what's built.
2. **`HttpOnly: false`** on session cookies — covered above, with the actual blast radius
   (an as-yet-nonexistent XSS bug) spelled out rather than left implicit.
3. **Next.js 14, not 16** — accepted risk, covered above, with a concrete upgrade path.
4. **`contracts` and `payslips` Storage buckets exist with correct RLS policies but no
   upload UI yet** — built this way deliberately (matching Finance receipts and JD
   attachments, which are wired end-to-end) rather than shipping four empty upload forms
   nobody asked for yet. The policies are ready for the next real feature.
5. **The Resend custom domain (`dokuma.co.zw`) is provisioned but not yet DNS-verified**
   (status: `not_started` as of this writing) — the DNS records were retrieved and handed to
   the project owner; propagation and verification is outside what this session can do
   (it requires access to the domain's actual DNS registrar). Until it verifies, real
   notification emails will fail to send — **non-fatally**, by design: the in-app
   notification always lands regardless (see `lib/notifications/send.ts`). A real send was
   verified working end-to-end using Resend's shared sandbox sender, confirming the
   `RESEND_API_KEY` and the integration code are both correct; only DNS propagation for the
   custom domain remains.

## Re-verifying this document's claims

```bash
npm audit                              # dependency findings
node --env-file=.env.local scripts/rls-tests.mjs   # cross-role RLS checks
npm run build                          # confirms the app still compiles clean
```
