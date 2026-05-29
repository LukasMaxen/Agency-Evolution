// Airtable meetings client — single source of truth for meeting counts.
// Mirrors the per-client config in 1. Departments/operations/SKILL_CSMUpdate.md
// so the dashboard, KPI tracker, and CSM update all report the same number.
//
// Field-name casing varies per base (some "Meeting Booked Date", others
// "Meeting booked date"), so each workspace has its own config row.

export interface AirtableMeetingsConfig {
  /** Internal workspace slug as stored in the workspaces table */
  workspaceSlug: string;
  /** Airtable base id (app...) */
  baseId: string;
  /** Airtable table id (tbl...) */
  tableId: string;
  /** Exact field name as it appears in the table (case matters) */
  field: string;
  /** Optional extra filter clause, ANDed with the date filter (e.g. `{Deal Source} = "Cold email (LD)"`) */
  filter?: string;
}

export const AIRTABLE_MEETINGS_CONFIG: AirtableMeetingsConfig[] = [
  { workspaceSlug: "911-restoration",   baseId: "appGTy1rR6eZjKu62", tableId: "tblVEhq27whUNk4KY", field: "Meeting booked date" },
  { workspaceSlug: "act-capital",        baseId: "appECObQrdSRjeXeM", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "acceler8rs",         baseId: "appV8wpBdqTgCi4Ws", tableId: "tblCATnaPTV9fb2Ab", field: "Meeting booked date", filter: `{Deal Source} = "Cold email (Acceler8rs)"` },
  { workspaceSlug: "gn-motion",          baseId: "appL5fZEyULdqpyx5", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "hahnbeck",           baseId: "appUZr45I0MK7uv3w", tableId: "tbl9KatGYqPFB45Hs", field: "Meeting booked date" },
  { workspaceSlug: "internal-campaigns", baseId: "app9rWZ2iE4eWECEN", tableId: "tblCATnaPTV9fb2Ab", field: "Meeting booked date" },
  { workspaceSlug: "itg-group",          baseId: "appajhv22WuCEw7Aa", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "larsen-digital",     baseId: "appV8wpBdqTgCi4Ws", tableId: "tblCATnaPTV9fb2Ab", field: "Meeting booked date", filter: `{Deal Source} = "Cold email (LD)"` },
  { workspaceSlug: "sonaro-ai",          baseId: "appNMGCTwXVOLLzmA", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "statera-capital",    baseId: "app0EI3nqT3ScUJOf", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "venture-exits",      baseId: "appA3W783M4v9IShx", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "wrobel-capital",     baseId: "appFvPc98WyrPibkV", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  { workspaceSlug: "zebs-ibs",           baseId: "appdpPuzEjTqFSOi2", tableId: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
];

const CONFIG_BY_SLUG: Record<string, AirtableMeetingsConfig> = Object.fromEntries(
  AIRTABLE_MEETINGS_CONFIG.map(c => [c.workspaceSlug, c])
);

function isoDate(d: Date): string {
  // Use YYYY-MM-DD in UTC. Airtable's IS_AFTER / IS_BEFORE / IS_SAME treat
  // date-only strings as midnight in the base's TZ, which is the team
  // convention here.
  return d.toISOString().slice(0, 10);
}

/**
 * Build the filterByFormula clause for a date range.
 * Inclusive on both ends.
 */
function buildFilter(cfg: AirtableMeetingsConfig, start: Date, end: Date): string {
  const startStr = isoDate(start);
  const endStr   = isoDate(end);
  const dateClause = `AND(IS_AFTER({${cfg.field}}, '${startStr}'), IS_BEFORE({${cfg.field}}, '${isoDate(new Date(end.getTime() + 24 * 60 * 60 * 1000))}'))`;
  // ↑ Pushing end by +1 day so IS_BEFORE includes the end date itself.
  // IS_SAME({field}, 'date', 'day') works too but doesn't compose into AND cleanly with the extra filter.
  if (cfg.filter) {
    return `AND(${dateClause}, ${cfg.filter})`;
  }
  return dateClause;
}

/**
 * Count meetings booked in [start, end] for a single workspace.
 * Returns null if the workspace has no Airtable config or the request fails.
 */
export async function fetchWorkspaceMeetingsCount(
  workspaceSlug: string,
  start: Date,
  end: Date,
  apiKey: string
): Promise<number | null> {
  const cfg = CONFIG_BY_SLUG[workspaceSlug];
  if (!cfg) return null;

  let offset: string | undefined;
  let total = 0;
  let pages = 0;
  const maxPages = 20; // guardrail, 20 * 100 = 2000 records is plenty for a month

  try {
    do {
      const params = new URLSearchParams();
      params.set("filterByFormula", buildFilter(cfg, start, end));
      params.append("fields[]", cfg.field);
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
