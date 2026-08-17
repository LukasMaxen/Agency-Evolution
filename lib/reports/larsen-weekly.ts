// Weekly Larsen Digital outreach tracker — fills in the "Larsen Outreach Tracking" Google
// Sheet (Weekly Tracking 2026 tab) for the week that just finished (Mon-Sun).
//
// Sources (no Make, no Slack, no Airtable in this pipeline):
//   - Emails Sent / Replies / Interested: EmailBison's per-campaign, date-ranged stats
//     endpoint — POST /api/campaigns/{id}/stats with {start_date, end_date} in the JSON
//     body (NOT query params — those are silently ignored; GET on this path 405s, only
//     POST is allowed, confirmed via OPTIONS). Verified the sum across all campaigns for a
//     workspace/week exactly matches the workspace-level /api/workspaces/v1.1/stats total
//     for the same range. Classified Pathfinder vs Operating Partner by the campaign's
//     actual name (contains "pathfinder", case-insensitive) — real per-campaign truth, not
//     a guess or a snapshot-diff workaround.
//   - Meetings Booked: our `calls` table (populated live by the Calendly webhook — direct
//     from Calendly, just persisted), deduped (is_reschedule = false), classified Pathfinder
//     vs Operating Partner via a live Calendly lookup of each meeting's event_type.
//
// The sheet's Reply Rate / Interested Rate / Meeting Booked Rate / Subtotal / TOTAL cells
// are all live formulas already — we only ever write Emails Sent, Replies, Interested,
// Meetings Booked (columns C, D, F, H).

import pool from "@/lib/db";
import { batchUpdateValues, type ValueRangeUpdate } from "@/lib/google-sheets";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_LARSEN_TRACKER_ID ?? "";
const SHEET_NAME = "Weekly Tracking 2026";

// First week block in the sheet starts here; each subsequent block is a fixed 10-row unit.
const WEEK_1_START = Date.UTC(2026, 7, 3); // 2026-08-03, a Monday
const WEEK_1_HEADER_ROW = 3;
const ROWS_PER_WEEK = 10;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// Current live Calendly event types behind the two shared Larsen booking links
// (retired pre-2026-06-30 links are not tracked going forward). See
// project_larsen_dual_sender_rename memory for how these were identified.
const PATHFINDER_EVENT_TYPE_URI = "https://api.calendly.com/event_types/439c2cb3-aa44-49dc-8116-d61ad5d621b1"; // M&A Conversation | Larsen Digital
const OPERATING_PARTNER_EVENT_TYPE_URI = "https://api.calendly.com/event_types/81068b27-3b45-4695-88cc-b0b54f0cb952"; // Intro Call | Operating Partner

// Different env-var UIs mangle a pasted token differently (some preserve wrapping quotes
// literally, some add trailing whitespace). Normalize defensively — same reasoning as
// GOOGLE_SHEETS_PRIVATE_KEY in lib/google-sheets.ts. Without this, classifyMeeting() below
// gets a 401 on every single Calendly lookup and silently buckets every meeting into
// Operating Partner (confirmed as the cause of the 2026-08-17 Nicklas Pathfinder=0 bug).
function normalizeToken(raw: string): string {
  let token = raw.trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

const CALENDLY_TOKEN = normalizeToken(process.env.CALENDLY_TOKEN_LARSEN_DIGITAL ?? "");

const WORKSPACES = {
  nicklas: "larsen-digital",
  lukas: "acceler8rs",
} as const;

type Sender = keyof typeof WORKSPACES;
type CampaignBucket = "pathfinder" | "operatingPartner";

interface Metrics {
  emailsSent: number;
  replies: number;
  interested: number;
  meetings: number;
}

function emptyMetrics(): Metrics {
  return { emailsSent: 0, replies: 0, interested: 0, meetings: 0 };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Row index (1-based) of the "WEEK: ..." header for the block covering weekStart. Throws if before the sheet's first tracked week. */
function weekHeaderRow(weekStartMs: number): number {
  const n = Math.round((weekStartMs - WEEK_1_START) / MS_PER_WEEK);
  if (n < 0) throw new Error(`weekStart ${isoDate(weekStartMs)} is before the sheet's first tracked week (2026-08-03)`);
  return WEEK_1_HEADER_ROW + n * ROWS_PER_WEEK;
}

/** Monday 00:00 UTC of the week containing `d`. */
function mondayOf(d: Date): number {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday);
}

async function getWorkspaceCreds(workspaceSlug: string): Promise<{ instanceUrl: string; apiKey: string } | null> {
  const creds = await pool.query(
    "SELECT email_bison_instance_url, email_bison_api_key FROM workspaces WHERE slug = $1",
    [workspaceSlug]
  );
  const row = creds.rows[0];
  if (!row?.email_bison_api_key || !row?.email_bison_instance_url) {
    console.warn(`[larsen-weekly] no EmailBison creds for ${workspaceSlug}`);
    return null;
  }
  return { instanceUrl: row.email_bison_instance_url, apiKey: row.email_bison_api_key };
}

/** All campaigns for a workspace ({id, name} only). Paginates defensively even though every workspace fits on one page today. */
async function fetchCampaignList(instanceUrl: string, apiKey: string): Promise<{ id: number; name: string }[]> {
  const campaigns: { id: number; name: string }[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${instanceUrl}/api/campaigns?page=${page}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      console.warn(`[larsen-weekly] EmailBison campaigns list failed: ${res.status}`);
      break;
    }
    const json = await res.json();
    for (const c of json.data ?? []) campaigns.push({ id: c.id, name: c.name ?? "" });
    const lastPage = json.meta?.last_page ?? 1;
    if (page >= lastPage) break;
    page += 1;
  }
  return campaigns;
}

/** One campaign's real emails_sent/replies/interested for the given date range. */
async function fetchCampaignWeekStats(instanceUrl: string, apiKey: string, campaignId: number, startDate: string, endDate: string): Promise<{ emailsSent: number; replies: number; interested: number }> {
  const res = await fetch(`${instanceUrl}/api/campaigns/${campaignId}/stats`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });
  if (!res.ok) {
    console.warn(`[larsen-weekly] campaign ${campaignId} stats failed: ${res.status}`);
    return { emailsSent: 0, replies: 0, interested: 0 };
  }
  const data = await res.json();
  return {
    emailsSent: data?.data?.emails_sent ?? 0,
    replies: data?.data?.unique_replies_per_contact ?? 0,
    interested: data?.data?.interested ?? 0,
  };
}

/** This workspace's Pathfinder vs Operating Partner emails/replies/interested for the target week, summed from real per-campaign stats. */
async function fetchWorkspaceWeekSplit(workspaceSlug: string, weekStartMs: number, weekEndMs: number): Promise<{ pathfinder: Metrics; operatingPartner: Metrics }> {
  const pathfinder = emptyMetrics();
  const operatingPartner = emptyMetrics();
  const creds = await getWorkspaceCreds(workspaceSlug);
  if (!creds) return { pathfinder, operatingPartner };

  const startDate = isoDate(weekStartMs);
  const endDate = isoDate(weekEndMs - 24 * 60 * 60 * 1000); // inclusive end date = last day of week

  const campaigns = await fetchCampaignList(creds.instanceUrl, creds.apiKey);
  const results = await Promise.all(
    campaigns.map((c) => fetchCampaignWeekStats(creds.instanceUrl, creds.apiKey, c.id, startDate, endDate))
  );
  campaigns.forEach((c, i) => {
    const stats = results[i];
    const bucket = /pathfinder/i.test(c.name) ? pathfinder : operatingPartner;
    bucket.emailsSent += stats.emailsSent;
    bucket.replies += stats.replies;
    bucket.interested += stats.interested;
  });
  return { pathfinder, operatingPartner };
}

/** Classifies one meeting's campaign bucket via a live Calendly lookup of its event_type. */
async function classifyMeeting(calendlyEventUri: string | null): Promise<CampaignBucket> {
  if (!calendlyEventUri || !CALENDLY_TOKEN) return "operatingPartner";
  try {
    const res = await fetch(calendlyEventUri, { headers: { Authorization: `Bearer ${CALENDLY_TOKEN}` } });
    if (!res.ok) return "operatingPartner";
    const data = await res.json();
    const eventType = data?.resource?.event_type;
    if (eventType === PATHFINDER_EVENT_TYPE_URI) return "pathfinder";
    return "operatingPartner"; // includes the Operating Partner type and any unrecognized/legacy type
  } catch (e: any) {
    console.warn(`[larsen-weekly] Calendly lookup failed for ${calendlyEventUri}:`, e?.message ?? e);
    return "operatingPartner";
  }
}

async function fetchMeetingCounts(weekStartMs: number, weekEndMs: number): Promise<Record<Sender, Record<CampaignBucket, number>>> {
  const result: Record<Sender, Record<CampaignBucket, number>> = {
    nicklas: { pathfinder: 0, operatingPartner: 0 },
    lukas: { pathfinder: 0, operatingPartner: 0 },
  };
  const r = await pool.query(
    `SELECT workspace_slug, calendly_event_uri FROM calls
     WHERE workspace_slug = ANY($1) AND source = 'calendly' AND is_reschedule = FALSE
       AND created_at >= $2 AND created_at < $3`,
    [[WORKSPACES.nicklas, WORKSPACES.lukas], new Date(weekStartMs), new Date(weekEndMs)]
  );
  for (const row of r.rows) {
    const sender: Sender = row.workspace_slug === WORKSPACES.lukas ? "lukas" : "nicklas";
    const bucket = await classifyMeeting(row.calendly_event_uri);
    result[sender][bucket] += 1;
  }
  return result;
}

/**
 * Computes and writes the Larsen weekly tracker for the given week (defaults to the week
 * that just ended, i.e. last Monday-Sunday relative to now). Safe to re-run for the same
 * week — it overwrites the same 4 rows, no duplication.
 */
export async function runLarsenWeeklyReport(weekStart?: Date): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_LARSEN_TRACKER_ID not set");

  const thisMonday = mondayOf(weekStart ?? new Date());
  // Default target: the week that just finished (last Monday), unless an explicit
  // weekStart was passed in (used for backfills/manual runs).
  const targetWeekStart = weekStart ? mondayOf(weekStart) : thisMonday - MS_PER_WEEK;
  const targetWeekEnd = targetWeekStart + MS_PER_WEEK;

  const headerRow = weekHeaderRow(targetWeekStart);
  const rows = {
    lukasPathfinder: headerRow + 2,
    lukasOperatingPartner: headerRow + 3,
    nicklasPathfinder: headerRow + 5,
    nicklasOperatingPartner: headerRow + 6,
  };

  const [nicklasSplit, lukasSplit, meetings] = await Promise.all([
    fetchWorkspaceWeekSplit(WORKSPACES.nicklas, targetWeekStart, targetWeekEnd),
    fetchWorkspaceWeekSplit(WORKSPACES.lukas, targetWeekStart, targetWeekEnd),
    fetchMeetingCounts(targetWeekStart, targetWeekEnd),
  ]);

  const data: Record<"lukasPathfinder" | "lukasOperatingPartner" | "nicklasPathfinder" | "nicklasOperatingPartner", Metrics> = {
    lukasPathfinder: { ...lukasSplit.pathfinder, meetings: meetings.lukas.pathfinder },
    lukasOperatingPartner: { ...lukasSplit.operatingPartner, meetings: meetings.lukas.operatingPartner },
    nicklasPathfinder: { ...nicklasSplit.pathfinder, meetings: meetings.nicklas.pathfinder },
    nicklasOperatingPartner: { ...nicklasSplit.operatingPartner, meetings: meetings.nicklas.operatingPartner },
  };

  const updates: ValueRangeUpdate[] = [];
  for (const [key, rowNum] of Object.entries(rows) as [keyof typeof rows, number][]) {
    const m = data[key];
    updates.push(
      { range: `'${SHEET_NAME}'!C${rowNum}:D${rowNum}`, values: [[m.emailsSent, m.replies]] },
      { range: `'${SHEET_NAME}'!F${rowNum}`, values: [[m.interested]] },
      { range: `'${SHEET_NAME}'!H${rowNum}`, values: [[m.meetings]] }
    );
  }

  await batchUpdateValues(SPREADSHEET_ID, updates);
  console.log(`[larsen-weekly] wrote week ${isoDate(targetWeekStart)}-${isoDate(targetWeekEnd - 86400000)} to row ${headerRow}`);
}
