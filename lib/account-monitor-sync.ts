import pool from "@/lib/db";

// Shared plumbing for the Account Monitor's data pipelines.
//
// Every heavy sync runs ONE WORKSPACE PER HTTP REQUEST. A single request that
// walks every workspace takes minutes and gets cut off by the proxy after
// roughly a minute, so only the first few alphabetical workspaces ever
// finished and the rest sat frozen for weeks. Per-workspace requests finish in
// seconds and can be ordered stalest-first so progress carries across runs.

// A workspace's numbers are considered current while its newest sync is
// younger than these. The scheduler keeps every workspace well inside them
// (stats every 10 min, accounts every 15 min), so hitting a limit means a
// pipeline is actually broken, not merely idle.
export const STATS_MAX_AGE_MIN    = 20;
export const ACCOUNTS_MAX_AGE_MIN = 45;
export const WARMUP_MAX_AGE_HOURS = 8;

// Shown even with no recent sends and no connected senders (paused but still
// monitored). Larsen Digital - Nicklas is larsen-digital, Lukas is acceler8rs.
export const ALWAYS_SHOW_WORKSPACES = ["larsen-digital", "acceler8rs"];

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// POST one workspace's sync. Resolves true only when the request succeeded AND
// the response reports no failed workspace, so callers never mistake a swallowed
// per-workspace error for success.
export async function postWorkspaceSync(
  path: "/api/sync-sender-accounts" | "/api/sync-sender-daily-stats" | "/api/sync-sender-warmup-history",
  slug: string,
  opts: { lookback?: number; timeoutMs?: number; baseUrl?: string } = {}
): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const qs = new URLSearchParams({ workspace: slug });
    if (opts.lookback) qs.set("lookback", String(opts.lookback));
    const res = await fetch(`${opts.baseUrl ?? appBaseUrl()}${path}?${qs}`, { method: "POST", signal: ctl.signal });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return !!data && (data.failed ?? 0) === 0 && data.ok !== false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Which workspaces the Account Monitor and Warmup Monitor show. One rule for
// both, computed from our own synced data (no live EmailBison calls, so a rate
// limit cannot make a workspace vanish):
//   - it has at least one connected sender (still needs monitoring even while
//     paused, which is why a client that sent nothing this week stays visible), or
//   - its senders sent something in the last 7 days, or
//   - it is on the always-show list.
export async function getVisibleWorkspaceSlugs(): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT workspace_slug FROM sender_accounts WHERE status = 'Connected'
      UNION
     SELECT workspace_slug FROM sender_daily_stats
      WHERE date >= CURRENT_DATE - 7
      GROUP BY workspace_slug HAVING SUM(sent) > 0`
  );
  const visible = new Set<string>(rows.map(r => r.workspace_slug as string));
  for (const slug of ALWAYS_SHOW_WORKSPACES) visible.add(slug);
  return visible;
}

export interface WorkspaceFreshness {
  slug: string;
  statsSyncedAt:    string | null;
  accountsSyncedAt: string | null;
  warmupSyncedAt:   string | null;
  statsStale:       boolean;
  accountsStale:    boolean;
  warmupStale:      boolean;
}

export async function getFreshness(slugs: string[]): Promise<WorkspaceFreshness[]> {
  if (slugs.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT w.slug,
            (SELECT MAX(synced_at) FROM sender_daily_stats    s WHERE s.workspace_slug = w.slug) AS stats_at,
            (SELECT MAX(synced_at) FROM sender_accounts       a WHERE a.workspace_slug = w.slug) AS accounts_at,
            (SELECT MAX(synced_at) FROM sender_warmup_periods p WHERE p.workspace_slug = w.slug) AS warmup_at
       FROM unnest($1::text[]) AS w(slug)`,
    [slugs]
  );
  const now = Date.now();
  const age = (ts: Date | null) => (ts ? now - new Date(ts).getTime() : Infinity);
  return rows.map(r => ({
    slug:             r.slug,
    statsSyncedAt:    r.stats_at    ? new Date(r.stats_at).toISOString()    : null,
    accountsSyncedAt: r.accounts_at ? new Date(r.accounts_at).toISOString() : null,
    warmupSyncedAt:   r.warmup_at   ? new Date(r.warmup_at).toISOString()   : null,
    statsStale:       age(r.stats_at)    > STATS_MAX_AGE_MIN * 60_000,
    accountsStale:    age(r.accounts_at) > ACCOUNTS_MAX_AGE_MIN * 60_000,
    // Workspaces with no scored senders never get warmup rows, so a missing
    // timestamp is not treated as stale on its own.
    warmupStale:      r.warmup_at ? age(r.warmup_at) > WARMUP_MAX_AGE_HOURS * 3_600_000 : false,
  }));
}

// Called on every dashboard read. In normal operation the scheduler keeps
// everything fresh and this does nothing. If a workspace has aged past its
// limit (scheduler died, deploy gap), it is refreshed BEFORE the numbers are
// computed, so the page never serves a stale window as if it were current.
// Bounded so a slow EmailBison cannot hang the page.
export async function ensureFresh(slugs: string[]): Promise<void> {
  const fresh = await getFreshness(slugs);
  const jobs: Promise<unknown>[] = [];
  for (const f of fresh) {
    if (f.statsStale)    jobs.push(postWorkspaceSync("/api/sync-sender-daily-stats", f.slug, { lookback: 3, timeoutMs: 20_000 }));
    if (f.accountsStale) jobs.push(postWorkspaceSync("/api/sync-sender-accounts", f.slug, { timeoutMs: 40_000 }));
  }
  if (jobs.length === 0) return;
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise(resolve => setTimeout(resolve, 45_000)),
  ]);
}
