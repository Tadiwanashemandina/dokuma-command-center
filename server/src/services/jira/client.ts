import { resolveJiraConfig, type JiraConfig } from "./config.js";

/**
 * Jira Cloud REST client.
 *
 * Ported from `lib/hr/jira-client.ts` and widened from one-employee lookups to
 * project sync, delivery metrics and issue creation.
 *
 * ---------------------------------------------------------------------------
 * Two facts the legacy client learned the hard way — do not undo them
 * ---------------------------------------------------------------------------
 *  1. `/rest/api/3/search` is GONE (410). Atlassian's own docs recommended it
 *     for years. The replacement is `/rest/api/3/search/jql`, confirmed against
 *     a live site.
 *
 *  2. `/search/jql` REQUIRES a bounded query. An unfiltered JQL is rejected
 *     with 400 — so every search here carries at least one real constraint, and
 *     `searchIssues()` refuses an empty JQL rather than letting the API say no.
 *
 * Auth is HTTP Basic with `email:apiToken`, which is what Atlassian Cloud
 * expects for a user API token (not a Bearer token — that is OAuth, a different
 * scheme entirely).
 */

export class JiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = "JiraError";
  }

  /** The token is wrong, expired, or the account lost access. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export class JiraNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JiraNotConfiguredError";
  }
}

function authHeader(config: JiraConfig): string {
  return "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
}

/**
 * One authenticated request.
 *
 * Retries only on 429 and 5xx, and only with the delay Atlassian asks for.
 * A 4xx is a bug in the request and retrying it just burns the rate limit.
 */
async function jiraRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; config?: JiraConfig } = {},
): Promise<T> {
  const config = options.config ?? resolveJiraConfig();
  if (!config.enabled || !config.siteUrl) {
    throw new JiraNotConfiguredError(config.reason ?? "Jira is not configured.");
  }

  const url = `${config.siteUrl}${path}`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: authHeader(config),
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      // 204 on some writes: no body to parse.
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      // Honour Retry-After when given; otherwise back off exponentially.
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 10_000)));
      continue;
    }

    const body = await response.text().catch(() => "");
    throw new JiraError(
      response.status,
      `Jira ${options.method ?? "GET"} ${path} failed (${response.status})`,
      body.slice(0, 500),
    );
  }

  throw new JiraError(0, `Jira ${path} failed after ${maxAttempts} attempts`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraIssue {
  key: string;
  id: string;
  summary: string;
  status: string;
  /** Jira's three-bucket rollup: To Do / In Progress / Done. */
  statusCategory: "new" | "indeterminate" | "done" | string;
  issueType: string;
  priority: string | null;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  projectKey: string;
  dueDate: string | null;
  created: string | null;
  updated: string | null;
  resolutionDate: string | null;
  labels: string[];
  url: string;
}

interface RawIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: { accountId?: string; displayName?: string };
    project?: { key?: string };
    duedate?: string | null;
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    labels?: string[];
  };
}

/** The fields every caller needs. Requested explicitly — `*all` is far slower. */
const ISSUE_FIELDS =
  "summary,status,issuetype,priority,assignee,project,duedate,created,updated,resolutiondate,labels";

function toIssue(raw: RawIssue, siteUrl: string): JiraIssue {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    id: raw.id,
    summary: f.summary ?? "(no summary)",
    status: f.status?.name ?? "Unknown",
    statusCategory: f.status?.statusCategory?.key ?? "new",
    issueType: f.issuetype?.name ?? "Task",
    priority: f.priority?.name ?? null,
    assigneeAccountId: f.assignee?.accountId ?? null,
    assigneeName: f.assignee?.displayName ?? null,
    projectKey: f.project?.key ?? "",
    dueDate: f.duedate ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    resolutionDate: f.resolutiondate ?? null,
    labels: f.labels ?? [],
    url: `${siteUrl}/browse/${raw.key}`,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Runs a JQL search, following pagination to the end.
 *
 * `/search/jql` pages with an opaque `nextPageToken` rather than startAt/total,
 * so the loop follows the token until Jira stops issuing one. `maxTotal` is a
 * hard stop: a mistyped JQL matching 50,000 issues should cost one bounded
 * request cycle, not exhaust memory.
 */
export async function searchIssues(
  jql: string,
  options: { maxTotal?: number; config?: JiraConfig } = {},
): Promise<JiraIssue[]> {
  const config = options.config ?? resolveJiraConfig();
  if (!config.enabled || !config.siteUrl) {
    throw new JiraNotConfiguredError(config.reason ?? "Jira is not configured.");
  }

  // See the header: an unbounded JQL is a 400 from this endpoint. Failing here
  // gives a clear message instead of an opaque Atlassian error.
  if (!jql.trim()) {
    throw new JiraError(400, "JQL must be bounded — /search/jql rejects an empty query.");
  }

  const maxTotal = options.maxTotal ?? 1000;
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      jql,
      maxResults: String(Math.min(100, maxTotal - issues.length)),
      fields: ISSUE_FIELDS,
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);

    const page = await jiraRequest<{ issues?: RawIssue[]; nextPageToken?: string }>(
      `/rest/api/3/search/jql?${params.toString()}`,
      { config },
    );

    for (const raw of page.issues ?? []) issues.push(toIssue(raw, config.siteUrl));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < maxTotal);

  return issues;
}

/** Every issue in a project, newest first. */
export function searchProjectIssues(
  projectKey: string,
  options: { updatedSince?: Date; maxTotal?: number; config?: JiraConfig } = {},
): Promise<JiraIssue[]> {
  // Quoted so a key containing a reserved word cannot break the query.
  let jql = `project = "${projectKey}"`;

  if (options.updatedSince) {
    // Jira wants "yyyy-MM-dd HH:mm" in the site's timezone. Minute precision is
    // enough for an incremental sync and avoids timezone-boundary misses.
    const stamp = options.updatedSince.toISOString().slice(0, 16).replace("T", " ");
    jql += ` AND updated >= "${stamp}"`;
  }

  return searchIssues(`${jql} ORDER BY updated DESC`, options);
}

/** One person's assigned issues — the legacy per-employee lookup. */
export function searchIssuesForAccount(
  accountId: string,
  options: { maxTotal?: number; config?: JiraConfig } = {},
): Promise<JiraIssue[]> {
  return searchIssues(`assignee = "${accountId}" ORDER BY updated DESC`, {
    maxTotal: options.maxTotal ?? 50,
    ...options,
  });
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

/** Projects the token can see — used to offer a mapping UI. */
export async function listProjects(config?: JiraConfig): Promise<JiraProject[]> {
  const page = await jiraRequest<{ values?: JiraProject[] }>(
    "/rest/api/3/project/search?maxResults=100",
    { config },
  );
  return page.values ?? [];
}

/** Verifies the credentials. The Jira equivalent of a whoami. */
export async function getCurrentUser(
  config?: JiraConfig,
): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
  return jiraRequest("/rest/api/3/myself", { config });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Creates an issue.
 *
 * `description` is Atlassian Document Format, not a string — passing plain text
 * yields a 400 with an unhelpful message, so the conversion happens here rather
 * than at every call site.
 */
export async function createIssue(
  input: {
    projectKey: string;
    summary: string;
    description?: string;
    issueType?: string;
    labels?: string[];
    dueDate?: string;
  },
  config?: JiraConfig,
): Promise<{ id: string; key: string; self: string }> {
  return jiraRequest("/rest/api/3/issue", {
    method: "POST",
    config,
    body: {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary.slice(0, 255),
        issuetype: { name: input.issueType ?? "Task" },
        ...(input.description ? { description: toAdf(input.description) } : {}),
        ...(input.labels?.length ? { labels: input.labels } : {}),
        ...(input.dueDate ? { duedate: input.dueDate } : {}),
      },
    },
  });
}

/** Updates fields on an existing issue. Returns nothing (204). */
export async function updateIssue(
  issueKey: string,
  fields: { summary?: string; description?: string; dueDate?: string; labels?: string[] },
  config?: JiraConfig,
): Promise<void> {
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    config,
    body: {
      fields: {
        ...(fields.summary ? { summary: fields.summary.slice(0, 255) } : {}),
        ...(fields.description ? { description: toAdf(fields.description) } : {}),
        ...(fields.dueDate ? { duedate: fields.dueDate } : {}),
        ...(fields.labels ? { labels: fields.labels } : {}),
      },
    },
  });
}

export async function addComment(
  issueKey: string,
  text: string,
  config?: JiraConfig,
): Promise<{ id: string }> {
  return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    config,
    body: { body: toAdf(text) },
  });
}

/**
 * Plain text → Atlassian Document Format.
 *
 * Minimal on purpose: one paragraph per line. ADF is a rich nested format and a
 * fuller conversion would be a markdown parser — worth writing only when
 * something here actually needs formatting.
 */
function toAdf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
  };
}
