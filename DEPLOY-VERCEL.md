Written for: whoever deploys this (you, or an engineer taking it over).

# Deploying to Vercel

The whole application — Vite client and Express API — runs on Vercel. The
client builds to static assets; the API runs as a single serverless function
that the Express app is mounted inside.

## Layout

```
api/index.ts        the serverless function — mounts the Express app
vercel.json         build, routing and caching config
client/dist         the built SPA (Vercel's output directory)
```

Both are served from one origin, so the browser calls `/api/...` as a
same-origin request. That keeps the `httpOnly`, `sameSite: "strict"` session
cookie working exactly as it does locally.

## Environment variables

Set these in **Project → Settings → Environment Variables**. All are
server-only; none may be given a `VITE_` prefix, because Vite inlines every
`VITE_*` variable into the browser bundle.

| Variable | Value | Notes |
| --- | --- | --- |
| `MONGODB_URI` | your Atlas connection string | Must be a replica set — transactions (D-11) need one. Atlas always is. |
| `MONGODB_DATABASE` | `dokuma` | |
| `SESSION_SECRET` | 32 random bytes, hex | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The server refuses to boot in production with the default. |
| `NODE_ENV` | `production` | Vercel sets this for you; setting it explicitly is harmless. |
| `CLIENT_ORIGIN` | `https://your-project.vercel.app` | Only used for cross-origin requests. Same-origin traffic needs no grant. |

Later, when Finance and HR land:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` | Notification emails. Non-fatal if unset. |
| `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Employee 360's Jira tab. |
| `LAZYBOSS_SOURCE` | `csv` (default) or `api`. |

## Atlas network access

Vercel functions do not have fixed outbound IPs. In Atlas:

**Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**

This is the normal configuration for serverless and is why the database user's
password has to be strong — the network is not the control, the credential is.

## Deploying

```bash
npm i -g vercel
vercel login
vercel          # preview deployment
vercel --prod   # production
```

Or connect the Git repository in the Vercel dashboard and push.

The build runs `npm run vercel-build`, which builds `@dokuma/shared` (both the
client and the API import it) and then the client. Vercel compiles
`api/index.ts` itself.

## Seeding a fresh database

Run against the deployed database from your own machine, with `server/.env`
pointing at the same `MONGODB_URI`:

```bash
npm run db:indexes --workspace @dokuma/server   # build every index
npm run db:seed    --workspace @dokuma/server   # demo data — DROPS app collections
npm run seed:users --workspace @dokuma/server   # the nine test accounts
```

Create a real admin and get a set-password link:

```bash
npm run invite --workspace @dokuma/server -- \
  --email you@dokuma.co.zw --name "Your Name" --role admin \
  --base-url https://your-project.vercel.app
```

## Things that behave differently on serverless

These are real consequences of the platform, not bugs:

**Cold starts.** The first request to an idle instance pays ~1.5s to connect to
Atlas; subsequent requests on that instance are ~4ms. The connection promise is
cached per instance (`server/src/db/serverless.ts`), so concurrent requests
during a cold start share one connect rather than opening several.

**Connection count.** Each warm instance holds its own small pool
(`maxPoolSize: 5`). Under heavy concurrency Vercel runs many instances, and
Atlas caps connections per tier — the free tier allows 500. If you see
connection errors under load, that is the limit, and the fix is a larger Atlas
tier or fewer instances.

**Rate limiting is per-database, not per-instance.** The counters live in Mongo
(`rate_limit_windows`), so the 5/60s login limit holds across instances. That
was already true before this change; it is only worth stating because an
in-memory limiter would have silently stopped working here.

**Request body size.** Vercel caps a function's request body at 4.5MB. The
document-upload path (receipts, JD attachments — not yet built) allows 10MB, so
when that lands it will need direct-to-storage uploads rather than posting the
file through the function.

**`maxDuration` is 30s.** Long PDF generation or a large CSV import could hit
it. Neither is built yet; both are worth measuring when they are.

## Verifying a deployment

```bash
curl https://your-project.vercel.app/api/health
```

Then sign in through the UI and check that a protected route loads. If the API
returns 503, the function could not reach Mongo — check `MONGODB_URI` and the
Atlas IP allowlist.
