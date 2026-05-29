import pool from "@/lib/db";

// EmailBison stats client — single source of truth for sent/replies/
// interested/bounced KPIs across the dashboard, KPI tracker, and CSM
// update. Matches the CSM update skill's data source so the numbers
// reported to clients reconcile with what the dashboard shows.
//
// Endpoint: GET {instance_url}/api/workspaces/v1.1/stats
//   query: start_date=YYYY-MM-DD&end_date=YYYY-MM-DD (inclusive, workspace local time)
//   header: Authorization: Bearer {workspace_email_bison_api_key}
//   response: { data: { emails_sent, unique_replies_per_contact, interested, bounced, ... } }

export interface EBStats {
  emails_sent: number;
  unique_replies_per_contact: number;
  interested: number;
  bounced: number;
}

export interface WorkspaceEBStats extends EBStats {
  workspaceSlug: string;
  error?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch EmailBison stats for a single workspace and inclusive date range.
 * Returns zeros for all fields if the request fails (logged but not thrown
 * so a single workspace failure doesn't kill the whole dashboard).
 */
export async function fetchWorkspaceEBStats(
  workspaceSlug: string,
  apiKey: string,
  instanceUrl: string,
  start: Date,
  end: Date
): Promise<WorkspaceEBStats> {
  const params = new URLSearchParams({
    start_date: isoDate(start),
    end_date:   isoDate(end),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(
      `${instanceUrl.replace(/\/$/, "")}/api/workspaces/v1.1/stats?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`[eb-stats] ${workspaceSlug} ${res.status}: ${text.slice(0, 200)}`);
      return zero(workspaceSlug, `HTTP ${res.status}`);
    }
    const j = await res.json();
    const d = j?.data ?? {};
    return {
      workspaceSlug,
      emails_sent:              Number(d.emails_sent ?? 0) || 0,
      unique_replies_per_contact: Number(d.unique_replies_per_contact ?? 0) || 0,
      interested:               Number(d.interested ?? 0) || 0,
      bounced:                  Number(d.bounced ?? 0) || 0,
    };
  } catch (err: any) {
    console.error(`[eb-stats] ${workspaceSlug} error:`, err?.message ?? err);
    return zero(workspaceSlug, err?.message ?? String(err));
  } finally {
    clearTimeout(timer);
  }
}

function zero(workspaceSlug: string, error?: string): WorkspaceEBStats {
  return { workspaceSlug, emails_sent: 0, unique_replies_per_contact: 0, interested: 0, bounced: 0, error };
}

/**
 * Fetch EB stats for many workspaces in parallel and return both the
 * per-workspace breakdown and the aggregate totals.
 *
 * Workspaces without EB credentials are skipped (treated as zero
 * contributions to the aggregate).
 */
export async function fetchAggregateEBStats(
  workspaceSlugs: string[],
  start: Date,
  end: Date
): Promise<{
  total: EBStats;
  byWorkspace: Record<string, WorkspaceEBStats>;
}> {
  if (workspaceSlugs.length === 0) {
    return { total: { emails_sent: 0, unique_replies_per_contact: 0, interested: 0, bounced: 0 }, byWorkspace: {} };
  }

  const creds = await pool.query<{
    slug: string; email_bison_api_key: string | null; email_bison_instance_url: string | null;
  }>(
    `SELECT slug, email_bison_api_key, email_bison_instance_url
     FROM workspaces
     WHERE slug = ANY($1::text[])`,
    [workspaceSlugs]
  );

  const results = await Promise.all(
    creds.rows
      .filter(r => r.email_bison_api_key && r.email_bison_instance_url)
      .map(r => fetchWorkspaceEBStats(r.slug, r.email_bison_api_key!, r.email_bison_instance_url!, start, end))
  );

  const byWorkspace: Record<string, WorkspaceEBStats> = {};
  let totalSent = 0, totalReplies = 0, totalInterested = 0, totalBounced = 0;
  for (const r of results) {
    byWorkspace[r.workspaceSlug] = r;
    totalSent       += r.emails_sent;
    totalReplies    += r.unique_replies_per_contact;
    totalInterested += r.interested;
    totalBounced    += r.bounced;
  }
  return {
    total: {
      emails_sent: totalSent,
      unique_replies_per_contact: totalReplies,
      interested: totalInterested,
      bounced: totalBounced,
    },
    byWorkspace,
  };
}
