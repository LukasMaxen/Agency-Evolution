/**
 * Training batch 1: post 4 hand-drafted reply approval cards to Slack
 * using the same format as the production auto-reply processor. Each card
 * is staged in reply_drafts so the existing reaction handler can act on it.
 *
 * Run with: npx tsx scripts/training-batch-1.ts
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { Pool } from "pg";
import {
  REPLY_APPROVAL_CHANNEL,
  postToSlack,
  approvalFooterBlock,
  quoteForSlack,
  slugToName,
} from "../lib/slack-approval";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

interface DraftItem {
  reply_id: string;
  intent: "interested" | "not_interested";
  fu_sequence_type: "full" | "none";
  body: string;
}

const drafts: DraftItem[] = [
  {
    reply_id: "a1b1011f-8198-4c59-b19d-1b32d92c3e48", // Sonia, gn-motion (French, declined)
    intent: "not_interested",
    fu_sequence_type: "none",
    body: `Bonjour Sonia,

Pas de souci, merci pour votre retour rapide. Si la situation évolue ou si un futur projet pourrait bénéficier d'un visuel CGI, n'hésitez pas à me recontacter.

Bonne continuation à vous et à toute l'équipe d'ICS Côte d'Azur.

Bien cordialement,
{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    reply_id: "a1b0ec6c-b625-427c-84e1-e9ba5ef8273b", // Mike, zebs-ibs (declined, crypto-only thesis)
    intent: "not_interested",
    fu_sequence_type: "none",
    body: `Hi Mike,

Thanks for the quick read, totally understood. Crypto isn't part of ZEBS's profile so this one is outside your thesis.

I'll keep your note on file in case anything more aligned comes across our desk.

All the best,
{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    reply_id: "a1afffa5-a359-43aa-979b-0dffce404b4f", // Ila, larsen-digital (interested, "next month")
    intent: "interested",
    fu_sequence_type: "full",
    body: `Hi Ila,

Sounds good, June works on my end. Calendar fills up fast so easiest is to grab whichever slot works for you.

https://calendly.com/larsen-digital-marketing/intro

Looking forward to chatting about your brand.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    reply_id: "a1afc847-3a9b-4227-8d55-f6d9bbf7c01f", // Tasha, zebs-ibs (declined, mandate mismatch)
    intent: "not_interested",
    fu_sequence_type: "none",
    body: `Hi Tasha,

Appreciate the clear read, thanks for getting back so quickly. Sounds like ZEBS sits outside Impact Engine's strategy so I'll close this one out cleanly.

Best of luck with the rest of the year.

{SENDER_EMAIL_SIGNATURE}`,
  },
];

async function postOne(draft: DraftItem): Promise<void> {
  const replyRes = await pool.query(
    `SELECT r.*, w.email_bison_instance_url
     FROM replies r
     LEFT JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [draft.reply_id]
  );
  const reply = replyRes.rows[0];
  if (!reply) {
    console.error(`[batch] reply ${draft.reply_id} not found, skipping`);
    return;
  }

  const instanceUrl = reply.email_bison_instance_url ?? "https://send.emailagencyevolution.com";
  const ebLink = `${instanceUrl}/inbox/replies/${reply.id}`;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");
  const inboundPreview = quoteForSlack(reply.message ?? "", 600);
  const draftQuoted = quoteForSlack(draft.body, 2500);

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Auto-reply draft, needs review", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToName(reply.workspace_slug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Intent:* ${draft.intent}  ·  *FU sequence:* ${draft.fu_sequence_type}`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted first response:*\n${draftQuoted}` } },
    { type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` } },
    approvalFooterBlock(),
  ];

  const slackTs = await postToSlack({
    channel: REPLY_APPROVAL_CHANNEL,
    text: `Auto-reply draft, ${reply.workspace_slug}, ${reply.lead_name}`,
    blocks,
  });

  if (!slackTs) {
    console.error(`[batch] failed to post for reply ${draft.reply_id}`);
    return;
  }

  const draftId = `train-${draft.reply_id}-${Date.now()}`;
  await pool.query(
    `INSERT INTO reply_drafts
       (id, reply_id, workspace_slug, lead_name, lead_email, intent, action,
        fu_sequence_type, flag_unsubscribe, flag_meeting_booked, manual_reason,
        subject, body, status, slack_ts, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'auto_send',$7,FALSE,FALSE,$8,$9,$10,'pending',$11,NOW())`,
    [
      draftId,
      draft.reply_id,
      reply.workspace_slug,
      reply.lead_name,
      reply.lead_email,
      draft.intent,
      draft.fu_sequence_type,
      "[training:batch-1]",
      reply.subject ?? "",
      draft.body,
      slackTs,
    ]
  );

  await pool.query(
    `UPDATE replies SET status = 'awaiting_approval' WHERE id = $1`,
    [draft.reply_id]
  );

  console.log(`[batch] posted ${reply.workspace_slug} / ${reply.lead_name}, slack_ts=${slackTs}`);
}

async function main() {
  for (const d of drafts) {
    await postOne(d);
    await new Promise(r => setTimeout(r, 5000)); // 5s pacing so cards arrive sequentially
  }
  await pool.end();
}

main().catch(err => {
  console.error("[batch] failed:", err);
  process.exit(1);
});
