# Dokuma Command Centre: MERN Migration Prompts

This prompt pack is for migrating the current Dokuma Command Centre from Next.js + Supabase to a full MERN application:

- React + Vite + TypeScript frontend
- React Router for client-side routing
- Node.js + Express + TypeScript backend
- MongoDB + Mongoose
- Secure cookie-based authentication
- REST APIs for all server operations

The migration must preserve the current product behavior and visual language. Do not reduce the application to a demo dashboard.

## How to use this document

Run the prompts in order with an implementation-capable coding agent. Each prompt assumes the previous prompt was completed and validated. The agent must inspect the repository before editing, keep changes focused, and run the stated checks before moving on.

Do not expose secrets in prompts, source code, logs, commits, or generated documentation. Use environment variable names and placeholders only.

## Prompt 1: Establish the migration contract

```text
You are migrating the Dokuma Command Centre from Next.js 14 + Supabase to a full MERN stack.

Read README.md, ONBOARDING.md, SECURITY.md, package.json, the app directory, components, lib, types, and supabase migrations before making changes. Build a complete inventory of:

1. Existing routes and page capabilities.
2. Existing API routes and Server Actions.
3. Authentication, roles, MFA, session, authorization, and rate-limiting behavior.
4. Finance, HR, projects, risks, clients, delivery, meetings, notifications, PDF, CSV, Jira, and LazyBoss behavior.
5. Database tables, relationships, views, constraints, indexes, and seed data represented in supabase/migrations and supabase/seed.sql.
6. Every Next.js, Supabase, Postgres, and server-only import that must be replaced.

Create MERN-MIGRATION-INVENTORY.md. For every feature, record its current source files, target frontend route, target Express endpoint, target Mongo model or service, authorization requirements, and validation strategy.

Do not migrate code yet. Call out ambiguities and propose a decision for each. The migration target is MongoDB, not Supabase. Preserve behavior unless a change is explicitly approved.

Validation: verify every existing app route and every API/Server Action has an inventory entry.
```

## Prompt 2: Create the target project structure

```text
Using MERN-MIGRATION-INVENTORY.md, establish a clean monorepo structure without deleting working legacy code yet:

- client/: Vite React TypeScript application
- server/: Express TypeScript application
- shared/: shared API contracts, role definitions, validation schemas, and types where appropriate

Configure TypeScript, Vite, Express, ESLint, and package scripts. Add a root development command that can run client and server together. Configure a development proxy so the browser can call the Express API without hardcoding production URLs.

Move only dependency/configuration concerns in this phase. Do not copy Next-specific server code into the client. Do not add Supabase compatibility code. Do not expose MongoDB credentials or server secrets to Vite.

Keep the existing app runnable until the replacement path has equivalent coverage.

Validation:
- npm install succeeds.
- client starts with Vite.
- server starts with Express.
- TypeScript checks pass for both packages.
- A health endpoint returns a small JSON response.
```

## Prompt 3: Design the MongoDB data model

```text
Translate the existing Supabase/Postgres schema into explicit Mongoose models and migration/seed scripts.

Read every SQL migration and seed file before designing models. Preserve:

- Required fields and defaults.
- Unique constraints.
- Foreign-key relationships as ObjectId references or stable business identifiers.
- Role and status restrictions.
- Department scoping.
- Audit history.
- Date and monetary precision requirements.
- Query patterns needed by dashboards and reports.
- The behavior of views such as KPI feeds, leave requests, and expiring training.

Create server models, indexes, repository/service functions, and an idempotent seed process. Do not put raw database access in Express route handlers. Use Zod or the established validation library at the API boundary.

Document any Postgres behavior that has no direct Mongo equivalent and implement the application-level equivalent explicitly. Never weaken authorization because MongoDB does not provide Postgres RLS.

Validation:
- Start MongoDB using the documented local connection string.
- Run migrations/index creation and seed against a disposable database.
- Run duplicate and invalid-input checks.
- Verify representative dashboard, finance, HR, and department-scoped queries.
```

## Prompt 4: Implement authentication and authorization

```text
Replace Supabase Auth and Next middleware with Express authentication using a strong password hashing library, short-lived access sessions, and secure HttpOnly cookies. Use a server-side session strategy or rotating refresh tokens; do not store long-lived JWTs in localStorage.

Implement:

- Login and logout.
- Current-user endpoint.
- Session renewal or revocation.
- Password failure rate limiting by IP and account identifier.
- Role and department authorization middleware.
- Admin, exec, viewer, finance, HR, supervisor, and employee access rules from the inventory.
- MFA/TOTP enrollment, challenge, verification, recovery, and role gating where the current product requires it.
- CSRF protection appropriate to the chosen cookie strategy.
- Consistent 401, 403, 429, and validation responses.

Keep secrets server-only. Use generic login failure messages. Add audit records for authentication events and sensitive changes. Do not recreate Supabase RLS as a client-side check; all authorization must be enforced in Express services before database operations.

Validation:
- Test login, logout, expired sessions, invalid credentials, rate limiting, role restrictions, department boundaries, MFA enrollment, and MFA challenge.
- Confirm authenticated APIs reject missing or forged credentials.
- Confirm no credential, token, or secret appears in the client bundle.
```

## Prompt 5: Build the Express API

```text
Convert every Next API route and Server Action into versioned Express REST endpoints grouped by domain:

- /api/v1/auth
- /api/v1/dashboard
- /api/v1/projects
- /api/v1/finance
- /api/v1/hr
- /api/v1/risks
- /api/v1/clients
- /api/v1/delivery
- /api/v1/meetings
- /api/v1/notifications
- /api/v1/admin

Use a consistent response and error format. Validate request bodies, query parameters, route parameters, uploaded files, and imported rows at the server boundary. Keep controllers thin and put business rules in services. Add pagination, filtering, sorting, and bounded limits for collection endpoints.

Preserve all existing behavior, including audit logging, approval state machines, reversal-not-deletion rules, CSV/Excel validation, PDF generation, notification behavior, Jira integration, LazyBoss adapter behavior, and KPI feed shape.

Use centralized error handling and request logging that redacts credentials, cookies, tokens, and sensitive personal data.

Validation:
- Add API tests for every endpoint.
- Test happy paths, malformed input, unauthorized access, forbidden roles, missing resources, duplicate operations, and boundary values.
- Confirm all writes create the expected audit records.
```

## Prompt 6: Migrate the React frontend to Vite

```text
Move the existing UI into the Vite React client while preserving the current layout, brand styling, accessibility, and workflows.

Replace Next-specific behavior as follows:

- next/link -> React Router Link.
- next/navigation -> React Router hooks and explicit navigation.
- next/image -> standard image handling with safe dimensions and fallback behavior.
- Next layouts -> React Router layout routes and protected route boundaries.
- Server component data loading -> API calls through typed client functions.
- Server Actions -> API mutations with loading, success, error, and retry states.
- next/font -> a Vite-compatible font strategy.
- Next metadata -> Vite document metadata handling.

Do not put server credentials, MongoDB access, privileged logic, or service-role equivalents in client code. Create a typed API client and a current-user/auth provider. Ensure refresh, logout, unauthorized responses, and route redirects behave correctly.

Migrate routes one domain at a time. Preserve responsive behavior and existing component styling rather than redesigning unrelated screens.

Validation:
- Check every route at desktop and mobile widths.
- Test direct navigation, refresh, protected routes, browser back/forward, logout, form errors, loading states, and empty states.
- Confirm the production client build contains no server secrets or database connection strings.
```

## Prompt 7: Migrate integrations and files

```text
Move integrations out of Next.js and into explicit Express services:

- PDF generation and downloads.
- CSV/Excel imports with file-size, type, row-count, and schema limits.
- Jira reads and synchronization.
- LazyBoss CSV adapter and any future API adapter boundary.
- Email notifications.
- Rate limiting.
- Document uploads and downloads.
- KPI feed polling.

All external credentials must remain on the server. Validate outbound URLs and restrict them to known hosts. Apply timeouts, retries only where safe, and non-sensitive structured logs. Keep notification failures non-fatal where the current product defines them as non-fatal.

For uploads, stream or size-limit data where practical, reject unexpected MIME types, avoid trusting client filenames, and store files outside the public client bundle. Preserve authorization checks for every document read and write.

Validation:
- Exercise each integration with test doubles where live credentials are unavailable.
- Test oversized, malformed, unauthorized, and duplicate imports.
- Verify generated PDFs and protected file downloads.
- Verify external-service failures do not leak secrets or corrupt business state.
```

## Prompt 8: Remove Next.js and Supabase

```text
Only after the MERN client and server have equivalent behavior, remove the legacy runtime dependencies and code.

Remove:

- next, eslint-config-next, next-env.d.ts, next.config.mjs, middleware.ts.
- app/ route/layout implementation once its replacement is verified.
- next/link, next/navigation, next/image, next/font, next/server, next/headers, next/cache, and Server Actions.
- @supabase/ssr, @supabase/supabase-js, Supabase clients, Supabase middleware, and Supabase-only environment variables.
- Supabase migrations and scripts only after their MongoDB equivalents are tested and documented.

Do not remove domain behavior merely because it was implemented in a Supabase-specific file. Move the behavior first, then delete the adapter.

Update package scripts, .env.local.example, README.md, ONBOARDING.md, SECURITY.md, and deployment documentation to describe the MERN stack accurately. Remove stale claims about Vercel, Supabase, RLS, and Next.js. Do not include real credentials or old secrets in documentation.

Validation:
- Search the full repository for Next.js and Supabase imports, package names, environment variables, and documentation claims.
- npm install, typecheck, lint, test, and production builds pass.
- The application runs with only MongoDB and the documented server integrations.
```

## Prompt 9: Security and migration verification

```text
Perform a security review of the completed MERN application as if it were going to production.

Check:

- Password hashing and session invalidation.
- Cookie flags: HttpOnly, Secure in production, SameSite, and scoped domain/path.
- CSRF protection.
- CORS allowlist and production origin configuration.
- Rate limits on login, password reset, imports, file operations, and expensive reports.
- Object-level authorization for every read, update, delete, download, and export.
- Department and role boundaries.
- MFA enforcement.
- NoSQL injection protection and strict query construction.
- XSS, unsafe HTML, open redirects, SSRF, path traversal, and malicious file handling.
- Secret exposure in client bundles, source maps, logs, errors, and documentation.
- Audit logging for sensitive operations.
- Backup, restore, indexes, and production MongoDB access controls.

Create or update SECURITY.md with verified claims only. Record residual risks and the command or test that supports each security claim.

Validation:
- Run dependency audit.
- Run automated API authorization tests across every role.
- Run client production build inspection for secret leakage.
- Run the complete test suite and a manual critical-path smoke test.
```

## Prompt 10: Final acceptance review

```text
Review the completed migration against MERN-MIGRATION-INVENTORY.md and the original README feature list.

Produce MIGRATION-ACCEPTANCE.md containing:

1. A route-by-route status table.
2. An endpoint-by-endpoint status table.
3. A feature parity table for auth, MFA, roles, finance, HR, audit, imports, PDFs, notifications, Jira, LazyBoss, KPI feed, and document storage.
4. Tests run and their results.
5. Known limitations and explicit follow-up work.
6. Deployment steps for the client, Express server, MongoDB, file storage, email, and external integrations.
7. Environment variable names with descriptions, excluding values.

Do not mark a feature complete based only on compilation. A feature is complete when its UI path, API behavior, authorization, persistence, validation, error states, and tests are verified.

If any feature is incomplete, leave it marked incomplete and explain the smallest remaining implementation needed.
```

## Required final environment variables

Use names appropriate to the deployment platform, but keep secrets server-only. A baseline set is:

```text
MONGODB_URI=
SESSION_SECRET=
CLIENT_ORIGIN=
NODE_ENV=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=

JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=

LAZYBOSS_SOURCE=csv
UPLOAD_STORAGE_PATH=
RATE_LIMIT_REDIS_URL=
RATE_LIMIT_REDIS_TOKEN=
```

Do not place `MONGODB_URI`, `SESSION_SECRET`, SMTP credentials, Jira tokens, storage credentials, or rate-limit tokens in Vite-prefixed variables. Only deliberately public configuration may be exposed to the browser.

## Definition of done

The migration is complete only when:

- The product runs as React + Vite, Express, Node, and MongoDB.
- No runtime dependency on Next.js or Supabase remains.
- All documented modules and critical workflows have parity or an explicitly approved change.
- Authentication, MFA, roles, department scoping, audit logging, and rate limiting are enforced server-side.
- API and UI tests cover the critical paths and authorization boundaries.
- Production builds succeed for both client and server.
- Documentation, environment examples, deployment steps, and security claims match the new architecture.
- No secrets are committed, logged, or shipped to the browser.
