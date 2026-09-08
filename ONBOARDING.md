# Onboarding — Dokuma Command Centre

You're picking up an existing, live project: a Next.js 14 + Supabase executive
dashboard for Dokuma (Private) Limited, currently in production. This doc is
the handoff — what access you need, what's already decided, and where to
start reading. Read this before touching anything else.

## 1. Read these first, in order

1. [`README.md`](README.md) — stack, local setup, module list, LazyBoss/Group-platform
   caveats that are still open questions.
2. [`SECURITY.md`](SECURITY.md) — auth model, RLS, MFA, rate limiting, the full
   OWASP walkthrough, npm audit findings, and every judgment call made along
   the way (some need your review, not just acceptance).
3. This file, for the parts specific to a handoff (access, secrets, live state).

## 2. Live environment

- **Production**: https://dokuma-command-centre.vercel.app
- **Repo**: https://github.com/Tadiwanashemandina/dokuma-command-center
- **Database**: Supabase project `tsxijexedzxdbwzrvaps`
- **Vercel project**: `dokuma-command-centre`, currently under the previous
  owner's *personal* Vercel account (scope `tadiwanashe`), not a Team.

## 3. Access you need granted

Ask the outgoing owner for each of these — they're separate systems, so each
needs its own invite:

| System | What to ask for | How |
| --- | --- | --- |
| **GitHub** | Collaborator (or transfer/fork if you want to own the repo) | Repo → Settings → Collaborators and teams → Add people |
| **Vercel** | Project access | See note below — this account is on the Hobby (personal) plan, which has no per-project collaborator invites. Either (a) the owner upgrades to a Team plan and invites you, (b) the project is transferred to a Team you're both on, or (c) you keep working through GitHub and the owner handles deploys until one of the above happens. Ask which they'd prefer. |
| **Supabase** | Project member (Owner or Developer role) | Project → Organization settings → Team → Invite |
| **Resend** (email) | Team member, or just the API key if it's a solo plan | Resend dashboard → Team |
| **Upstash** (Redis) | Provisioned via the Vercel Marketplace integration — you inherit it automatically once you have Vercel project access; no separate signup | — |
| **Jira** (`dokumadigital.atlassian.net`) | Nothing needed to keep it running — the current integration uses a personal API token tied to the previous owner's account (see §5) | Only relevant if that token needs replacing |

## 4. Local setup

Once you have GitHub + Supabase access:

```bash
git clone https://github.com/Tadiwanashemandina/dokuma-command-center.git
cd dokuma-command-center
npm install
cp .env.local.example .env.local   # then fill in real values, see §5
npm run dev
```

Full details (Supabase CLI link, migrations, seed data) are in the README's
**Local setup** section — don't duplicate that here, just follow it.

## 5. Secrets — do not ask for these over chat/email

The previous owner should **not** paste `.env.local` contents into Slack,
email, or a chat message. Once you have Vercel project access, pull the real
production values directly:

```bash
vercel link        # links this folder to the dokuma-command-centre project
vercel env pull .env.local
```

This is both more secure and less error-prone than a manual copy-paste — it
guarantees your local env matches what's actually deployed.

**If you don't have Vercel access yet** and need to unblock local dev sooner,
the previous owner can share the Supabase URL/anon key (both are already
public-facing, safe over any channel) and you can generate your own Resend/
Jira/Upstash credentials independently — everything else in the app works
against your own Supabase branch or the shared one, your call.

### Recommend rotating before/at handoff

The `SUPABASE_SERVICE_ROLE_KEY` and any personal Vercel/Supabase access
tokens the previous owner generated (used only for one-off CLI operations
during development — deploys, migrations) should be **rotated**, not
reused, once you're set up:

- Supabase: Project Settings → API → regenerate the service role key, then
  update it in Vercel's env vars (Project → Settings → Environment Variables)
  and redeploy.
- Vercel personal access tokens: these were single-session tokens, not
  stored anywhere persistent — nothing to rotate, just don't reuse an old
  one if you find it written down somewhere.
- Jira API token: currently tied to the previous owner's personal Atlassian
  account (`JIRA_EMAIL` in env). This works fine operationally (the app
  polls Jira server-side with one shared token regardless of who's viewing),
  but it's a personal-identity credential doing an app-level job. Worth
  replacing with a dedicated Jira service account's token when convenient —
  not urgent, just don't let it become a "the app breaks if that person
  ever leaves the Jira org" landmine.

## 6. Test accounts

Nine seeded accounts, one per role, password `DokumaTest123!` for all:
`admin@dokuma.local`, `exec@dokuma.local`, `viewer@dokuma.local`,
`finance-officer@dokuma.local`, `finance-manager@dokuma.local`,
`hr-officer@dokuma.local`, `hr-manager@dokuma.local`,
`supervisor@dokuma.local`, `employee@dokuma.local`.

The four Finance/HR-tier accounts require MFA (TOTP) enrollment on first use
of a Finance/HR page — that's real Supabase Auth MFA, not a stub, so you'll
need an authenticator app (or compute a TOTP code from the enrollment secret
programmatically, same as was done during development/testing).

## 7. What NOT to re-litigate without a reason

These were deliberate decisions, documented in `SECURITY.md` — worth reading
the reasoning before changing them:

- Session cookies are `HttpOnly: false` (the browser client needs to read
  the cookie for sign-in/sign-out and Finance's realtime subscription).
- The app stays on Next.js 14, not 16, despite `npm audit` flagging 5 of its
  6 findings as fixable only via that major bump — accepted as a documented
  risk, with an upgrade path written down.
- `xlsx`'s two advisories have no upstream fix at all — mitigated in
  application code (file-size cap, server-only parsing, strict zod
  validation), not by swapping the library.
- Risks/Issues/Decisions and Clients & Stakeholder are department-scoped for
  Finance/HR roles with **no fallback to untagged rows** — if you add new
  risk or client records, remember to set their `department` column
  explicitly, or Finance/HR users won't see them at all (this is
  intentional, not a bug to work around).

## 8. Known open items (not yet resolved, not silently dropped)

- **LazyBoss has no confirmed public API** — running on a CSV-upload
  fallback (`lib/datasources/lazyboss.ts`). See README §"Two things flagged
  for follow-up."
- **The Group platform's polling contract for `kpi_feed`/`/api/kpi-feed` is
  unconfirmed** — don't wire up a consumer against it until that's settled
  with whoever owns `fossil-command-centre`.
- **Resend custom domain (`dokuma.co.zw`) DNS records are not yet verified**
  — real notification emails won't send until that propagates (the in-app
  notification still lands regardless; email failure is non-fatal by
  design). Check status at the Resend dashboard.
- **HR's Risks and Clients views are currently empty** — not a bug, just
  reflects that no HR-specific risk or client record exists in the seed
  data yet (see §7's department-scoping note).
