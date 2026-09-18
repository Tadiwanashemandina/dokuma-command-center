# Group Reporting — Dokuma → One Platform

How Dokuma reports upward to the Group holding company, against the
**KPI & Ingestion Specification** (`SBU code: DOKUMA`, 45 bespoke + 14 spine measures).

This document covers what is built here and what is still needed from the Group side.
It is written for whoever operates or extends this feed, not for the board.

---

## 1. What exists

| Piece | Where |
|---|---|
| The measure register (59 measures) | `shared/src/sbu-kpis.ts` |
| Storage + history + dispatch log | `server/src/db/models/sbu-kpi.ts` |
| HMAC request signing | `server/src/services/oneplatform/signing.ts` |
| Feed configuration | `server/src/services/oneplatform/config.ts` |
| Batch build + dispatch | `server/src/services/oneplatform/daily-feed.ts` |
| Capture service | `server/src/services/sbu-kpi.ts` |
| HTTP routes | `server/src/routes/group-kpis.ts` |
| Nightly job | `server/src/routes/cron.ts` → `/api/cron/group-feed` |
| Dashboard | `client/src/routes/group-reporting.tsx` → `/group` |

**The register is the single source of truth.** It drives the capture screen, the
dashboard grouping, server-side validation and the daily feed's payload. If the Group
register changes, change `shared/src/sbu-kpis.ts` and let the four consumers follow —
do not hand-maintain a second list.

---

## 2. Three surfaces, deliberately separate

Do not merge these. They answer different questions for different readers.

| Surface | Reader | Question |
|---|---|---|
| `/` CEO Home | Dokuma exec | How is the business running this week? |
| `/group` Group Reporting | Office of the Chairman | What has the board been told, and is any of it overdue or breaching? |
| `GET /api/kpi-feed` | Group platform (machine) | The frozen twelve-metric contract (D-13) |

`/api/kpi-feed` carries **twelve** metric names and must not grow — it is polled by a
consumer whose auth model is still unagreed. The 59 SBU measures live in their own
collection (`sbu_kpi_readings`) precisely so that adding them cannot silently turn a
query that returned 12 rows into one that returns 71.

---

## 3. How a figure reaches the Group

Three paths. Which one a measure takes is decided by **its registered frequency**, not
by the sender.

| Route | Measures | Mechanism |
|---|---|---|
| `operational-readings` | the 4 DAILY | signed HMAC feed, nightly |
| `manual` | the other 41 | typed in at `/group`, month-end |
| `derived` | the 14 spine | computed by the Group from finance documents |

**The spine is never posted as a number.** Revenue, EBITDA, DSO and LTIFR are derived
upstream so that a figure on the chairman's screen and the transaction behind it are the
same number aggregated. The capture endpoint rejects a spine measure outright.

### The four daily measures

| Code | Unit | Target |
|---|---|---|
| `DEEDS_DIGITISED` | COUNT | — |
| `DIGITISATION_RATE` | COUNT | — |
| `DATA_ACCURACY` | PERCENT | ≥ 99.95 |
| `SYSTEM_UPTIME` | PERCENT | 99.5–99.9 |

`DATA_ACCURACY` is the group's highest-stakes measure — an error here is an error in
someone's legal land title.

---

## 3b. Gap 1 — the QA system's feed into this platform

The four DAILY measures need a real source. Until Dokuma's QA/scanning system posts
them, the only values in the register come from the demo seed — which the dashboard
labels and the outbound feed **refuses to send**.

### What the QA team builds

One POST, once a day, after the QA figures settle.

```http
POST /api/qa-ingest/daily-readings
Authorization: Bearer <QA_INGEST_KEY>
Content-Type: application/json
```

```json
{
  "clientBatchRef": "qa-2026-09-18",
  "readings": [
    { "measureCode": "DEEDS_DIGITISED",   "readingDate": "2026-09-18", "value": "142380",  "sourceUpdatedAt": "2026-09-18T06:00:00+02:00" },
    { "measureCode": "DIGITISATION_RATE", "readingDate": "2026-09-18", "value": "1120",    "sourceUpdatedAt": "2026-09-18T06:00:00+02:00" },
    { "measureCode": "DATA_ACCURACY",     "readingDate": "2026-09-18", "value": "99.9700", "sourceUpdatedAt": "2026-09-18T06:00:00+02:00" },
    { "measureCode": "SYSTEM_UPTIME",     "readingDate": "2026-09-18", "value": "99.8200", "sourceUpdatedAt": "2026-09-18T06:00:00+02:00" }
  ]
}
```

Smoke-test the key first: `GET /api/qa-ingest/whoami` with the same bearer header.
A 200 returns the accepted measure codes and expected formats.

| Field | Rule |
|---|---|
| `measureCode` | one of the four DAILY codes; anything else → 400 |
| `readingDate` | `YYYY-MM-DD`, the business day being reported |
| `value` | decimal **string**, ≤ 4 places. A JSON number is rejected |
| `status` | `POSTED` (default) or `VOIDED` to withdraw a day |
| `sourceUpdatedAt` | ISO-8601 **with offset**. See the trap below |
| `restatementReason` | optional, ≤ 500 chars, for a correction |

Outcomes are per-document: `accepted`, `replaced`, `duplicate`, `voided`, `stale`.
One bad figure does not discard the others.

### ⚠ The `sourceUpdatedAt` trap

A resend carrying an **older** `sourceUpdatedAt` than the stored value is refused as
`stale`. This is deliberate — it stops a replayed or out-of-order batch overwriting a
newer correction — but it has a sharp edge:

> **Omitting `sourceUpdatedAt` defaults it to the time of receipt.** If the QA system
> omits it on the first send and supplies a real (earlier) timestamp afterwards, every
> subsequent figure is silently refused as stale.

**Always send `sourceUpdatedAt`, and make it track when the QA system last changed the
record** — not when it happened to send. This is the same rule the Group applies to us.

### Issuing the key

```bash
# 32+ characters. Store in the secret manager, never in git.
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set it as `QA_INGEST_KEY`. Unset, the endpoint returns **503** — it never accepts
anonymous writes to a board-level measure.

---

## 4. Going live — the actual steps

Confirmed from the integration portal (Paul Kofa's account, 2026-09-18):

| | |
|---|---|
| Address | `https://oneplatform.dokuma.africa/ingest/v1` |
| Business | `DOKUMA` |
| Existing source | **Dokuma Xero** (`doc-xero`), key `opk_FT5SX4BBVFD7P7CRONY2` — *last used: never* |

### ⚠ The existing key cannot send the KPI feed

`doc-xero` is permitted nine record types — `SALES_DOCUMENT`, `PURCHASE_DOCUMENT`,
`PAYMENT`, `BALANCE`, `CAPEX_BUDGET`, `HEADCOUNT`, `SAFETY_HOURS`, `SAFETY_INCIDENT`,
`PERIOD_DECLARATION` — but **not `OPERATIONAL_READING`**, which is what the four daily
measures are. Posting with that key returns `RECORD_TYPE_NOT_PERMITTED` (403).

**Recommended: register a second source** rather than widening `doc-xero`.

> Portal → Integration API → **Register a source system**
> - Code: `dokuma-command-centre`
> - Name: `Dokuma Command Centre`
> - Type: `OTHER`
> - May send: **`OPERATIONAL_READING`** only
> - Then **Issue key** — the secret is shown **once**

Why separate: `doc-xero` is the Xero ERP, this is the Command Centre — two systems on
two hosts. One key each means either can be revoked without stopping the other, and the
Command Centre never gains the ability to post sales invoices. The portal itself
advises this: *"Each system gets its own key, so one can be switched off without
stopping the others."*

### Step 1 — put the credentials in `.env.local`

The block is already there with the non-secret values filled in. Add the two missing
lines. **Never commit this file** (it is gitignored, and confirmed untracked).

```bash
OP_INGEST_KEY_ID=opk_XXXXXXXXXXXXXXXXXXXX     # from the new source
OP_INGEST_SECRET=<the secret, shown once>
```

Paste the secret carefully — a trailing space or newline produces
`AUTHENTICATION_FAILED`, which looks identical to a wrong key.

### Step 2 — verify the connection (read-only, sends nothing)

```bash
npm run check:oneplatform --workspace @dokuma/server
```

It signs a real `GET /ingest/v1/whoami`, confirms the key works, checks that
`OPERATIONAL_READING` is permitted, and translates any error code into the fix. It
never posts a document.

### Step 3 — inspect the exact payload

```bash
npm run feed:preview --workspace @dokuma/server
```

Prints the byte-exact JSON that would be signed and sent, plus the headers. Demo-seed
figures are listed as **withheld** — they are never sent.

### Step 4 — go live

`OP_INGEST_MODE` starts at `dry-run`. Once steps 2 and 3 look right, set it to `live`
here and in Vercel (**Project → Settings → Environment Variables**, all four `OP_INGEST_*`
plus `CRON_SECRET`). The 04:30 cron then sends each day.

---

## 4b. Reference — other environment variables

The feed **fails closed**: with no configuration it builds and logs the batch but sends
nothing. It is safe to deploy and schedule today; it starts sending on the deploy that
adds the key.

### Environment variables

| Variable | Notes |
|---|---|
| `OP_INGEST_BASE_URL` | e.g. `https://oneplatform.dokuma.africa`. **https is required** (localhost exempt for testing). |
| `OP_INGEST_KEY_ID` | `opk_` + exactly 20 chars of `A–Z2–7`. |
| `OP_INGEST_SECRET` | Shown once at issuance and never retrievable. Secret store only. |
| `OP_INGEST_MODE` | `live` (default when the rest is set), `dry-run`, or `disabled`. |
| `OP_INGEST_SBU_CODE` | Defaults to `DOKUMA`. |
| `CRON_SECRET` | Already required by the existing snapshot job. |

Any missing or malformed value degrades the feed to `disabled` **with a stated reason**,
which the dashboard displays. A misconfiguration can only ever make this system quieter —
never make it post unverified figures to a board-level feed.

### Order of operations

1. Ask the Group administrator to register a source and issue a key:
   ```bash
   npm run ingest:keys -- source:create \
     --sbu DOKUMA --code dokuma-command-centre --name "Dokuma Command Centre" \
     --type OTHER --record-types OPERATIONAL_READING \
     --contact <you>@dokuma.africa
   npm run ingest:keys -- key:issue --source dokuma-command-centre --label "daily feed"
   ```
   (That CLI runs on the **Group** platform, not in this repo.)
2. Set the variables against **staging first**.
3. Set `OP_INGEST_MODE=dry-run` and watch `/group` for a run or two — the payload is
   built and logged without being sent.
4. Flip to `live`.
5. Confirm on `/group` that the feed banner reads **Feed healthy**.

### Verify before you send

```bash
npm run verify:group-kpis --workspace @dokuma/server   # 67 offline checks
npm run test:api          --workspace @dokuma/server   # includes 44 group-KPI checks
```

`verify:group-kpis` checks the register against the specification's stated counts and
asserts the HMAC signer reproduces the canonical string. It needs no key and no network.

---

## 5. Operating it

- **Schedule** — `/api/cron/group-feed` at 04:30 daily (`vercel.json`). `readingDate` is
  the business day reported, not the day sent.
- **Monitoring** — the dashboard banner turns red on a day with no accepted batch. This
  is the condition to alert on: *a silent feed and a genuine zero look the same from the
  outside*.
- **A missing figure is omitted, never sent as zero.** The preview endpoint lists what is
  missing.
- **Corrections** — recapture the figure. A history row is written with the previous
  value, and `sourceUpdatedAt` advances so the resend wins upstream rather than being
  refused as stale.
- **Timeouts** — never blind-retry. The `clientBatchRef` is persisted on every attempt;
  query `GET /ingest/v1/batches?clientBatchRef=…` first, because the write may have landed.
- **Clock drift** is the most common cause of a working feed suddenly returning 401.
  Tolerance is ±300s; run NTP on the sending host.

### Endpoints

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /api/group-kpis/overview` | exec | Exception tiles, completeness, feed health |
| `GET /api/group-kpis/readings` | exec | The full register with figures |
| `POST /api/group-kpis/readings` | exec + finance + HR | Month-end capture |
| `GET /api/group-kpis/register` | exec | The static definitions |
| `GET /api/group-kpis/feed/preview` | exec | Build today's batch **without sending** |
| `POST /api/group-kpis/feed/dispatch` | admin | Send (or `?dryRun=true`) |

Capture is intentionally wider than exec: the specification describes these figures as
typed in by finance and operations staff at month end. Gating capture on exec would mean
the only people who may enter the figures are the people the figures are for.

---

## 6. Open questions for the Group

Two are flagged by the specification itself (§12); the third is ours.

1. **Dimensioned measures have nowhere to put the dimension.**
   `PLATFORM_TXNS_BY_TYPE`, `AVG_FEE_PER_TXN`, `INCIDENTS_BY_SEVERITY` and
   `ACTIVE_TRANSACTING_USERS` are defined "by type"/"by severity", but a reading stores one
   scalar per code per period. They are captured as totals here and the UI says so on the
   tile. **Either confirm totals are what the board sees, or the register needs one code
   per type.**

2. **`DATA_ACCURACY` must come from the QA system, not from month-end typing.**
   It is DAILY and board-level. Today it is captured by hand like the others, which means
   the exception tile can lag by up to a month — defeating the point of having it on the
   chairman's screen. **Wiring Dokuma's QA system into
   `PUT /api/group-kpis/readings` (or directly into the batch builder) is the one
   remaining integration.**

3. **Ownership of the 41 manual measures is unassigned.** The month-end screen shows
   what is outstanding, but no named owner or due date per measure. Worth agreeing before
   the first real month-end.

---

## 7. What is deliberately not built

- **No inbound ingest endpoint.** This platform sends; it does not receive. The
  constant-time signature comparison in `signing.ts` exists for a future callback but
  nothing verifies inbound requests today.
- **No `/period-declarations`.** The specification requires it for the spine's document
  feeds; Dokuma posts no documents, only operational readings, so there is nothing to
  declare. If Dokuma ever posts sales or purchase documents, this becomes required —
  without it a month with zero incidents and a month whose feed failed are
  indistinguishable.
- **No automatic retry.** Deliberate. §11 says never blind-retry a timed-out batch.
