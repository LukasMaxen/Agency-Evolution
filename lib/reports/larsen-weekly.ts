// Weekly Larsen Digital outreach tracker — fills in the "Larsen Outreach Tracking" Google
// Sheet (Weekly Tracking 2026 tab) for the week that just finished (Mon-Sun).
//
// Sources (no Make, no Slack, no Airtable in this pipeline):
//   - Emails Sent / Replies / Interested: EmailBison's per-campaign numbers (`/api/campaigns`)
//     are LIFETIME CUMULATIVE totals only — EmailBison has no per-campaign date-range stats
//     endpoint (confirmed: /api/campaigns/{id}/stats -> 405, and start_date/end_date on the
//     campaign GET are silently ignored). So we snapshot each campaign's cumulative numbers
//     every week (campaign_stat_snapshots table) and take this week's contribution as
//     (this week's snapshot - last week's snapshot), classified Pathfinder vs Operating
//     Partner by the campaign's actual name (contains "pathfinder", case-insensitive) — not
//     a guess from reply ratios. First-ever run for a campaign has no prior snapshot, so its
//     delta is reported as 0 for that one week (see fetchCampaignDeltas below); every run
//     after that is an exact diff.
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

const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN_LARSEN_DIGITAL ?? "";

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
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday);
  return monday;
}

interface CampaignCumulative {
  id: number;
  name: string;
  emailsSent: number;
  uniqueReplies: number;
  interested: number;
}

/** All campaigns for a workspace with their LIFETIME cumulative counts (EmailBison has no per-campaign date filter). Paginates defensively even though every workspace fits on one page today. */
async function fetchCampaignsCumulative(workspaceSlug: string): Promise<CampaignCumulative[]> {
  const creds = await pool.query(
    "SELECT email_bison_instance_url, email_bison_api_key FROM workspaces WHERE slug = $1",
    [workspaceSlug]
  );
  const row = creds.rows[0];
  if (!row?.email_bison_api_key || !row?.email_bison_instance_url) {
    console.warn(`[larsen-weekly] no EmailBison creds for ${workspaceSlug}`);
    return [];
  }
  const campaigns: CampaignCumulative[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${row.email_bison_instance_url}/api/campaigns?page=${page}`, {
      headers: { Authorization: `Bearer ${row.email_bison_api_key}` },
    });
    if (!res.ok) {
      console.warn(`[larsen-weekly] EmailBison campaigns list failed for ${workspaceSlug}: ${res.status}`);
      break;
    }
    const json = await res.json();
    for (const c of json.data ?? []) {
      campaigns.push({ id: c.id, name: c.name ?? "", emailsSent: c.emails_sent ?? 0, uniqueReplies: c.unique_replies ?? 0, interested: c.interested ?? 0 });
    }
    const lastPage = json.meta?.last_page ?? 1;
    if (page >= lastPage) break;
    page += 1;
  }
  return campaigns;
}

/** Most recent snapshot for this campaign taken at or before `cutoffMs`, or null if none exists yet. */
async function getPriorSnapshot(workspaceSlug: string, campaignId: number, cutoffMs: number): Promise<CampaignCumulative | null> {
  const r = await pool.query(
    `SELECT campaign_name AS name, emails_sent AS "emailsSent", unique_replies AS "uniqueReplies", interested
     FROM campaign_stat_snapshots
     WHERE workspace_slug = $1 AND campaign_id = $2 AND snapshotted_at <= $3
     ORDER BY snapshotted_at DESC LIMIT 1`,
    [workspaceSlug, campaignId, new Date(cutoffMs)]
  );
  return r.rows[0] ?? null;
}

async function saveSnapshot(workspaceSlug: string, campaigns: CampaignCumulative[], atMs: number): Promise<void> {
  for (const c of campaigns) {
    await pool.query(
      `INSERT INTO campaign_stat_snapshots (workspace_slug, campaign_id, campaign_name, emails_sent, unique_replies, interested, snapshotted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [workspaceSlug, c.id, c.name, c.emailsSent, c.uniqueReplies, c.interested, new Date(atMs)]
    );
  }
}

/**
 * This week's contribution per campaign bucket for a workspace: current cumulative minus
 * the most recent snapshot taken before the target week started. A campaign with no prior
 * snapshot (first time we've ever seen it, or first run of this whole report) contributes 0
 * for this one week — there is no way to recover its pre-tracking history from EmailBison,
 * which only exposes lifetime totals. Every subsequent week is an exact diff.
 */
async function fetchCampaignDeltas(workspaceSlug: string, weekStartMs: number): Promise<{ pathfinder: Metrics; operatingPartner: Metrics; campaigns: CampaignCumulative[] }> {
  const campaigns = await fetchCampaignsCumulative(workspaceSlug);
  const pathfinder: Metrics = emptyMetrics();
  const operatingPartner: Metrics = emptyMetrics();
  for (const c of campaigns) {
    const prior = await getPriorSnapshot(workspaceSlug, c.id, weekStartMs);
    const emailsSent = Math.max(0, c.emailsSent - (prior?.emailsSent ?? c.emailsSent));
    const replies = Math.max(0, c.uniqueReplies - (prior?.uniqueReplies ?? c.uniqueReplies));
    const interested = Math.max(0, c.interested - (prior?.interested ?? c.interested));
    const bucket = /pathfinder/i.test(c.name) ? pathfinder : operatingPartner;
    bucket.emailsSent += emailsSent;
    bucket.replies += replies;
    bucket.interested += interested;
  }
  return { pathfinder, operatingPartner, campaigns };
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

  const [nicklasDeltas, lukasDeltas, meetings] = await Promise.all([
    fetchCampaignDeltas(WORKSPACES.nicklas, targetWeekStart),
    fetchCampaignDeltas(WORKSPACES.lukas, targetWeekStart),
    fetchMeetingCounts(targetWeekStart, targetWeekEnd),
  ]);

  const data: Record<"lukasPathfinder" | "lukasOperatingPartner" | "nicklasPathfinder" | "nicklasOperatingPartner", Metrics> = {
    lukasPathfinder: { ...lukasDeltas.pathfinder, meetings: meetings.lukas.pathfinder },
    lukasOperatingPartner: { ...lukasDeltas.operatingPartner, meetings: meetings.lukas.operatingPartner },
    nicklasPathfinder: { ...nicklasDeltas.pathfinder, meetings: meetings.nicklas.pathfinder },
    nicklasOperatingPartner: { ...nicklasDeltas.operatingPartner, meetings: meetings.nicklas.operatingPartner },
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

  // Snapshot current cumulative numbers now so NEXT week's run has a baseline to diff
  // against. Timed at report-run time (Monday morning, right after the week just ended),
  // which is the correct boundary for next week's delta.
  const now = Date.now();
  await Promise.all([
    saveSnapshot(WORKSPACES.nicklas, nicklasDeltas.campaigns, now),
    saveSnapshot(WORKSPACES.lukas, lukasDeltas.campaigns, now),
  ]);

  console.log(`[larsen-weekly] wrote week ${isoDate(targetWeekStart)}-${isoDate(targetWeekEnd - 86400000)} to row ${headerRow}`);
}
