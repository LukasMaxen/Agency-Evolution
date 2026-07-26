/**
 * Fix the 3 incorrectly drafted cards from training-batch-1: Sonia, Mike, Tasha.
 * They were bespoke-drafted but should have used template-path bodies.
 *
 * - Sonia: French hand-translation of soft-no-acknowledgment template
 * - Mike, Tasha: reclassified hard_no, hard-no-acknowledgment template
 *
 * Pushes chat.update to Slack and updates reply_drafts.body / intent / manual_reason.
 * Run with: npx tsx scripts/fix-batch-1.ts
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { Pool } from "pg";
import {
  REPLY_APPROVAL_CHANNEL,
  approvalFooterBlock,
  quoteForSlack,
  slugToName,
} from "../lib/slack-approval";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

interface FixItem {
  reply_id: string;
  intent: "not_interested" | "hard_no";
  manual_reason: string;
  body: string;
}

const fixes: FixItem[] = [
  {
    // Sonia, gn-motion. Soft-no, French hand-translation of soft-no-acknowledgment template.
    reply_id: "a1b1011f-8198-4c59-b19d-1b32d92c3e48",
    intent: "not_interested",
    manual_reason: "[template-translated:soft-no-acknowledgment+fr]",
    body: `Bonjour Sonia,

C'est noté, pas de souci. Si la situation évolue à l'avenir, n'hésitez pas à reprendre contact.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    // Mike, zebs-ibs. Reclassify to hard_no, hard-no-acknowledgment template.
    reply_id: "a1b0ec6c-b625-427c-84e1-e9ba5ef8273b",
    intent: "hard_no",
    manual_reason: "[template:hard-no-acknowledgment]",
    body: `Hi Mike,

Got it, thanks for letting me know. Best of luck with everything.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    // Tasha, zebs-ibs. Reclassify to hard_no, hard-no-acknowledgment template.
    reply_id: "a1afc847-3a9b-4227-8d55-f6d9bbf7c01f",
    intent: "hard_no",
    manual_reason: "[template:hard-no-acknowledgment]",
    body: `Hi Tasha,

Got it, thanks for letting me know. Best of luck with everything.

{SENDER_EMAIL_SIGNATURE}`,
  },
];

async function chatUpdate(channel: string, ts: string, blocks: object[], text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("[fix] SLACK_BOT_TOKEN not set");
    return false;
  }
  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, ts, blocks, text }),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok) console.error("[fix] chat.update failed:", data.error);
  return data.ok === true;
}

async function fixOne(fix: FixItem): Promise<void> {
  const draftRes = await pool.query(
    `SELECT rd.*, r.workspace_slug AS rs_workspace_slug, r.lead_name AS rs_lead_name,
            r.lead_email AS rs_lead_email, r.subject AS rs_subject, r.message AS rs_message,
            r.campaign AS rs_campaign, r.id AS rs_reply_id,
            w.email_bison_instance_url
     FROM reply_drafts rd
     JOIN replies r ON r.id = rd.reply_id
     JOIN workspaces w ON w.slug = rd.workspace_slug
     WHERE rd.reply_id = $1 AND rd.status = 'pending'
     ORDER BY rd.created_at DESC LIMIT 1`,
    [fix.reply_id]
  );
  const row = draftRes.rows[0];
  if (!row) {
    console.error(`[fix] no pending draft for ${fix.reply_id}`);
    return;
  }

  const slackTs = row.slack_ts as string;
  if (!slackTs) {
    console.error(`[fix] no slack_ts for draft ${row.id}`);
    return;
  }

  const instanceUrl = row.email_bison_instance_url ?? "https://send.emailagencyevolution.com";
  const ebLink = `${instanceUrl}/inbox/replies/${row.rs_reply_id}`;
  const leadLine = [row.rs_lead_name, row.rs_lead_email].filter(Boolean).join(", ");
  const inboundPreview = quoteForSlack(row.rs_message ?? "", 600);
  const draftQuoted = quoteForSlack(fix.body, 2500);

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Auto-reply draft, needs review", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToName(row.rs_workspace_slug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${row.rs_campaign ?? "unknown"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Intent:* ${fix.intent}  ·  *FU sequence:* none`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${row.rs_subject ?? "(no subject)"}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted first response:*\n${draftQuoted}` } },
    { type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` } },
    approvalFooterBlock(),
  ];

  const updated = await chatUpdate(
    REPLY_APPROVAL_CHANNEL,
    slackTs,
    blocks,
    `Auto-reply draft, ${row.rs_workspace_slug}, ${row.rs_lead_name}`
  );
  if (!updated) {
    console.error(`[fix] chat.update failed for ${row.id}, skipping DB update`);
    return;
  }

  await pool.query(
    `UPDATE reply_drafts
       SET body = $1, intent = $2, manual_reason = $3
     WHERE id = $4`,
    [fix.body, fix.intent, fix.manual_reason, row.id]
  );

  console.log(`[fix] updated ${row.rs_workspace_slug} / ${row.rs_lead_name} -> ${fix.intent} / ${fix.manual_reason}`);
}

async function main() {
  for (const f of fixes) {
    await fixOne(f);
    await new Promise(r => setTimeout(r, 500));
  }
  await pool.end();
}

main().catch(err => {
  console.error("[fix] failed:", err);
  process.exit(1);
});
