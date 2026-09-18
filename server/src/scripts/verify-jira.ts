import "./load-env.js";
import { resolveJiraConfig, describeJiraConfig } from "../services/jira/config.js";
import { searchIssues, JiraNotConfiguredError, JiraError } from "../services/jira/client.js";

/**
 * Offline verification for the Jira integration.
 *
 * Needs no database and no network. It checks the things that would otherwise
 * only surface at 03:00: that an unconfigured or placeholder-configured
 * integration fails CLOSED, that the token never leaks into a describe(), and
 * that an unbounded JQL is refused locally rather than by Atlassian.
 *
 *   npm run verify:jira --workspace @dokuma/server
 */

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

const saved = {
  site: process.env["JIRA_SITE_URL"],
  email: process.env["JIRA_EMAIL"],
  token: process.env["JIRA_API_TOKEN"],
  keys: process.env["JIRA_PROJECT_KEYS"],
};

function setEnv(site?: string, email?: string, token?: string): void {
  if (site === undefined) delete process.env["JIRA_SITE_URL"];
  else process.env["JIRA_SITE_URL"] = site;
  if (email === undefined) delete process.env["JIRA_EMAIL"];
  else process.env["JIRA_EMAIL"] = email;
  if (token === undefined) delete process.env["JIRA_API_TOKEN"];
  else process.env["JIRA_API_TOKEN"] = token;
}

const REAL_SITE = "https://dokumadigital.atlassian.net";
const REAL_EMAIL = "ops@dokuma.africa";
const REAL_TOKEN = "ATATT-not-a-real-token-but-shaped-like-one";

async function main(): Promise<void> {
  console.log("\n[1] Configuration fails closed");

  setEnv(undefined, undefined, undefined);
  equal("nothing set → disabled", resolveJiraConfig().enabled, false);

  setEnv(REAL_SITE, undefined, undefined);
  equal("site only → disabled", resolveJiraConfig().enabled, false);

  setEnv(REAL_SITE, REAL_EMAIL, undefined);
  equal("no token → disabled", resolveJiraConfig().enabled, false);

  // The example file ships these. A deployment that half-copied it must refuse,
  // not send `your-atlassian-api-token` as a credential.
  setEnv("https://your-site.atlassian.net", "your-atlassian-account-email", "your-atlassian-api-token");
  equal("example placeholders → disabled", resolveJiraConfig().enabled, false);
  check(
    "the reason names the placeholders",
    (resolveJiraConfig().reason ?? "").includes("placeholder"),
  );

  setEnv("http://dokumadigital.atlassian.net", REAL_EMAIL, REAL_TOKEN);
  equal("plain http → disabled", resolveJiraConfig().enabled, false);

  setEnv("not a url", REAL_EMAIL, REAL_TOKEN);
  equal("malformed url → disabled", resolveJiraConfig().enabled, false);

  setEnv(REAL_SITE, REAL_EMAIL, REAL_TOKEN);
  equal("complete https config → enabled", resolveJiraConfig().enabled, true);

  console.log("\n[2] URL normalisation");

  setEnv(`${REAL_SITE}/`, REAL_EMAIL, REAL_TOKEN);
  equal("a trailing slash is stripped", resolveJiraConfig().siteUrl, REAL_SITE);

  setEnv(`${REAL_SITE}/jira/software/projects`, REAL_EMAIL, REAL_TOKEN);
  equal("a path is reduced to the origin", resolveJiraConfig().siteUrl, REAL_SITE);

  console.log("\n[3] The token never leaks");

  setEnv(REAL_SITE, REAL_EMAIL, REAL_TOKEN);
  const described = describeJiraConfig(resolveJiraConfig());
  check(
    "describeJiraConfig omits the token",
    !JSON.stringify(described).includes(REAL_TOKEN),
  );
  equal("but keeps the account email, for rotation checks", described.email, REAL_EMAIL);
  equal("and the site", described.siteUrl, REAL_SITE);

  console.log("\n[4] Project key parsing");

  process.env["JIRA_PROJECT_KEYS"] = "dok, plat ,DEEDS";
  const keys = resolveJiraConfig().projectKeys;
  equal("keys are upper-cased and trimmed", keys?.join(","), "DOK,PLAT,DEEDS");

  process.env["JIRA_PROJECT_KEYS"] = "";
  check("an empty list is null, not an empty array", resolveJiraConfig().projectKeys === null);
  delete process.env["JIRA_PROJECT_KEYS"];

  console.log("\n[5] Search refuses an unbounded query");

  /**
   * `/search/jql` rejects an unbounded JQL with a 400. Catching it locally
   * turns an opaque Atlassian error into a clear one — and costs no request.
   */
  setEnv(REAL_SITE, REAL_EMAIL, REAL_TOKEN);
  try {
    await searchIssues("   ");
    failures += 1;
    checks += 1;
    console.error("  FAIL an empty JQL should throw");
  } catch (error) {
    checks += 1;
    check(
      "an empty JQL is refused before any request",
      error instanceof JiraError && error.status === 400,
      String(error),
    );
  }

  console.log("\n[6] Unconfigured calls throw the typed error");

  setEnv(undefined, undefined, undefined);
  try {
    await searchIssues('project = "ABC"');
    failures += 1;
    checks += 1;
    console.error("  FAIL an unconfigured search should throw");
  } catch (error) {
    checks += 1;
    check(
      "an unconfigured search throws JiraNotConfiguredError",
      error instanceof JiraNotConfiguredError,
      String(error),
    );
  }

  // Restore, so this script leaves the environment as it found it.
  for (const [name, value] of [
    ["JIRA_SITE_URL", saved.site],
    ["JIRA_EMAIL", saved.email],
    ["JIRA_API_TOKEN", saved.token],
    ["JIRA_PROJECT_KEYS", saved.keys],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("verify-jira crashed:", error);
  process.exitCode = 1;
});
