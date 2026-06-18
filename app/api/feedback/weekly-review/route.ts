import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  FEEDBACK_REVIEW_CHANNEL,
  postToSlack,
  slugToName,
} from "@/lib/slack-approval";
import { commitReviewPatterns } from "@/lib/apply-weekly-review";

// Client-managed workspaces whose weekly-review patterns auto-apply with NO human
// approval gate. Safe because client reviews are scope-locked to clients/<slug>.md
// and prompts/extras/<slug>.md only (never universal files), every change is a
// reversible git commit, and Lukas is notified in #feedback-review with the commit
// link so he can revert. See buildSystemPrompt's SINGLE-CLIENT scope lock.
const AUTO_APPLY_FEEDBACK_SLUGS = new Set<string>(["sonaro-ai"]);

interface DraftStats {
  total_drafts: number;
  sent: number;
  rejected: number;
  pending: number;
  with_feedback: number;
}

interface PerWsRow {
  workspace_slug: string;
  total: number;
  sent: number;
  rejected: number;
  with_feedback: number;
  evergreen_commits_today: number;
}

interface FeedbackRow {
  draft_type: string;
  draft_id: string;
  workspace_slug: string | null;
  slack_user_name: string | null;
  message_text: string;
  created_at: string;
  draft_subject?: string | null;
  draft_body?: string | null;
  lead_name?: string | null;
  intent?: string | null;
  fu_step?: number | null;
  fu_sequence_type?: string | null;
}

function readContextFile(rel: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), rel), "utf-8");
  } catch {
    return "";
  }
}

interface ReviewSummary {
  headline: string;
  patterns: {
    title: string;
    examples_count: number;
    proposed_rule_change: string;
    target_file: string;
    confidence: "high" | "medium" | "low";
  }[];
  one_off_notes: string[];
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<ReviewSummary | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!response.ok) {
    console.error("[weekly-review] Claude error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(raw) as ReviewSummary;
  } catch {
    console.error("[weekly-review] JSON parse failed:", raw);
    return null;
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

interface WeeklyReviewResult {
  ok: boolean;
  feedback_count?: number;
  patterns_found?: number;
  slack_ts?: string | null;
  client_reviews?: number;
  error?: string;
  skipped?: string;
}

type StatsFilter =
  | { mode: "all" }
  | { mode: "exclude" | "only"; slugs: string[] };

// Workspaces that review their drafts in their OWN Slack channel (set via
// workspaces.slack_approval_channel). Their feedback is routed to that channel
// instead of the company-wide #feedback-review, so client-managed workspaces
// (e.g. sonaro-ai) see and can act on their own feedback, and never pollute the
// agency triage feed. Returns slug -> channel.
async function getClientManagedChannels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const r = await pool.query<{ slug: string; slack_approval_channel: string | null }>(
      `SELECT slug, slack_approval_channel FROM workspaces WHERE slack_approval_channel IS NOT NULL`
    );
    for (const row of r.rows) {
      if (row.slack_approval_channel) map.set(row.slug, row.slack_approval_channel);
    }
  } catch (err: any) {
    // Pre-migration safety net: if the column does not exist yet, behave as
    // before (everything goes to the global channel).
    if (err?.code !== "42703") throw err;
  }
  return map;
}

// Draft stats (reply + FU) for the lookback window, optionally scoped to or away
// from a set of workspace slugs so the agency review excludes client-managed
// workspaces and each client review counts only its own drafts.
async function fetchDraftStats(since: Date, filter: StatsFilter): Promise<{ reply: DraftStats; fu: DraftStats }> {
  let clause = "created_at >= $1";
  const params: (Date | string[])[] = [since];
  if (filter.mode === "exclude") {
    clause += " AND (workspace_slug IS NULL OR workspace_slug <> ALL($2))";
    params.push(filter.slugs);
  } else if (filter.mode === "only") {
    clause += " AND workspace_slug = ANY($2)";
    params.push(filter.slugs);
  }

  const reply = await pool.query<DraftStats>(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (SELECT draft_id FROM draft_feedback WHERE draft_type = 'reply'))::int AS with_feedback
    FROM reply_drafts
    WHERE ${clause}
  `, params);

  const fu = await pool.query<DraftStats>(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (SELECT draft_id FROM draft_feedback WHERE draft_type = 'follow_up'))::int AS with_feedback
    FROM follow_up_drafts
    WHERE ${clause}
  `, params);

  return { reply: reply.rows[0], fu: fu.rows[0] };
}

// Per-workspace maturity table blocks. Shared between the agency review (all
// agency workspaces) and each client review (that workspace's single row).
function buildMaturityBlocks(perWsRows: PerWsRow[]): object[] {
  if (perWsRows.length === 0) return [];
  const lines = perWsRows.map(row => {
    const feedbackRatio = row.total > 0 ? Math.round((row.with_feedback / row.total) * 100) : 0;
    const tag = feedbackRatio === 0
      ? ":white_check_mark: clean"
      : feedbackRatio < 25
        ? ":seedling: maturing"
        : feedbackRatio < 60
          ? ":construction: training"
          : ":warning: needs work";
    return `• \`${row.workspace_slug}\` — ${row.total} replies · ${row.sent} sent · ${row.with_feedback} w/ feedback (${feedbackRatio}%) · ${row.rejected} rejected · ${row.evergreen_commits_today} rules baked ${tag}`;
  });
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Per-workspace maturity (last 24h):*\n${lines.join("\n")}\n\n_High feedback ratio = still being corrected. :white_check_mark: clean = no feedback today (positive signal). Focus your attention on :warning: needs-work workspaces._` },
    },
    { type: "divider" },
  ];
}

// Build the Claude system prompt. When clientSlug is set the review is locked to
// a single workspace: no universal escalation, target files restricted to that
// client. This mirrors the existing rule that a client can never write a
// company-wide rule from their own channel.
function buildSystemPrompt(replyContext: string, fuContext: string, clientSlug?: string): string {
  const base = `You are reviewing a week of human feedback left on AI-drafted email replies and follow-ups for Maxen Partners. Your job is to identify recurring patterns and propose concrete rule updates to the relevant context files.

Output strictly a single JSON object, no preamble, no fences. Shape:

{
  "headline": "one short sentence summarising the week (eg 'Team flagged 3 patterns, mostly around booking format and tone')",
  "patterns": [
    {
      "title": "short label, eg 'Booking format on soft-no replies'",
      "examples_count": 2,
      "proposed_rule_change": "exact text to add or modify in the target file. Include the section heading the change goes under. Be specific enough that someone could paste it directly. Limit to 80 words.",
      "target_file": "one of: CONTEXT_Replies.md, CONTEXT_FollowUps.md, SKILL_Reply-Management.md, SKILL_FollowUps.md, clients/<workspace-slug>.md (for per-client rules), prompts/extras/<workspace-slug>.md (for per-workspace processor system-prompt learnings)",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "one_off_notes": [
    "short string, used for any single-comment feedback that does not represent a pattern but is still worth flagging to the team"
  ]
}

Guidelines:
- Group feedback comments that target the same rule into one pattern.
- A "pattern" requires at least 2 examples. Single comments go in one_off_notes.
- High confidence = clear repeated rule violation across multiple drafts. Low confidence = direction is ambiguous.
- Only propose rule changes for tone, format, content, structure, or process. Do not propose product changes.
- Keep proposed rules consistent with existing rules in the context files (provided below).
- If the team's feedback contradicts an existing rule, flag it explicitly and let humans decide.
- Output 0 to 8 patterns. Quality over quantity.`;

  const scope = clientSlug
    ? `

SINGLE-CLIENT REVIEW (scope lock):
- This review covers ONLY the workspace \`${clientSlug}\`. Every pattern is workspace-specific by definition.
- Do NOT escalate anything to UNIVERSAL. Never target CONTEXT_Replies.md, CONTEXT_FollowUps.md, SKILL_Reply-Management.md, or SKILL_FollowUps.md.
- target_file must be clients/${clientSlug}.md or prompts/extras/${clientSlug}.md only.
- Prefer client files for content/copy rules. Prefer extras files for processor behavior/routing rules.`
    : `

CROSS-WORKSPACE PATTERN DETECTION (important):
- For EACH pattern you identify, first determine the scope by looking at which workspaces' feedback contributed to it.
- If the pattern is supported by feedback from a SINGLE workspace → target_file must be workspace-specific (clients/<slug>.md or prompts/extras/<slug>.md). The pattern title should include the workspace name (e.g. "Larsen Digital: open with brand-specific exit signal").
- If the pattern is supported by feedback from 2+ DIFFERENT workspaces → escalate to UNIVERSAL. target_file must be CONTEXT_Replies.md (or CONTEXT_FollowUps.md for FU patterns). The pattern title should explicitly say "UNIVERSAL:" prefix. List the contributing workspace slugs in the proposed_rule_change so Lukas can verify the cross-workspace evidence.
- Default bias: prefer workspace-specific. Escalate to universal ONLY when the same correction is being made for 2+ distinct workspaces AND the rule does not reference workspace-specific facts (industry, offer, sender persona, calendar link, etc).

Target file selection:
- UNIVERSAL pattern (cross-workspace, no client-specific facts) → CONTEXT_Replies.md (reply rules) or CONTEXT_FollowUps.md (FU rules).
- Reply skill/workflow change → SKILL_Reply-Management.md
- FU skill/workflow change → SKILL_FollowUps.md
- Rule specific to ONE client (e.g. "Larsen Digital should always do X") → clients/<workspace-slug>.md
- Processor-level instruction specific to ONE workspace (e.g. "when processing Larsen Digital replies, always do Y") → prompts/extras/<workspace-slug>.md
- Prefer client files for content/copy rules. Prefer extras files for processor behavior/routing rules.`;

  return `${base}${scope}

=== EXISTING CONTEXT_Replies.md ===
${replyContext}

=== EXISTING CONTEXT_FollowUps.md ===
${fuContext}`;
}

// Stats-only post for when a channel has no feedback to review this period.
async function postStatsOnly(opts: {
  channel: string;
  reply: DraftStats;
  fu: DraftStats;
  perWsRows: PerWsRow[];
  note: string;
}): Promise<string | null> {
  const { channel, reply: r, fu: f, perWsRows, note } = opts;
  return postToSlack({
    channel,
    text: `Weekly feedback review (no feedback this week)`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Weekly feedback review", emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Period:* last 7 days\n\n*Reply drafts:* ${r.total_drafts} total, ${r.sent} sent, ${r.rejected} rejected, ${r.pending} pending\n*FU drafts:* ${f.total_drafts} total, ${f.sent} sent, ${f.rejected} rejected, ${f.pending} pending\n\n${note}`,
        },
      },
      ...buildMaturityBlocks(perWsRows),
    ],
  });
}

// Run Claude over a set of feedback rows, build the review blocks, post to the
// given channel, and persist the summary so the ✅ auto-apply flow can read it
// back (auto-apply only fires in the global #feedback-review channel; client
// reviews are applied manually by Lukas).
async function composeAndPostReview(opts: {
  channel: string;
  title: string;
  systemPrompt: string;
  feedbackRows: FeedbackRow[];
  perWsRows: PerWsRow[];
  reply: DraftStats;
  fu: DraftStats;
}): Promise<{ ts: string | null; patterns: number; summary: ReviewSummary | null }> {
  const { channel, title, systemPrompt, feedbackRows, perWsRows, reply: r, fu: f } = opts;

  const feedbackBlock = feedbackRows.map((row, i) => {
    const meta = [
      `type: ${row.draft_type}`,
      row.workspace_slug ? `workspace: ${row.workspace_slug}` : null,
      row.lead_name ? `lead: ${row.lead_name}` : null,
      row.intent ? `intent: ${row.intent}` : null,
      row.fu_step ? `FU step: ${row.fu_step} (${row.fu_sequence_type})` : null,
      row.slack_user_name ? `from: ${row.slack_user_name}` : null,
    ].filter(Boolean).join(" · ");

    return `=== Feedback #${i + 1} (${meta}) ===
DRAFT subject: ${row.draft_subject ?? "(none)"}
DRAFT body:
${row.draft_body ?? "(none)"}

HUMAN COMMENT:
${row.message_text}`;
  }).join("\n\n---\n\n");

  const userMessage = `STATS:
- Reply drafts: ${r.total_drafts} total, ${r.sent} sent, ${r.rejected} rejected, ${r.pending} pending, ${r.with_feedback} with feedback
- FU drafts: ${f.total_drafts} total, ${f.sent} sent, ${f.rejected} rejected, ${f.pending} pending, ${f.with_feedback} with feedback

FEEDBACK COMMENTS (oldest first):

${feedbackBlock}

Identify patterns and propose rule updates now.`;

  const summary = await callClaude(systemPrompt, userMessage);
  if (!summary) return { ts: null, patterns: 0 };

  const headerStats = `*Reply drafts:* ${r.total_drafts} total · ${r.sent} sent · ${r.rejected} rejected · ${r.pending} pending\n*FU drafts:* ${f.total_drafts} total · ${f.sent} sent · ${f.rejected} rejected · ${f.pending} pending\n*Feedback comments:* ${feedbackRows.length}`;

  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: title, emoji: true } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Period:* last 7 days\n${headerStats}\n\n*Headline:* ${summary.headline}` },
    },
    { type: "divider" },
    ...buildMaturityBlocks(perWsRows),
  ];

  if (summary.patterns.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Recurring patterns and proposed rule changes:*` },
    });

    summary.patterns.forEach((p, i) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${i + 1}. ${p.title}*  (${p.examples_count} examples · *target:* ${p.target_file} · *confidence:* ${p.confidence})\n\n*Proposed rule change:*\n${p.proposed_rule_change}`,
        },
      });
      if (i < summary.patterns.length - 1) {
        blocks.push({ type: "divider" });
      }
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No recurring patterns this week. Nothing to add to the rules._" },
    });
  }

  if (summary.one_off_notes.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*One-off notes (no pattern):*\n${summary.one_off_notes.map(n => `• ${n}`).join("\n")}`,
      },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Reply in this thread with which patterns to apply. Lukas will run the markdown updates and push to production. Patterns left without a reply are dropped after the next review.",
      },
    ],
  });

  const slackTs = await postToSlack({
    channel,
    text: `${title}: ${summary.headline}`,
    blocks,
  });

  if (slackTs) {
    const reviewId = `wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO weekly_reviews (id, slack_ts, channel, summary, status)
       VALUES ($1, $2, $3, $4::jsonb, 'pending')`,
      [reviewId, slackTs, channel, JSON.stringify(summary)]
    );
  }

  return { ts: slackTs, patterns: summary.patterns.length };
}

// Exported so the in-process scheduler (instrumentation.ts) can call this
// directly without going through HTTP. `dedupeWindow=true` skips the run if
// a weekly_reviews row was inserted within the last 23 hours.
// TEMPORARY (set 2026-05-28): 23h dedupe + 24h lookback (was 6 days dedupe +
// 7 days lookback) to give Lukas a daily review of the previous 24h of
// replies and feedback while we validate the new Larsen rules. Revert to
// 6 days dedupe + 7 days lookback (sevenDaysAgo) once the cadence catches
// what we want.
export async function runWeeklyFeedbackReviewOnce(opts: { dedupeWindow?: boolean } = {}): Promise<WeeklyReviewResult> {
  if (opts.dedupeWindow) {
    const last = await pool.query(
      `SELECT created_at FROM weekly_reviews ORDER BY created_at DESC LIMIT 1`
    );
    const lastAt = last.rows[0]?.created_at as Date | undefined;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < 23 * 60 * 60 * 1000) {
      return { ok: true, skipped: "ran within last 23 hours" };
    }
  }

  // Lookback window. (Variable name kept as `sevenDaysAgo` to minimise diff;
  // the value is now 24h. Restore to 7 days when reverting to weekly cadence.)
  const sevenDaysAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Workspaces that review their drafts in their own Slack channel (e.g.
  // sonaro-ai). Their feedback is routed to that channel; everything else goes
  // to the agency-wide #feedback-review.
  const clientChannels = await getClientManagedChannels();
  const clientSlugs = [...clientChannels.keys()];
  const isClient = (slug: string | null): slug is string =>
    slug != null && clientChannels.has(slug);

  // Per-workspace maturity stats. Surfaces which workspace still needs the
  // most attention (high feedback rate = still being corrected) vs which
  // is approaching readiness (low feedback rate, clean sends).
  const perWsStats = await pool.query<PerWsRow>(`
    WITH ws_drafts AS (
      SELECT rd.workspace_slug,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE rd.status = 'sent')::int AS sent,
             COUNT(*) FILTER (WHERE rd.status = 'rejected')::int AS rejected,
             COUNT(*) FILTER (WHERE rd.id IN (
               SELECT draft_id FROM draft_feedback WHERE draft_type = 'reply' AND created_at >= $1
             ))::int AS with_feedback
      FROM reply_drafts rd
      WHERE rd.created_at >= $1
      GROUP BY rd.workspace_slug
    ),
    ws_commits AS (
      SELECT (summary->'patterns'->0->>'target_file') AS target_file,
             COUNT(*)::int AS applied_count
      FROM weekly_reviews
      WHERE applied_at >= $1
        AND status = 'applied'
      GROUP BY target_file
    )
    SELECT d.workspace_slug, d.total, d.sent, d.rejected, d.with_feedback,
           COALESCE((
             SELECT SUM(c.applied_count)::int FROM ws_commits c
             WHERE c.target_file LIKE '%/' || d.workspace_slug || '.md'
                OR c.target_file LIKE 'clients/' || d.workspace_slug || '.md'
                OR c.target_file LIKE 'prompts/extras/' || d.workspace_slug || '.md'
           ), 0) AS evergreen_commits_today
    FROM ws_drafts d
    ORDER BY d.total DESC, d.with_feedback DESC
  `, [sevenDaysAgo]);

  // Pull every feedback comment from the past 7 days, joined with the draft it was attached to.
  const feedbackResult = await pool.query<FeedbackRow>(`
    SELECT
      df.draft_type, df.draft_id, df.workspace_slug, df.slack_user_name,
      df.message_text, df.created_at,
      COALESCE(rd.subject, fud.subject) AS draft_subject,
      COALESCE(rd.body, fud.body) AS draft_body,
      COALESCE(rd.lead_name, fud.lead_name) AS lead_name,
      rd.intent,
      fud.fu_step,
      fu.fu_sequence_type
    FROM draft_feedback df
    LEFT JOIN reply_drafts rd ON df.draft_type = 'reply' AND rd.id = df.draft_id
    LEFT JOIN follow_up_drafts fud ON df.draft_type = 'follow_up' AND fud.id = df.draft_id
    LEFT JOIN follow_ups fu ON fud.follow_up_id = fu.id
    WHERE df.created_at >= $1
    ORDER BY df.created_at ASC
  `, [sevenDaysAgo]);

  // Agency-managed draft stats (exclude client-managed workspaces) and the
  // agency slice of the maturity table.
  const agencyStatsFilter: StatsFilter = clientSlugs.length
    ? { mode: "exclude", slugs: clientSlugs }
    : { mode: "all" };
  const agencyStats = await fetchDraftStats(sevenDaysAgo, agencyStatsFilter);
  const agencyPerWs = perWsStats.rows.filter(row => !isClient(row.workspace_slug));

  // Nothing at all this week: post the agency stats-only heartbeat and stop.
  if (feedbackResult.rows.length === 0) {
    await postStatsOnly({
      channel: FEEDBACK_REVIEW_CHANNEL,
      reply: agencyStats.reply,
      fu: agencyStats.fu,
      perWsRows: agencyPerWs,
      note: "No thread feedback was left this week. Nothing to review.",
    });
    return { ok: true, feedback_count: 0 };
  }

  // Partition feedback: agency-managed (global channel) vs each client-managed
  // workspace (its own channel).
  const agencyRows = feedbackResult.rows.filter(row => !isClient(row.workspace_slug));
  const clientRowsBySlug = new Map<string, FeedbackRow[]>();
  for (const row of feedbackResult.rows) {
    if (isClient(row.workspace_slug)) {
      const arr = clientRowsBySlug.get(row.workspace_slug) ?? [];
      arr.push(row);
      clientRowsBySlug.set(row.workspace_slug, arr);
    }
  }

  // Load context files so Claude can propose targeted rule edits.
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);
  const fuContext = readContextFile(`1. Departments/follow-up-management/CONTEXT_FollowUps.md`);

  // Agency review -> global #feedback-review (the only channel where the ✅
  // auto-apply flow fires).
  let agencyTs: string | null = null;
  let agencyPatterns = 0;
  if (agencyRows.length > 0) {
    const res = await composeAndPostReview({
      channel: FEEDBACK_REVIEW_CHANNEL,
      title: "Weekly feedback review",
      systemPrompt: buildSystemPrompt(replyContext, fuContext),
      feedbackRows: agencyRows,
      perWsRows: agencyPerWs,
      reply: agencyStats.reply,
      fu: agencyStats.fu,
    });
    agencyTs = res.ts;
    agencyPatterns = res.patterns;
  } else {
    // Only client-managed workspaces had feedback. Keep Lukas's daily heartbeat
    // on the global channel but make clear the feedback was routed elsewhere.
    await postStatsOnly({
      channel: FEEDBACK_REVIEW_CHANNEL,
      reply: agencyStats.reply,
      fu: agencyStats.fu,
      perWsRows: agencyPerWs,
      note: "No feedback on agency-managed workspaces this week. Client-managed workspace feedback was routed to their own channels.",
    });
  }

  // One scoped, single-workspace review per client-managed workspace -> its own
  // channel. Applied manually by Lukas (auto-apply is gated to #feedback-review).
  let clientReviews = 0;
  for (const [slug, rows] of clientRowsBySlug) {
    const channel = clientChannels.get(slug)!;
    const stats = await fetchDraftStats(sevenDaysAgo, { mode: "only", slugs: [slug] });
    const res = await composeAndPostReview({
      channel,
      title: `Weekly feedback review (${slugToName(slug)})`,
      systemPrompt: buildSystemPrompt(replyContext, fuContext, slug),
      feedbackRows: rows,
      perWsRows: perWsStats.rows.filter(row => row.workspace_slug === slug),
      reply: stats.reply,
      fu: stats.fu,
    });
    if (res.ts) clientReviews++;
  }

  return {
    ok: true,
    feedback_count: feedbackResult.rows.length,
    patterns_found: agencyPatterns,
    slack_ts: agencyTs,
    client_reviews: clientReviews,
  };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runWeeklyFeedbackReviewOnce();
    if (!result.ok && result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[weekly-review] fatal:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}
