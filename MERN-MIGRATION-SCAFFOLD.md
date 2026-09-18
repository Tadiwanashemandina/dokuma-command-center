# MERN Migration — Phase 2 scaffold

The monorepo skeleton created by Prompt 2. This phase moved **configuration and
dependency concerns only**. No feature code was ported, and the legacy Next.js
app is untouched and still runnable.

## Layout

```
client/     React 18 + Vite 5 + TypeScript SPA      → @dokuma/client
server/     Express 4 + TypeScript REST API          → @dokuma/server
shared/     Contracts shared by both                 → @dokuma/shared
app/ components/ lib/ types/   legacy Next.js tree — untouched
```

npm workspaces. `@dokuma/shared` is consumed as a built package (`shared/dist`),
so the client and server both resolve the same compiled types.

## Commands

| Command | Effect |
| --- | --- |
| `npm install` | Installs all three workspaces plus the legacy tree |
| `npm run dev` | Builds `shared`, then runs shared-watch + server + client together |
| `npm run dev:server` | Express alone on :4000 |
| `npm run dev:client` | Vite alone on :5173 |
| `npm run typecheck` | Type-checks all three packages |
| `npm run build` | Builds all three |
| `npm run lint` | ESLint over the new packages only |
| `npm run legacy:dev` | The existing Next.js app, unchanged |

The legacy Next scripts were renamed `dev`→`legacy:dev`, `build`→`legacy:build`,
`start`→`legacy:start`, `lint`→`legacy:lint`. Root `dev` now means the MERN
stack. **This is the one breaking change to existing workflow** — anyone with
`npm run dev` in muscle memory gets the new stack, not Next.

## The dev proxy

The browser never knows the API's address. Client code calls same-origin
relative paths (`/api/...`) through `client/src/lib/api-client.ts`; Vite's
`server.proxy` forwards `/api` to `http://localhost:4000` in development, and in
production the hosting origin serves both. No production URL is compiled in.

The proxy target is overridable with `API_PROXY_TARGET`, read by
`vite.config.ts` **in Node at dev time**. It is deliberately not `VITE_`-prefixed,
so it never enters the browser bundle.

## Secret boundary

Vite inlines every `VITE_*` variable into the bundle. Accordingly:

- `MONGODB_URI`, `MONGODB_DATABASE`, `SESSION_SECRET` live in `server/.env` and
  are read only by `server/src/config/env.ts`, which is outside the Vite root.
- `client/.env.example` carries no secrets and documents why.
- ESLint forbids client files importing `@dokuma/server` or `**/server/src/**`.
- There are currently **zero** `VITE_*` variables. The client needs none.

## What exists so far

- `GET /api/health` → `{ status, uptime, timestamp }`, unauthenticated and
  database-free, so it answers even when Mongo is down.
- Centralized error handling: `ZodError` → 400 with per-field detail,
  `HttpError` → its status, anything else → 500 with the message withheld in
  production.
- `helmet`, credentialed `cors` scoped to `CLIENT_ORIGIN`, `cookie-parser`
  wired with the session secret, `trust proxy` set for the IP-keyed rate
  limiting in inventory §4.6.
- `shared/src/roles.ts` — the 9 roles and the recurring tiers, ported from
  `types/database.types.ts` and migration 0019.
- `shared/src/department-scope.ts` — `departmentScopeForRole`, ported verbatim,
  including the deliberate no-fallback rule (inventory §4.5).
- `shared/src/api.ts` — response envelope, `CurrentUser`, `HealthResponse`.

## Decisions from the inventory reflected here

- **D-3** React Query is installed for per-resource invalidation in place of
  `revalidatePath`.
- **D-4** `api-client.ts` sends `credentials: "include"`, matching the move to
  an `httpOnly` session cookie. *That switch still needs the explicit sign-off
  D-4 calls for.*
- **D-14** `roleHomePath` keeps `viewer` falling through to `/projects`.

## Not in this phase

Mongoose models, auth, the 26 Server Action ports, the 30 page routes, Tailwind
and the shadcn component tree, `@fontsource` (D-9), Socket.IO (D-6), GridFS
(D-7). The client renders one scaffold page that pings `/api/health`.
