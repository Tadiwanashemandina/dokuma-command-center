// Server-only — holds the Atlassian API token. Never imported by a client
// component. Uses the modern /rest/api/3/search/jql endpoint; the older
// /rest/api/3/search endpoint Atlassian's own docs used to recommend was
// removed (410 Gone) as of this build — confirmed directly against
// dokumadigital.atlassian.net before writing this client.

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  url: string;
};

function authHeader(): string {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN are not configured.");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/** JQL requires a bounded query on this endpoint — an unfiltered search is
 * rejected with 400. Filtering by a specific assignee account ID always
 * satisfies that requirement. */
export async function searchIssuesForAccount(jiraAccountId: string): Promise<JiraIssue[]> {
  const site = process.env.JIRA_SITE_URL;
  if (!site) throw new Error("JIRA_SITE_URL is not configured.");

  const jql = `assignee = "${jiraAccountId}" order by updated desc`;
  const url = `${site}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=25&fields=summary,status,duedate`;

  const res = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.issues ?? []).map((issue: { key: string; fields: { summary: string; status: { name: string }; duedate: string | null } }) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? "Unknown",
    dueDate: issue.fields.duedate,
    url: `${site}/browse/${issue.key}`,
  }));
}
