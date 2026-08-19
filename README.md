# Dokuma Command Centre

An executive dashboard for Dokuma (Private) Limited — a live, single source of
truth for projects, finance, people, risk, clients, delivery and meeting
intelligence. Built with Next.js 14 (App Router, TypeScript), Tailwind CSS v4,
shadcn/ui, and Supabase (Postgres + Auth), styled in Dokuma's navy/steel/teal/
gold brand.

Companion to the Dokuma AI Executive Command Centre concept note. Mirrors the
Group's own `fossil-command-centre` in structural language (sidebar nav, card
grid, breadcrumb header) while using Dokuma's own brand palette.

## ⚠️ Two things flagged for follow-up, not silently assumed

1. **LazyBoss has no confirmed public API.** As of 2026-08-18, lazybossapp.xyz's
   public marketing page exposed no documented REST API, `/api`, `/docs`, or
   CSV export endpoint (it's likely behind a login-gated settings page nobody
   has checked yet). The People & Delivery module is built against a pluggable
   adapter (`lib/datasources/lazyboss.ts`) defaulting to a CSV-upload path
   (`/admin/import/lazyboss-csv`). If/when a real API is confirmed, implement
   `ApiLazyBossAdapter` in that same file and flip `LAZYBOSS_SOURCE=api` — no
   page code needs to change, since both adapters converge on the same
   `activity_records` table shape.
2. **The Group platform's actual polling contract is unconfirmed.** This repo
   exposes both a `kpi_feed` Postgres table and a session-authenticated
   `/api/kpi-feed` route with a stable schema (`company, metric_name, value,
   unit, as_of_date, updated_at`). But whether the Group's `fossil-command-centre`
   platform will read the table directly or poll the route, and what auth
   model it expects (session vs. a scoped API key), has **not** been confirmed
   with whoever built that platform. Don't wire up a Group-side consumer
   against this contract until that's settled.

## Modules

1. **CEO Home Dashboard** (`/`) — 10 KPI cards, Green/Amber/Red proportion bar, AI daily brief panel
2. **Company Overview** (`/company`)
3. **Project Portfolio** (`/projects`, `/projects/[id]`)
4. **People & Delivery** (`/people`) — LazyBoss-fed, admin/exec only
5. **Finance** (`/finance`) — admin/exec only
6. **Risks, Issues & Decisions** (`/risks`)
7. **Client & Stakeholder Management** (`/clients`)
8. **Software Delivery Intelligence** (`/delivery`)
9. **Meeting Intelligence** (`/meetings`)

Plus `/admin/import/lazyboss-csv` (admin only) and `/api/kpi-feed`.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui
- Supabase: Postgres, Auth, Row Level Security — via `@supabase/ssr` (server-rendered, cookie-based sessions; no client-side fetching of sensitive tables)
- `papaparse` + `zod` for CSV import validation
- Fonts: Source Serif 4 (headings, a Cambria-style transitional serif that renders consistently on Vercel regardless of client OS) + Inter (body)

## Local setup

1. **Node.js 20+** and npm.
2. **A Supabase project** (free tier is fine). From Project Settings → API, get:
   - Project URL
   - anon/publishable key
   - service role/secret key (server-only, never exposed to the browser)
3. Copy `.env.local.example` to `.env.local` and fill in the three values above, plus `LAZYBOSS_SOURCE=csv`.
4. Install the Supabase CLI (`npx supabase --version` works without a global install) and link the project:
   ```bash
   npx supabase login          # or set SUPABASE_ACCESS_TOKEN
   npx supabase init
   npx supabase link --project-ref <your-project-ref>
   ```
5. Apply the schema and seed data:
   ```bash
   npx supabase db push --linked --include-all --include-seed
   ```
   This runs `supabase/migrations/0001..0011_*.sql` then `supabase/seed.sql`.
6. Generate/refresh TypeScript types against the live schema (recommended after any migration change):
   ```bash
   npx supabase gen types typescript --linked > types/database.types.ts
   ```
   Note: `supabase gen types` widens Postgres `CHECK` constraints to plain
   `string`. The literal union types the app actually uses (`ProjectStatus`,
   `UserRole`, etc.) are hand-appended at the bottom of
   `types/database.types.ts` — keep that block when regenerating.
7. Create at least one user in Supabase Auth and set their `profiles.role` to
   `admin`, `exec`, or `viewer` (new signups default to `viewer` via a
   trigger). There's no self-serve signup UI in v1.
8. `npm install && npm run dev`, then sign in at `http://localhost:3000/login`.

## Seed data

`supabase/seed.sql` seeds the **exact illustrative KPI figures** from the
concept doc: 12 active projects (7 Green / 3 Amber / 2 Red), 6 critical
blockers, $4.2m revenue pipeline, $2.1m contracted revenue, $480k outstanding
receivables, 78.0% team utilisation, 3 high-risk projects. These are
guaranteed stable regardless of when you seed. "Tasks Due This Week" (87) and
"Overdue Tasks" (19) are rolling date-relative windows tuned to land exactly
on those figures at seed time — they'll drift as real dates pass, which is
expected, not a bug.

Re-running `db push --include-seed` re-applies the seed (most tables aren't
upserting, so don't run it twice against a project you've since edited by
hand without expecting duplicate rows in un-keyed tables like `projects`).

## Auth & roles

Three roles: `admin`, `exec`, `viewer`, stored in `profiles.role`. Finance and
People & Delivery (plus the LazyBoss CSV import) are restricted to
`admin`/`exec` at both the app layer (`requireRole()` in
`lib/supabase/server.ts`, redirects viewers home) and the database layer (RLS
policies in `supabase/migrations/0011_rls_policies.sql`). Every other module
is readable by any authenticated user.

## Test accounts

Three accounts were created in Supabase Auth during build verification, one
per role — useful for continued local testing, but **rotate the password or
delete these before any real rollout**:

- `admin@dokuma.local` / `exec@dokuma.local` / `viewer@dokuma.local`
- Password: `DokumaTest123!`

## LazyBoss CSV import

`/admin/import/lazyboss-csv` (admin only) accepts a CSV with columns:
`person_name, role, department, hours_today, on_project_minutes,
off_project_minutes, screenshots_count, storage_used_mb, last_seen_at,
status`. Re-uploading for the same day **updates** existing rows (unique on
`person_name, activity_date, source`) rather than duplicating them, and
immediately refreshes `kpi_feed`'s Team Utilisation figure.

## Deploying to Vercel

1. Push this repo to GitHub/GitLab and import it in Vercel.
2. Set environment variables in the Vercel project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LAZYBOSS_SOURCE`.
3. Confirm the target Supabase project has migrations + seed applied (steps above) — production and local can point at the same Supabase project, or you can link a second project for prod and repeat the `db push` step against it.
4. Deploy.
