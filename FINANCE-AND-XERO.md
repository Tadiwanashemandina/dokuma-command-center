# Finance module & Xero integration

How Dokuma's ledger works, what the Xero integration does, and the handful of
behaviours that look like bugs but are load-bearing.

Read this before changing anything under `server/src/services/finance/`,
`server/src/services/xero/`, or `client/src/routes/finance*`.

---

## 1. The one rule

**Money is an exact decimal string, everywhere, from the database to the
browser.**

| Layer | Representation |
| --- | --- |
| MongoDB | `Decimal128` (migration parity: `numeric(14,2)`) |
| Service arithmetic | scaled `bigint` — never `+` on floats |
| HTTP | JSON **string**, `"1250.50"` |
| React | string, formatted by `formatMoney()` at the point of display |

There is no point in this pipeline where an amount becomes a JS `number`. That
is not fastidiousness: `0.1 + 0.2 !== 0.3` in float64, account balances are
sums over thousands of rows, and the resulting figure is one somebody
reconciles against a bank statement and signs.

The legacy `lib/validation/finance-schema.ts` used `z.coerce.number()` on every
amount, which round-tripped it through float64 before it ever reached
Decimal128 storage. That is the single deliberate departure from the ported
behaviour, and it is why `shared/src/finance.ts` uses `positiveMoneyString`.

**If you ever want to total a column in the browser, the total belongs on the
server.** It already computes every total the UI needs.

---

## 2. Behaviours that must not be "fixed"

Each of these has been mistaken for a bug before. They are all intentional.

### Reversal, never deletion

A correction is a new, real, opposite-type row linked by
`reversesTransactionId`; the original gets `isReversed = true`. Nothing is ever
deleted or edited.

This is what keeps balance arithmetic free of special cases — a reversal nets
out on its own — and the audit trail complete. Double-reversal is refused
(409), and **reversing a reversal is also refused**: it is arithmetically the
same as re-posting the original but produces a chain nobody can read.

### Cash position is grouped by currency; report totals are not

`getCashPosition()` groups by currency and never sums across. A single figure
spanning USD and ZWL would be meaningless.

`getTotalBalanceAsOf()` **deliberately does** mix currencies, because
company-wide report totals expect one number. Both behaviours are intentional
and both are kept. Do not "unify" them.

### "Current Balance" ≠ "Closing Balance"

In weekly and monthly reports these are two different figures:

- **Closing** — the balance *at `period_end`*. Fixed once the period is over.
- **Current** — the *live* balance at generation time.

For a report generated the morning after its period ends they usually match.
For one generated weeks later, **the gap between them is the signal** — it
tells the reader how much has moved since the period closed. Collapsing them
into one field is the most plausible "cleanup" someone will attempt here, and
it destroys information.

### Monthly trend windows step back in 30-day increments, not calendar months

Ported as-is from `lib/finance/reports.ts`. Changing it to true calendar months
would silently move every historical trend point on every previously generated
report, so the comparison a reader makes against last month's PDF would stop
holding. If it should change, that is a data decision to take explicitly.

### `null` is not zero

- `margin_pct: null` means "no budget set", not "0% margin". A red zero against
  an unbudgeted project is a false alarm.
- `/company-totals` returns `null` when no snapshot exists — render "no data",
  not three confident zeros.
- A Xero statement line that is absent returns `null`, not `0.00`. "This
  organisation does not report that line" and "that line is zero" are different
  facts.

### Daily reports publish immediately

No draft step. They are a mechanical end-of-day snapshot with no commentary, so
there is nothing for a reviewer to approve. Weekly and monthly default to
`draft` and require `FINANCE_APPROVE` to publish.

### Payment notices show the current calendar month

Computed in UTC. `?month=all` lifts the filter.

### Import is all-or-nothing

Any invalid row rejects the entire import; nothing is written. A partial import
of a bank statement is worse than none — the operator cannot tell which rows
landed, and re-running duplicates whatever succeeded.

This is now enforced twice: validation refuses the batch if any row is invalid,
**and** the inserts run in one database transaction, so a failure *during*
insertion also rolls back. The legacy version could only offer the first half.

---

## 3. Role tiers

Ported verbatim from the legacy `requireRole()` calls. Defined once in
`shared/src/roles.ts` and used by both the Express middleware and the React
route guards, so a UI gate cannot drift from the endpoint it fronts.

| Tier | Roles | May |
| --- | --- | --- |
| `FINANCE_READ` | admin, exec, finance_officer, finance_manager | view everything |
| `FINANCE_WRITE` | admin, finance_officer, finance_manager | create transactions, creditors, notices, report drafts; import |
| `FINANCE_APPROVE` | admin, finance_manager | change statuses, publish reports, manage Xero |

`exec` reads everything and writes nothing. A `finance_officer` may draft a
report but not publish it.

> The legacy UI showed a Publish button to anyone who could see the page, so a
> finance_officer clicking it got a server-side rejection. The guard was right
> and the button was wrong; the React pages gate the control on the same tier
> the server checks.

---

## 4. Atomicity (D-11)

The transaction insert and the `current_balance` recompute are **one database
transaction**. In Postgres this pair was an `AFTER INSERT` trigger and was
genuinely atomic; a crash between the two halves leaves `current_balance`
permanently wrong and nothing ever notices, because
`getAccountBalanceAsOf()` would silently disagree with it forever.

This requires a replica set. `withTransaction()` **throws** rather than
degrading to two independent writes when the deployment cannot offer one.

Two callers pass `skipBalanceRecompute: true` — the bulk importer and the Xero
sync. That is sound *only* because each wraps its whole batch in one
transaction, so no reader can observe the intermediate states. In that mode the
result's `currentBalance` is `null`, deliberately not `""` or `0`, so a caller
that forgets to handle it gets a type error rather than a plausible wrong
number flowing into a balance display.

---

## 5. Xero

### Direction mapping — the thing most likely to be silently wrong

| Xero type | Meaning | This ledger |
| --- | --- | --- |
| `RECEIVE*` | money **into** the bank account | `credit` (balance up) |
| `SPEND*` | money **out of** the bank account | `debit` (balance down) |

This is the **account holder's** perspective, which is the opposite of
double-entry convention where a bank receipt *debits* the asset account. This
system's `type` means "did the balance go up or down" — `getAccountBalanceAsOf`
adds credits and subtracts debits. Using accounting convention here inverts
every synced balance, **and the resulting figure still looks plausible.**

`*-TRANSFER` types are skipped: a transfer between two linked accounts appears
once from each side and would be counted twice.

### Three defences against duplicating a real ledger

The failure mode is a duplicate entry found weeks later by an accountant, so
there are three independent guards:

1. **`XeroPushQueue` is UNIQUE on `transactionId`** — a double-click, a
   duplicated cron tick or two concurrent requests cannot create two queue rows.
2. **`Idempotency-Key`**, derived from the transaction id **alone**, never its
   contents. Including the amount would change the key on an edit, so a retry
   after an edit would create a second Xero entry — exactly what the key exists
   to prevent. Xero collapses repeats for 24 hours.
3. **Re-read and refuse** if `xeroTransactionId` is already set.

Plus the rule that makes the whole thing terminate: **a row with
`source: "xero-sync"` is never pushed back up.** That is the loop that would
otherwise duplicate every synced entry.

### Sync cursors

Each `(tenant, resource)` pair has its own `If-Modified-Since` cursor.

- Advanced **only** after a resource's pull fully succeeds. Advancing
  optimistically permanently skips every record in a page that failed halfway —
  the next run asks for changes *after* the cursor, so those rows are never
  seen again.
- Never advanced on a **truncated** run (one that hit the per-run page limit),
  so the next run resumes rather than skipping.
- **Rewound by 5 minutes on every run.** Xero stamps `UpdatedDateUTC`
  server-side, and a record committed during the previous run can carry a
  timestamp fractionally before the stored cursor. The overlap costs a few
  redundant upserts — which are idempotent — and closes that window.

### Dates: the bug that only appears off-UTC

`new Date("2026-03-15T00:00:00")` — no zone designator — parses as **local
time** per ECMA-262. Only date-*only* forms default to UTC. Xero returns this
shape routinely.

On a UTC+2 host that became 22:00 on the 14th, and `.slice(0, 10)` then
reported the wrong calendar day: **every invoice due date and transaction date
shifted by one, in a direction depending on where the server is deployed.**
It is invisible on a UTC-configured CI box.

`parseXeroDate()` appends `Z` explicitly for that shape. The `/Date(…+0000)/`
.NET form's trailing offset is the organisation's timezone and must **not** be
added to the epoch.

### Statements are snapshotted, not fetched live

Re-running a P&L months later can legitimately return different numbers if the
period was reopened and adjusted. A board pack must be reproducible, so each
fetch is stored in `XeroStatement` with its period and fetch time, and reports
read the snapshot.

These are **Dokuma's own view**. They are deliberately *not* wired into the
Group SBU feed, where `REVENUE` and `EBITDA` are `derived` and the capture
endpoint rejects a typed figure — the Group platform computes them from source
documents, and feeding ours upward would create the second divergent source of
truth that rule exists to prevent. See `GROUP-REPORTING.md`.

### Fail-closed configuration

| `XERO_MODE` | Effect |
| --- | --- |
| *(unset / malformed credentials)* | `disabled` — no OAuth, no sync, no push, with a stated reason |
| `read-only` | pulls only; requests **no write scope at all**, so the push cannot fire even by mistake |
| `live` | pulls and pushes |

A missing or malformed variable can only ever make this system quieter — never
make it write into a real accounting ledger. Run `read-only` in production
first and watch the sync reconcile before enabling writes.

### OAuth notes

- The `state` parameter is HMAC-signed with the session secret and bound to the
  initiating user. Without that check, an attacker can feed a crafted callback
  URL to a logged-in administrator and connect **their** Xero organisation to
  this system, after which the finance module syncs someone else's ledger.
- **Xero rotates the refresh token on every refresh and invalidates the
  previous one.** If a refresh succeeds at Xero and the new token is lost before
  being persisted, the connection is permanently dead and only a human
  re-authorising can fix it. `refreshAccessToken()` therefore writes the new
  token **before** returning the access token to its caller.
- Disconnecting deletes the stored grant but does **not** revoke access at
  Xero's end. The endpoint says so in its response; claiming a revocation we did
  not perform would leave an administrator believing they had closed something
  still open.

---

## 6. `xlsx` security

The package carries two unpatched advisories (prototype pollution, ReDoS). All
three documented mitigations are preserved and now explicit:

- **Server-only parse** — `services/finance/import.ts` is never imported by
  `client/`.
- **5MB cap**, enforced at multer (rejects the stream before the body is fully
  buffered) *and* again in `parseWorkbook`.
- **Values only** — `cellFormula: false`, `raw: false`. No formula evaluation,
  no macros.
- Additionally: a null-prototype row sanitiser drops `__proto__`,
  `constructor` and `prototype` header keys, which is the concrete shape of the
  pollution advisory.

There is also a 5,000-row cap per import. A 5MB CSV is comfortably 50,000 rows,
and each becomes an insert inside a single transaction; Mongo's 16MB oplog
entry limit makes that fail late and confusingly.

**Ambiguous dates are rejected, not guessed.** The legacy importer fell back to
`new Date(text)`, resolving `03/04/2025` by the host's locale — March 4th in the
US, April 3rd elsewhere. That books a transaction into the wrong month and
nothing downstream can detect it.

---

## 7. Verification

```bash
npm run verify:finance --workspace @dokuma/server
```

106 checks against a real mongod replica set (`mongodb-memory-server`, pinned to
7.0.24, single-node RS so transactions actually execute). It proves the things
a type-checker cannot see:

- exact arithmetic — 1000 × 0.01 is exactly `10.00`; 99999999.99 + 0.01 is
  exactly `100000000.00`
- a reversal nets the balance back, marks the original, and refuses to repeat
- the stored `current_balance` equals a fresh replay of the history
- an invalid row writes **nothing**
- `RECEIVE` is a credit and `SPEND` is a debit
- a naive Xero datetime is read as UTC
- the unique partial indexes refuse a duplicate Xero id
- the integration is `disabled` with a reason when unconfigured, and
  `read-only` cannot push

Section 14 pins the defects found in review, each of which **failed silently**
— none raised an error, they just produced a wrong number or quietly did
nothing, and typecheck, lint and build all passed over every one:

| Defect | Symptom |
| --- | --- |
| `z.coerce.boolean()` on a multipart field | `Boolean("false")` is `true`, so **every real import took the dry-run branch and wrote nothing** while reporting success. Same defect on `publish` (a finance_officer's draft became a 403) and `?refresh=`. Use `booleanFlag` from `shared/src/finance.ts`. |
| Company totals seeded to zero | The 03:30 sync created the day's row with pipeline and contracted revenue at `0`, **blanking two headline CEO KPIs every morning** — the exact failure the function's own comment claimed to prevent. Now carried forward from the prior snapshot. |
| 304 treated as truncated | "Nothing changed" is the *normal* outcome for most runs. Returning `truncated: true` meant the cursor never advanced again, so the sync re-pulled an ever-widening window forever while reporting `status: "ok"`. |
| `findOne`-then-`create` in the sync | A check-then-act race. Two overlapping runs both insert, the unique index rejects the loser, and the whole resource's cursor advance is discarded. Now one atomic upsert — three concurrent writes converge to one row. |
| `=== null` on a lean document | A row written before the field existed reads back `undefined`, so a voided Xero transaction was never reversed and **overstated cash permanently**. |
| Raw token-endpoint body in `lastError` | `GET /api/xero/status` returns it to any FINANCE_READ user. Only the recognised OAuth error code crosses that boundary now; the body goes to stderr. |
| No compare-and-swap on refresh | A lost race stored a revoked refresh token while the settings page showed green. The update is now conditioned on the old token still being current. |

Also caught during development: the naive-datetime timezone issue in §5, which
is invisible on a UTC-configured CI box.

Also run `npm run db:verify --workspace @dokuma/server` (63 checks) to confirm
no data-model regression.

---

## 8. Endpoint map

| Method | Path | Tier |
| --- | --- | --- |
| GET | `/api/finance/accounts` | read |
| POST | `/api/finance/accounts` | write |
| GET | `/api/finance/cash-position` | read |
| GET | `/api/finance/company-totals` | read |
| GET | `/api/finance/project-finance` | read |
| GET | `/api/finance/transactions` | read |
| POST | `/api/finance/transactions` | write |
| POST | `/api/finance/transactions/:id/reverse` | write |
| GET | `/api/finance/creditors` | read |
| POST | `/api/finance/creditors` | write |
| PATCH | `/api/finance/creditors/:id/status` | **approve** |
| GET | `/api/finance/payment-notices` | read |
| POST | `/api/finance/payment-notices` | write |
| PATCH | `/api/finance/payment-notices/:id/status` | **approve** |
| GET | `/api/finance/reports` | read |
| GET | `/api/finance/reports/:id` | read |
| POST | `/api/finance/reports/daily` | write |
| GET | `/api/finance/reports/weekly/preview` | read |
| GET | `/api/finance/reports/monthly/preview` | read |
| POST | `/api/finance/reports/weekly` | write (publish needs approve) |
| POST | `/api/finance/reports/monthly` | write (publish needs approve) |
| POST | `/api/finance/reports/:id/publish` | **approve** |
| POST | `/api/finance/import/preview` | write |
| POST | `/api/finance/import/commit` | write |
| GET | `/api/xero/status` | read |
| POST | `/api/xero/connect` | **approve** |
| POST | `/api/xero/callback` | **approve** |
| DELETE | `/api/xero/connections/:tenantId` | **approve** |
| POST | `/api/xero/connections/:tenantId/sync` | **approve** |
| POST | `/api/xero/connections/:tenantId/push` | **approve** |
| POST | `/api/xero/connections/:tenantId/push/:id` | **approve** |
| GET | `/api/xero/connections/:tenantId/profit-and-loss` | read |
| GET | `/api/xero/connections/:tenantId/balance-sheet` | read |
| GET | `/api/cron/xero-sync` | `CRON_SECRET` |
