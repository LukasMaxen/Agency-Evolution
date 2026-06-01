// One-shot script: query last 7 days of draft feedback from the DB and post
// a formatted summary to #weeklyfeedback (or the channel passed as first arg).
// Usage: node scripts/send-weekly-feedback.mjs [channel]
//
// Requires DATABASE_URL and SLACK_BOT_TOKEN in .env.local.
// Skips AI pattern analysis (no ANTHROPIC_API_KEY locally).

import pg from "pg";
import { readFileSync } from "fs";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([^#\s=][^=]*)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const DATABASE_URL = env.DATABASE_URL;
const SLACK_TOKEN = env.SLACK_BOT_TOKEN;
const TARGET_CHANNEL = process.argv[2] ?? "weeklyfeedback";

if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!SLACK_TOKEN)  { console.error("SLACK_BOT_TOKEN not set"); process.exit(1); }

// ── DB query ──────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: false });

const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const sinceLabel = since.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const nowLabel   = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const [replyStats, fuStats, feedbackRows] = await Promise.all([
  pool.query(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (
        SELECT draft_id FROM draft_feedback WHERE draft_type = 'reply'
      ))::int AS with_feedback
    FROM reply_drafts WHERE created_at >= $1
  `, [since]),

  pool.query(`
    SELECT
      COUNT(*)::int AS total_drafts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE id IN (
        SELECT draft_id FROM draft_feedback WHERE draft_type = 'follow_up'
      ))::int AS with_feedback
    FROM follow_up_drafts WHERE created_at >= $1
  `, [since]),

  pool.query(`
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
  `, [since]),
]);

await pool.end();

const r = replyStats.rows[0];
const f = fuStats.rows[0];
const rows = feedbackRows.rows;

// ── Build Slack blocks ────────────────────────────────────────────────────────
const periodText = `${sinceLabel} - ${nowLabel}`;
const statsText = [
  `*Reply drafts:* ${r.total_drafts} total, ${r.sent} sent, ${r.rejected} rejected, ${r.pending} pending, ${r.with_feedback} with feedback`,
  `*FU drafts:* ${f.total_drafts} total, ${f.sent} sent, ${f.rejected} rejected, ${f.pending} pending, ${f.with_feedback} with feedback`,
  `*Feedback comments:* ${rows.length}`,
].join("\n");

const blocks = [
  {
    type: "header",
    text: { type: "plain_text", text: "Weekly feedback review", emoji: true },
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: `*Period:* ${periodText}\n\n${statsText}` },
  },
];

if (rows.length === 0) {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "_No feedback comments this week. Nothing to review._" },
  });
} else {
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*All feedback comments (${rows.length}):*` },
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const meta = [
      row.draft_type === "follow_up" ? "FU" : "Reply",
      row.workspace_slug ?? null,
      row.lead_name ? `lead: ${row.lead_name}` : null,
      row.intent ? `intent: ${row.intent}` : null,
      row.fu_step != null ? `step ${row.fu_step}` : null,
      row.slack_user_name ? `by ${row.slack_user_name}` : null,
    ].filter(Boolean).join(" · ");

    const dateStr = new Date(row.created_at).toLocaleDateString("en-GB", {
      day: "numeric", month: "short",
    });

    // Truncate long draft body for readability
    const body = (row.draft_body ?? "").slice(0, 400) + ((row.draft_body ?? "").length > 400 ? "..." : "");
    const subject = row.draft_subject ? `*Subject:* ${row.draft_subject}\n` : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*#${i + 1} — ${meta}* (${dateStr})\n${subject}\`\`\`${body}\`\`\`\n*Feedback:* ${row.message_text}`,
      },
    });

    if (i < rows.length - 1) {
      blocks.push({ type: "divider" });
    }
  }
}

blocks.push({ type: "divider" });
blocks.push({
  type: "context",
  elements: [
    {
      type: "mrkdwn",
      text: "_Sent manually via send-weekly-feedback.mjs. AI pattern analysis not included (no API key locally)._",
    },
  ],
});

// ── Post to Slack ─────────────────────────────────────────────────────────────
const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SLACK_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    channel: TARGET_CHANNEL,
    text: `Weekly feedback review: ${rows.length} feedback comments, ${sinceLabel} - ${nowLabel}`,
    blocks,
  }),
});

const slackData = await slackRes.json();

if (slackData.ok) {
  console.log(`Posted to #${TARGET_CHANNEL} (ts: ${slackData.ts})`);
  console.log(`Stats: ${r.total_drafts} reply drafts, ${f.total_drafts} FU drafts, ${rows.length} feedback comments`);
} else {
  console.error("Slack error:", slackData.error);
  if (slackData.error === "channel_not_found") {
    console.error(`Channel "${TARGET_CHANNEL}" not found or bot is not a member.`);
    console.error("Invite the bot to the channel first: /invite @<bot-name> in Slack.");
  }
  process.exit(1);
}
