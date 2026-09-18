import { Router } from "express";
import { z } from "zod";
import {
  EXEC_ONLY,
  ADMIN_ONLY,
  SBU_KPI_MEASURES,
  SBU_CODE,
  GROUP_CAPTURE,
  isDecimalString,
} from "@dokuma/shared";
import { requireRole, requireAuthContext } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import {
  captureReadings,
  getCompleteness,
  getExceptionMeasures,
  getRegisterForPeriod,
} from "../services/sbu-kpi.js";
import { deriveSuggestions } from "../services/sbu-kpi-derive.js";
import { describeConfig, resolveConfig } from "../services/oneplatform/config.js";
import { buildDailyBatch, dispatchDailyFeed, getFeedHealth } from "../services/oneplatform/daily-feed.js";
import { currentDate, formatDateOnly } from "../db/types.js";
import { handle, ok } from "./helpers.js";

/**
 * The Group reporting surface — what Dokuma owes the Office of the Chairman.
 *
 * Distinct from `/api/dashboard`, which is Dokuma's own operational view, and
 * from `/api/kpi-feed`, which is the frozen twelve-metric contract of D-13.
 * This is the third thing: the 45 bespoke + 14 spine measures of the Group's
 * KPI & Ingestion Specification.
 *
 * Read access is exec-tier, matching every other board-level surface. Capture
 * is deliberately WIDER than exec — see the note on the POST below.
 */

export const groupKpisRouter = Router();

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/**
 * `?month=YYYY-MM&date=YYYY-MM-DD`, both defaulting to today.
 *
 * Two parameters rather than one because the register mixes granularities: the
 * four DAILY measures are reported for a business date while the other 41 are
 * reported for a month, and a single parameter would force one of them to be
 * derived — which is exactly where an off-by-one month-boundary bug lives.
 */
const periodQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM")
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional(),
});

function resolvePeriod(query: unknown): { month: string; date: string } {
  const parsed = periodQuerySchema.parse(query);
  const today = formatDateOnly(currentDate()) ?? new Date().toISOString().slice(0, 10);

  return {
    date: parsed.date ?? today,
    month: parsed.month ?? today.slice(0, 7),
  };
}

// ---------------------------------------------------------------------------
// GET /api/group-kpis/register — the static register
// ---------------------------------------------------------------------------

/**
 * The measure definitions, with no figures.
 *
 * Served rather than duplicated in the client bundle so that the register has
 * exactly one definition. The client imports the same `@dokuma/shared` module,
 * so this endpoint is mainly for external tooling and for confirming that a
 * deployed server and a deployed client agree on the register.
 */
groupKpisRouter.get(
  "/register",
  ...requireRole(EXEC_ONLY),
  handle(async (_req, res) => {
    ok(res, {
      sbuCode: SBU_CODE,
      measures: SBU_KPI_MEASURES,
      counts: {
        total: SBU_KPI_MEASURES.length,
        bespoke: SBU_KPI_MEASURES.filter((m) => m.route !== "derived").length,
        spine: SBU_KPI_MEASURES.filter((m) => m.route === "derived").length,
        exceptions: SBU_KPI_MEASURES.filter((m) => m.exception).length,
        daily: SBU_KPI_MEASURES.filter((m) => m.route === "operational-readings").length,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/group-kpis/overview — the chairman's screen
// ---------------------------------------------------------------------------

/**
 * Everything the Group CEO view needs, in one request.
 *
 * One request rather than four because these pieces are read together and are
 * individually small; four round trips would render the exception tiles, the
 * completeness bar and the feed banner at four different moments, which reads
 * as a page assembling itself rather than a report.
 *
 * Feed health is included deliberately. §11 of the specification warns that a
 * silent feed and a genuine zero look identical from outside, so a screen that
 * showed the figures without showing whether they had actually reached the
 * board would be showing half the truth.
 */
groupKpisRouter.get(
  "/overview",
  ...requireRole(EXEC_ONLY),
  handle(async (req, res) => {
    const { month, date } = resolvePeriod(req.query);
    const config = resolveConfig();

    const [exceptions, completeness, health] = await Promise.all([
      getExceptionMeasures({ sbuCode: config.sbuCode, month, date }),
      getCompleteness({ sbuCode: config.sbuCode, month, date }),
      getFeedHealth(config.sbuCode),
    ]);

    ok(res, {
      sbuCode: config.sbuCode,
      period: { month, date },
      exceptions,
      completeness,
      feed: { ...describeConfig(config), health },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/group-kpis/readings — the full register with figures
// ---------------------------------------------------------------------------

groupKpisRouter.get(
  "/readings",
  ...requireRole(EXEC_ONLY),
  handle(async (req, res) => {
    const { month, date } = resolvePeriod(req.query);
    const config = resolveConfig();

    ok(res, {
      period: { month, date },
      readings: await getRegisterForPeriod({ sbuCode: config.sbuCode, month, date }),
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/group-kpis/readings — month-end capture
// ---------------------------------------------------------------------------

/**
 * Up to 200 readings per call, matching §9's stated limit.
 *
 * `value` accepts a decimal string or null (to clear). A JSON number is
 * rejected outright rather than coerced: 99.95 as a float64 is not exactly
 * 99.95, and this is the endpoint through which DATA_ACCURACY is captured.
 */
const captureBodySchema = z.object({
  readings: z
    .array(
      z.object({
        measureCode: z.string().min(1).max(64),
        period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Expected YYYY-MM or YYYY-MM-DD"),
        value: z
          .string()
          .refine((v) => isDecimalString(v), "Expected a decimal string of up to 4 places")
          .nullable(),
        currency: z.string().length(3).optional().nullable(),
        note: z.string().max(500).optional().nullable(),
        restatementReason: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Capture is open to finance and HR tiers, NOT just exec.
 *
 * This is the one place the role rule departs from the surrounding exec-only
 * surfaces, and it is deliberate: §9 describes these figures as typed in by
 * "Dokuma's own finance and operations people" as part of month-end. Gating
 * capture on exec would mean the only people permitted to enter the figures are
 * the people the figures are for, which is both impractical and poor separation
 * of duties.
 *
 * Reading stays exec-only; this widens who may write, not who may see.
 */
const CAPTURE_ROLES = GROUP_CAPTURE;

groupKpisRouter.post(
  "/readings",
  ...requireRole(CAPTURE_ROLES),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const body = captureBodySchema.parse(req.body);
    const config = resolveConfig();

    const results = await captureReadings({
      sbuCode: config.sbuCode,
      userId: auth.user.id as string,
      readings: body.readings.map((r) => ({
        measureCode: r.measureCode,
        period: r.period,
        value: r.value,
        currency: r.currency ?? null,
        note: r.note ?? null,
        restatementReason: r.restatementReason ?? null,
      })),
    });

    /**
     * Audited because these are board-level figures. The metadata records
     * WHICH measures changed but not their values — the values live in
     * `sbu_kpi_reading_history` with a proper before/after pair, and copying
     * them into the audit log would duplicate the record without improving it.
     */
    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: "group_kpi.capture",
      entityType: "sbu_kpi_reading",
      metadata: {
        saved: results.filter((r) => r.outcome === "saved").map((r) => r.measureCode),
        rejected: results.filter((r) => r.outcome === "rejected").length,
      },
    });

    // 207 when some documents were rejected, mirroring the ingest API's own
    // partial-success convention rather than inventing a different one.
    const rejected = results.filter((r) => r.outcome === "rejected").length;
    ok(res, { results }, rejected > 0 && rejected < results.length ? 207 : 200);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/group-kpis/suggestions — figures this platform can compute
// ---------------------------------------------------------------------------

/**
 * Suggested values for measures derivable from data already held.
 *
 * Offered to the capture screen, never saved. Each carries a `basis` and a
 * `confidence` so the person capturing can see what the number was computed
 * from before accepting it — see the header of `sbu-kpi-derive.ts` for why a
 * human stays in that loop.
 */
groupKpisRouter.get(
  "/suggestions",
  ...requireRole(CAPTURE_ROLES),
  handle(async (_req, res) => {
    ok(res, { suggestions: await deriveSuggestions() });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/group-kpis/feed/preview — the dry run of §0 step 4
// ---------------------------------------------------------------------------

/**
 * Builds today's batch and returns it WITHOUT sending.
 *
 * This is the local equivalent of the specification's
 * `POST /api/integration/check`, and the single most useful thing available
 * before a signing key exists: it shows exactly what would be sent, which
 * measures are missing, and which stored values would be rejected.
 */
groupKpisRouter.get(
  "/feed/preview",
  ...requireRole(EXEC_ONLY),
  handle(async (req, res) => {
    const { date } = resolvePeriod(req.query);
    const config = resolveConfig();
    const built = await buildDailyBatch(new Date(`${date}T00:00:00Z`), config.sbuCode);

    ok(res, {
      config: describeConfig(config),
      ...built,
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/group-kpis/feed/dispatch — send today's batch
// ---------------------------------------------------------------------------

/**
 * Admin-only, and a POST rather than a GET, because it is the one action here
 * that sends data outside this organisation.
 *
 * The scheduled job is the normal path; this exists for the first end-to-end
 * test and for re-sending a day the cron missed. `?dryRun=true` forces a build
 * without a send even when the feed is live.
 */
groupKpisRouter.post(
  "/feed/dispatch",
  ...requireRole(ADMIN_ONLY),
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { date } = resolvePeriod(req.query);
    const dryRun = req.query["dryRun"] === "true";

    const result = await dispatchDailyFeed({
      readingDate: new Date(`${date}T00:00:00Z`),
      dryRun,
    });

    await audit(req, {
      actorId: auth.user.id as string,
      actorRole: auth.role,
      action: dryRun ? "group_kpi.feed_dry_run" : "group_kpi.feed_dispatch",
      entityType: "sbu_kpi_dispatch",
      entityId: result.clientBatchRef,
      metadata: {
        outcome: result.outcome,
        documentsSent: result.documentsSent,
        httpStatus: result.httpStatus,
      },
    });

    ok(res, result);
  }),
);
