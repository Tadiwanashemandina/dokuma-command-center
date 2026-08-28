import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { searchIssuesForAccount } from "./jira-client";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type CachedJiraTask = {
  jira_issue_key: string;
  summary: string | null;
  status: string | null;
  due_date: string | null;
  url: string | null;
  fetched_at: string;
};

/**
 * Reads jira_tasks_cache; refetches from the real Jira API only if the
 * cache is empty or older than 15 minutes. This is what satisfies "refresh
 * every 15 minutes" — a pull-based check on page view rather than a push
 * cron, so it needs no extra deploy infrastructure (see Phase 1's daily
 * report for the same trade-off).
 */
export async function getEmployeeJiraTasks(employeeId: string, jiraAccountId: string | null): Promise<CachedJiraTask[]> {
  if (!jiraAccountId) return [];

  const supabase = await createClient();
  const { data: cached } = await supabase
    .from("jira_tasks_cache")
    .select("*")
    .eq("employee_id", employeeId)
    .order("fetched_at", { ascending: false });

  const newestFetch = cached?.[0]?.fetched_at ? new Date(cached[0].fetched_at).getTime() : 0;
  const isStale = Date.now() - newestFetch > CACHE_TTL_MS;

  if (!isStale && cached && cached.length > 0) {
    return cached;
  }

  try {
    const issues = await searchIssuesForAccount(jiraAccountId);
    const service = createServiceRoleClient();
    const fetchedAt = new Date().toISOString();

    if (issues.length > 0) {
      await service.from("jira_tasks_cache").upsert(
        issues.map((issue) => ({
          employee_id: employeeId,
          jira_issue_key: issue.key,
          summary: issue.summary,
          status: issue.status,
          due_date: issue.dueDate,
          url: issue.url,
          fetched_at: fetchedAt,
        })),
        { onConflict: "employee_id,jira_issue_key" }
      );
    }

    return issues.map((issue) => ({
      jira_issue_key: issue.key,
      summary: issue.summary,
      status: issue.status,
      due_date: issue.dueDate,
      url: issue.url,
      fetched_at: fetchedAt,
    }));
  } catch (err) {
    // Jira being briefly unreachable shouldn't break the whole profile page
    // — fall back to whatever's cached, even if stale, rather than throwing.
    console.error("Jira refresh failed, serving cached tasks:", err);
    return cached ?? [];
  }
}
