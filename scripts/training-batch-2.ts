/**
 * Training batch 2: 4 hand-drafted interested-family cards.
 * - John, wrobel-capital ("Steve make an offer?")
 * - Mike, act-capital (tequila mandate, wants NDA + data room)
 * - Richard, statera-capital (meeting already set with Derrick for Monday)
 * - Jamal, acceler8rs (asked for calendar invite)
 *
 * Run with: npx tsx scripts/training-batch-2.ts
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
  intent: "interested" | "interested_urgent" | "needs_info";
  fu_sequence_type: "full" | "abbreviated" | "none";
  body: string;
}

const drafts: DraftItem[] = [
  {
    // John, wrobel-capital. "Steve make an offer?"
    reply_id: "a1adc341-59b2-4ab7-8061-c453a50ee2c8",
    intent: "needs_info",
    fu_sequence_type: "full",
    body: `Hi John,

Appreciate the direct reply. Putting a number on it in writing without a conversation first would not do Paragon justice. The point of a 30 minute call is to walk through what structure makes sense and get to a credible range. A full sale, partial sale, or rollover are all on the table.

Are either of these times good, Tue 10am CT or Wed 2pm CT? Or grab a slot directly https://calendly.com/swrobel-wrobelcap/30min

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    // Mike Solow, act-capital. Tequila acquisition, wants NDA + data room directly.
    reply_id: "a1ad9a8b-286d-446b-949d-a77a7535b25b",
    intent: "interested_urgent",
    fu_sequence_type: "full",
    body: `Hi Mike,

Understood. The NDA lives inside the teaser page so the link is the way to give you access. Once it is signed, the data room follows.

Here is the page, https://www.actcapitaladvisors.com/open-deals/high-growth-premium-tequila-company/

Happy to jump on a quick call to walk through everything in parallel. You can grab a time, https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    // Richard (signed) at HSP Valves, statera-capital. Meeting already set for Monday with Derrick.
    reply_id: "a1aa5eff-29e3-4493-bea3-c2b664d9742c",
    intent: "interested_urgent",
    fu_sequence_type: "full",
    body: `Hi Richard,

Got it, thanks for setting that up. Looking forward to speaking with you and Derrick on Monday.

If anything shifts on your side or there is anything useful I can share ahead of the call, I will be in touch.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    // Jamal, acceler8rs. Asked for calendar invite.
    reply_id: "a1a94eb4-3f5a-4e4f-b533-5b81ff485b48",
    intent: "interested_urgent",
    fu_sequence_type: "full",
    body: `Hi Jamal,

Great, glad we can sync. Are either of these times good, Tue 10am UK or Wed 3pm UK? Or grab a slot directly https://calendly.com/lukasm-acceler8rs/intro-meeting

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
    console.error(`[batch2] reply ${draft.reply_id} not found`);
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
    console.error(`[batch2] failed to post for reply ${draft.reply_id}`);
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
      "[training:batch-2]",
      reply.subject ?? "",
      draft.body,
      slackTs,
    ]
  );

  await pool.query(
    `UPDATE replies SET status = 'awaiting_approval' WHERE id = $1`,
    [draft.reply_id]
  );

  console.log(`[batch2] posted ${reply.workspace_slug} / ${reply.lead_name}, slack_ts=${slackTs}`);
}

async function main() {
  for (const d of drafts) {
    await postOne(d);
    await new Promise(r => setTimeout(r, 5000));
  }
  await pool.end();
}

main().catch(err => {
  console.error("[batch2] failed:", err);
  process.exit(1);
});
