// Per-workspace success metric — single source of truth for the
// "Conversions" KPI on the dashboard, KPI tracker, and CSM update.
//
// Two success types:
//   "airtable_date"      — count records in Airtable whose date column falls
//                          in the range. Used when the workspace actually
//                          tracks a downstream conversion event (meeting
//                          booked, deal closed, etc.).
//   "interested_proxy"   — estimate success as (positive_replies × proxy
//                          conversion rate, default 40%). Used when the
//                          workspace has no downstream tracking we can read
//                          (ACT/Statera/Hahnbeck — NDA signing or call
//                          booking happens outside our visibility, but
//                          historically ~40-50% of interested leads convert).
//                          Lukas confirmed 2026-05-29 that 40% is the
//                          historical average for these workspaces.
//
// successLabel is what we display in the UI for the per-workspace view.

export type SuccessType = "airtable_date" | "interested_proxy";

/**
 * Default conversion rate applied to interested_proxy workspaces.
 * Historically 40-50% of interested replies convert downstream for
 * workspaces where we don't have visibility into the actual conversion event.
 */
export const DEFAULT_PROXY_CONVERSION_RATE = 0.40;

export interface SuccessMetricConfig {
  /** Internal workspace slug as stored in the workspaces table */
  workspaceSlug: string;
  /** Human-readable label for the workspace's success metric */
  successLabel: string;
  /** How to count success for this workspace */
  successType: SuccessType;
  /** Airtable base id (app...) — only used when successType=airtable_date */
  baseId?: string;
  /** Airtable table id (tbl...) — only used when successType=airtable_date */
  tableId?: string;
  /** Exact field name as it appears in the table (case matters) */
  field?: string;
  /** Optional extra filter clause, ANDed with the date filter */
  filter?: string;
  /** Override the default proxy conversion rate for interested_proxy workspaces */
  proxyConversionRate?: number;
}

export const SUCCESS_METRIC_CONFIG: SuccessMetricConfig[] = [
  // Interested-proxy workspaces: deeper tracking not available, so we
  // estimate success as positive_replies × 40% (historical average).
  { workspaceSlug: "911-restoration",   successLabel: "Est. Leads Delivered", successType: "interested_proxy" },
  { workspaceSlug: "act-capital",        successLabel: "Est. NDAs Signed", successType: "interested_proxy" },
  { workspaceSlug: "statera-capital",    successLabel: "Est. NDAs Signed", successType: "interested_proxy" },
  { workspaceSlug: "hahnbeck",           successLabel: "Est. Taliesen Handoffs", successType: "interested_proxy" },

  // Meeting-tracked workspaces (Airtable date column).
  { workspaceSlug: "acceler8rs",         successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appp8h0kv9DEHYpXR", tableId: "tblkoizZek5r5wi45", field: "Meeting booked date", filter: `{Deal Source} = "Lukas"` },
  { workspaceSlug: "gn-motion",          successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appL5fZEyULdqpyx5", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "internal-campaigns", successLabel: "Meetings Booked", successType: "airtable_date", baseId: "app9rWZ2iE4eWECEN", tableId: "tblCATnaPTV9fb2Ab", field: "Meeting booked date" },
  { workspaceSlug: "itg-group",          successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appajhv22WuCEw7Aa", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "larsen-digital",     successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appp8h0kv9DEHYpXR", tableId: "tblkoizZek5r5wi45", field: "Meeting booked date", filter: `{Deal Source} = "Nicklas"` },
  { workspaceSlug: "sonaro-ai",          successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appNMGCTwXVOLLzmA", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "venture-exits",      successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appA3W783M4v9IShx", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "wrobel-capital",     successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appFvPc98WyrPibkV", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "zebs-ibs",           successLabel: "Meetings Booked", successType: "airtable_date", baseId: "appdpPuzEjTqFSOi2", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
];

const CONFIG_BY_SLUG: Record<string, SuccessMetricConfig> = Object.fromEntries(
  SUCCESS_METRIC_CONFIG.map(c => [c.workspaceSlug, c])
);

/** Default fallback for any workspace not explicitly configured. */
const DEFAULT_CONFIG: SuccessMetricConfig = {
  workspaceSlug: "",
  successLabel: "Conversions",
  successType: "interested_proxy",
};

export function getSuccessMetricConfig(workspaceSlug: string): SuccessMetricConfig {
  return CONFIG_BY_SLUG[workspaceSlug] ?? { ...DEFAULT_CONFIG, workspaceSlug };
}

// ── Backwards compatibility shim ───────────────────────────────────────────
// Other files may still import the old name. Keep AIRTABLE_MEETINGS_CONFIG
// as the airtable_date subset of the new config.
export const AIRTABLE_MEETINGS_CONFIG = SUCCESS_METRIC_CONFIG.filter(c => c.successType === "airtable_date");
export type AirtableMeetingsConfig = SuccessMetricConfig;

function isoDate(d: Date): string {
  // Use YYYY-MM-DD in UTC. Airtable's IS_AFTER / IS_BEFORE / IS_SAME treat
  // date-only strings as midnight in the base's TZ, which is the team
  // convention here.
  return d.toISOString().slice(0, 10);
}

/**
 * Build the filterByFormula clause for a date range.
 *
 * Airtable IS_AFTER and IS_BEFORE are STRICTLY exclusive, so we shift both
 * boundaries by one day to make the range inclusive on both ends.
 * For a desired range [start, end]:
 *   IS_AFTER(field, start - 1 day)  AND  IS_BEFORE(field, end + 1 day)
 * gives every record where start <= field <= end.
 */
function buildFilter(cfg: SuccessMetricConfig, start: Date, end: Date): string {
  const startMinusOne = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const endPlusOne    = new Date(end.getTime()   + 24 * 60 * 60 * 1000);
  const dateClause = `AND(IS_AFTER({${cfg.field}}, '${isoDate(startMinusOne)}'), IS_BEFORE({${cfg.field}}, '${isoDate(endPlusOne)}'))`;
  if (cfg.filter) {
    return `AND(${dateClause}, ${cfg.filter})`;
  }
  return dateClause;
}

/**
 * Count meetings booked in [start, end] for a single workspace.
 * Returns null if the workspace has no Airtable date config (e.g. is
 * configured as interested_proxy) or the request fails.
 */
export async function fetchWorkspaceMeetingsCount(
  workspaceSlug: string,
  start: Date,
  end: Date,
  apiKey: string
): Promise<number | null> {
  const cfg = CONFIG_BY_SLUG[workspaceSlug];
  if (!cfg || cfg.successType !== "airtable_date" || !cfg.baseId || !cfg.tableId || !cfg.field) return null;

  let offset: string | undefined;
  let total = 0;
  let pages = 0;
  const maxPages = 20; // guardrail, 20 * 100 = 2000 records is plenty for a month

  try {
    do {
      const params = new URLSearchParams();
      params.set("filterByFormula", buildFilter(cfg, start, end));
      params.append("fields[]", cfg.field!);
      params.set("pageSize", "100");
      if (offset) params.set("offset", offset);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      let res: Response;
      try {
        res = await fetch(
          `https://api.airtable.com/v0/${cfg.baseId}/${cfg.tableId}?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctrl.signal,
          }
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text();
        console.error(`[airtable-meetings] ${workspaceSlug} ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      total += (data.records ?? []).length;
      offset = data.offset;
      pages++;
    } while (offset && pages < maxPages);

    return total;
  } catch (err: any) {
    console.error(`[airtable-meetings] ${workspaceSlug} error:`, err?.message ?? err);
    return null;
  }
}

/**
 * Count meetings across every configured workspace, parallel fetched.
 * Workspaces without an Airtable config contribute 0. Failed fetches are
 * logged but do not break the aggregate; they contribute 0.
 *
 * Returns the aggregate count and a per-workspace breakdown for debugging.
 */
export async function fetchAllWorkspacesMeetingsCount(
  start: Date,
  end: Date,
  apiKey: string,
  slugsToInclude?: string[]
): Promise<{ total: number; byWorkspace: Record<string, number> }> {
  const targets = slugsToInclude
    ? AIRTABLE_MEETINGS_CONFIG.filter(c => slugsToInclude.includes(c.workspaceSlug))
    : AIRTABLE_MEETINGS_CONFIG;

  const results = await Promise.all(
    targets.map(async c => {
      const count = await fetchWorkspaceMeetingsCount(c.workspaceSlug, start, end, apiKey);
      return { slug: c.workspaceSlug, count: count ?? 0 };
    })
  );

  const byWorkspace: Record<string, number> = {};
  let total = 0;
  for (const r of results) {
    byWorkspace[r.slug] = r.count;
    total += r.count;
  }
  return { total, byWorkspace };
}

/**
 * Get the success count for a single workspace using its configured
 * success type. For airtable_date workspaces, fetches from Airtable; for
 * interested_proxy workspaces, returns the provided interested count.
 *
 * `interestedCount` MUST be the workspace's positive-reply count in the
 * requested window (the caller already has this from the DB query).
 */
export async function getWorkspaceSuccess(
  workspaceSlug: string,
  start: Date,
  end: Date,
  interestedCount: number,
  apiKey: string | undefined
): Promise<number> {
  const cfg = getSuccessMetricConfig(workspaceSlug);
  if (cfg.successType === "interested_proxy") {
    const rate = cfg.proxyConversionRate ?? DEFAULT_PROXY_CONVERSION_RATE;
    return Math.round(interestedCount * rate);
  }
  if (!apiKey) return 0;
  const n = await fetchWorkspaceMeetingsCount(workspaceSlug, start, end, apiKey);
  return n ?? 0;
}

/**
 * Aggregate "Conversions" across many workspaces, using each workspace's
 * configured success metric. Pure summation; no rate computation here
 * (the caller does that with the interested count it already has).
 *
 * `interestedByWorkspace` maps workspace_slug → positive-reply count for
 * the same range. Slugs missing from the map are treated as 0 interested.
 *
 * Returns total + per-workspace breakdown for tooltips.
 */
export interface WorkspaceSuccessRow {
  count: number;
  label: string;
  type: SuccessType;
  /** For interested_proxy workspaces, the raw interested count and the multiplier */
  basis?: { interested: number; multiplier: number };
}

export async function aggregateWorkspaceSuccess(
  workspaceSlugs: string[],
  start: Date,
  end: Date,
  interestedByWorkspace: Record<string, number>,
  apiKey: string | undefined
): Promise<{ total: number; byWorkspace: Record<string, WorkspaceSuccessRow> }> {
  const results = await Promise.all(
    workspaceSlugs.map(async slug => {
      const cfg = getSuccessMetricConfig(slug);
      const interested = interestedByWorkspace[slug] ?? 0;
      const count = await getWorkspaceSuccess(slug, start, end, interested, apiKey);
      const basis = cfg.successType === "interested_proxy"
        ? { interested, multiplier: cfg.proxyConversionRate ?? DEFAULT_PROXY_CONVERSION_RATE }
        : undefined;
      return { slug, count, label: cfg.successLabel, type: cfg.successType, basis };
    })
  );
  const byWorkspace: Record<string, WorkspaceSuccessRow> = {};
  let total = 0;
  for (const r of results) {
    byWorkspace[r.slug] = { count: r.count, label: r.label, type: r.type, basis: r.basis };
    total += r.count;
  }
  return { total, byWorkspace };
}
