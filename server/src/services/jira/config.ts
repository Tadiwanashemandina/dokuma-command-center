/**
 * Atlassian Jira connection settings.
 *
 * Follows the same fail-closed shape as `oneplatform/config.ts`: resolved at
 * call time, never at import, and degrading to `disabled` with a stated reason
 * rather than throwing. An unconfigured Jira is a normal condition here — it is
 * the state every developer runs in, and a missing token must not stop the
 * dashboard rendering.
 *
 * Read from the environment so the token never enters the database or a
 * response body.
 */

export interface JiraConfig {
  enabled: boolean;
  /** e.g. https://dokumadigital.atlassian.net — no trailing slash. */
  siteUrl: string | null;
  email: string | null;
  apiToken: string | null;
  /** Project keys to sync, or null for all the token can see. */
  projectKeys: string[] | null;
  reason: string | null;
}

/** Placeholder values shipped in `.env.local.example`. Treated as unset. */
const PLACEHOLDER = /your-site|your-atlassian|example\.com|xxx+/i;

export function resolveJiraConfig(): JiraConfig {
  const rawSite = process.env["JIRA_SITE_URL"]?.trim() || null;
  const email = process.env["JIRA_EMAIL"]?.trim() || null;
  const apiToken = process.env["JIRA_API_TOKEN"]?.trim() || null;

  /**
   * Null means "every project the token can see"; a list narrows it.
   *
   * An EMPTY list must collapse back to null. `""?.split(",")` does not
   * short-circuit — an empty string is not nullish — so a blank
   * `JIRA_PROJECT_KEYS=` would otherwise yield `[]`, which reads as "sync zero
   * projects" and silently syncs nothing.
   */
  const parsedKeys = (process.env["JIRA_PROJECT_KEYS"] ?? "")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);
  const projectKeys = parsedKeys.length > 0 ? parsedKeys : null;

  const base = { siteUrl: null, email: null, apiToken: null, projectKeys, enabled: false };

  if (!rawSite || !email || !apiToken) {
    return { ...base, reason: "JIRA_SITE_URL / JIRA_EMAIL / JIRA_API_TOKEN are not set." };
  }

  /**
   * The example file ships placeholders, and a half-configured deployment that
   * silently sends `your-atlassian-api-token` as a credential is worse than one
   * that refuses: it produces 401s that look like a revoked token.
   */
  if (PLACEHOLDER.test(rawSite) || PLACEHOLDER.test(email) || PLACEHOLDER.test(apiToken)) {
    return { ...base, reason: "Jira settings still hold the example placeholders." };
  }

  let siteUrl: string;
  try {
    const parsed = new URL(rawSite);
    // The API token is sent as HTTP Basic on every request; over plain HTTP it
    // would cross the wire recoverable.
    if (parsed.protocol !== "https:") {
      return { ...base, reason: "JIRA_SITE_URL must use https." };
    }
    // Normalised without a trailing slash, so path joins never double up.
    siteUrl = parsed.origin;
  } catch {
    return { ...base, reason: "JIRA_SITE_URL is not a valid URL." };
  }

  return { enabled: true, siteUrl, email, apiToken, projectKeys, reason: null };
}

/** Redacted view for the UI — never exposes the token. */
export function describeJiraConfig(config: JiraConfig): {
  enabled: boolean;
  siteUrl: string | null;
  email: string | null;
  projectKeys: string[] | null;
  reason: string | null;
} {
  return {
    enabled: config.enabled,
    siteUrl: config.siteUrl,
    // The account email identifies WHICH Atlassian user the integration acts
    // as, which is what an administrator checks after a token rotation. The
    // token itself is never returned by any code path.
    email: config.email,
    projectKeys: config.projectKeys,
    reason: config.reason,
  };
}
