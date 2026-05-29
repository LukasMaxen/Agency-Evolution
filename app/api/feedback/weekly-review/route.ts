import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  FEEDBACK_REVIEW_CHANNEL,
  postToSlack,
} from "@/lib/slack-approval";

interface DraftStats {
  total_drafts: number;
  sent: number;
  rejected: number;
  pending: number;
  with_feedback: number;
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
  error?: string;
  skipped?: string;
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

  // Aggregate stats for the past 24 hours across both draft types.
  // (Variable name kept as `sevenDaysAgo` to minimise diff; the value is now
  // 24h. Restore to 7 days when reverting to weekly cadence.)
  const sevenDaysAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const replyStats = await pool.query<DraftStats>(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (SELECT draft_id FROM draft_feedback WHERE draft_type = 'reply'))::int AS with_feedback
    FROM reply_drafts
    WHERE created_at >= $1
  `, [sevenDaysAgo]);

  const fuStats = await pool.query<DraftStats>(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (SELECT draft_id FROM draft_feedback WHERE draft_type = 'follow_up'))::int AS with_feedback
    FROM follow_up_drafts
    WHERE created_at >= $1
  `, [sevenDaysAgo]);

  const r = replyStats.rows[0];
  const f = fuStats.rows[0];

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

  if (feedbackResult.rows.length === 0) {
    await postToSlack({
      channel: FEEDBACK_REVIEW_CHANNEL,
      text: `Weekly feedback review (no feedback this week)`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Weekly feedback review", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Period:* last 7 days\n\n*Reply drafts:* ${r.total_drafts} total, ${r.sent} sent, ${r.rejected} rejected, ${r.pending} pending\n*FU drafts:* ${f.total_drafts} total, ${f.sent} sent, ${f.rejected} rejected, ${f.pending} pending\n\nNo thread feedback was left this week. Nothing to review.`,
          },
        },
      ],
    });
    return { ok: true, feedback_count: 0 };
  }

  // Load context files so Claude can propose targeted rule edits.
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);
  const fuContext = readContextFile(`1. Departments/follow-up-management/CONTEXT_FollowUps.md`);

  const systemPrompt = `You are reviewing a week of human feedback left on AI-drafted email replies and follow-ups for Maxen Partners. Your job is to identify recurring patterns and propose concrete rule updates to the relevant context files.

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
- Output 0 to 5 patterns. Quality over quantity.

Target file selection:
- Generic reply tone or formatting across all clients → CONTEXT_Replies.md
- Generic follow-up rules across all clients → CONTEXT_FollowUps.md
- Reply skill/workflow change → SKILL_Reply-Management.md
- FU skill/workflow change → SKILL_FollowUps.md
- Rule specific to ONE client (e.g. "Larsen Digital should always do X") → clients/<workspace-slug>.md
- Processor-level instruction specific to ONE workspace (e.g. "when processing Larsen Digital replies, always do Y") → prompts/extras/<workspace-slug>.md
- Prefer client files for content/copy rules. Prefer extras files for processor behavior/routing rules.

=== EXISTING CONTEXT_Replies.md ===
${replyContext}

=== EXISTING CONTEXT_FollowUps.md ===
${fuContext}`;

  const feedbackBlock = feedbackResult.rows.map((row, i) => {
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

  if (!summary) {
    return { ok: false, error: "Claude error generating summary" };
  }

  // Build the Slack post
  const headerStats = `*Reply drafts:* ${r.total_drafts} total · ${r.sent} sent · ${r.rejected} rejected · ${r.pending} pending\n*FU drafts:* ${f.total_drafts} total · ${f.sent} sent · ${f.rejected} rejected · ${f.pending} pending\n*Feedback comments:* ${feedbackResult.rows.length}`;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Weekly feedback review", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Period:* last 7 days\n${headerStats}\n\n*Headline:* ${summary.headline}` },
    },
    { type: "divider" },
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
    channel: FEEDBACK_REVIEW_CHANNEL,
    text: `Weekly feedback review: ${summary.headline}`,
    blocks,
  });

  // Persist the summary so the ✅ auto-apply flow can read the patterns back.
  if (slackTs) {
    const reviewId = `wr-${Date.now()}`;
    await pool.query(
      `INSERT INTO weekly_reviews (id, slack_ts, channel, summary, status)
       VALUES ($1, $2, $3, $4::jsonb, 'pending')`,
      [reviewId, slackTs, FEEDBACK_REVIEW_CHANNEL, JSON.stringify(summary)]
    );
  }

  return {
    ok: true,
    feedback_count: feedbackResult.rows.length,
    patterns_found: summary.patterns.length,
    slack_ts: slackTs,
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
