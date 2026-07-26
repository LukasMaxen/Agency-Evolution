/**
 * One-off: post a demo card to each of the three Slack channels so we can
 * visually compare the harmonized layouts side by side. Run with:
 *   npx tsx scripts/demo-slack-cards.ts
 */
import { readFileSync } from "fs";

// Inline-load .env.local since this is a one-off script outside Next runtime.
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  REPLY_APPROVAL_CHANNEL,
  FU_APPROVAL_CHANNEL,
  MANUAL_REPLIES_CHANNEL,
  postToSlack,
  approvalFooterBlock,
  quoteForSlack,
  slugToName,
} from "../lib/slack-approval";

const workspaceSlug = "maxen-partners";
const reply = {
  lead_name: "Sarah Chen (DEMO)",
  lead_email: "demo@example.com",
  campaign: "MA Buyers, East Coast Industrials Q2",
  subject: "Re: thoughts on industrial acquisitions",
  message:
    "Thanks for reaching out. We are actively looking at lower middle market industrial deals in the $20M to $80M EBITDA range. What kind of deal flow do you typically see in HVAC or specialty distribution? Happy to chat next week if you have anything relevant in pipeline.",
  email_bison_reply_id: "demo-12345",
};
const instanceUrl = "https://send.emailagencyevolution.com";
const ebLink = `${instanceUrl}/inbox/replies/${reply.email_bison_reply_id}`;
const leadLine = `${reply.lead_name}, ${reply.lead_email}`;
const inboundPreview = quoteForSlack(reply.message, 600);

const DEMO_BANNER = {
  type: "context" as const,
  elements: [
    {
      type: "mrkdwn" as const,
      text: ":construction: *DEMO PREVIEW*, do not action this card. Sent to compare card layouts across the three channels.",
    },
  ],
};

async function postReplyApproval() {
  const draftBody =
    "Hi Sarah,\n\nGreat to hear back. We see steady flow in HVAC services (recurring revenue, fragmented), specialty distribution (industrial, construction, and electrical verticals), and a handful of niche manufacturers. Most are family or PE owned, $20M to $50M EBITDA, profile fits what you described.\n\nHappy to send a redacted snapshot of two current opportunities so you can gauge fit before a call. Or if you prefer, here are two slots:\n\nThu 2pm ET\nFri 10am ET\n\nOr book directly: https://calendly.com/lukas-maxen/intro\n\n{SENDER_EMAIL_SIGNATURE}";
  const draftQuoted = quoteForSlack(draftBody, 2500);

  const blocks: object[] = [
    DEMO_BANNER,
    {
      type: "header",
      text: { type: "plain_text", text: "Auto-reply draft, needs review", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToName(workspaceSlug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Intent:* interested  ·  *FU sequence:* full`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted first response:*\n${draftQuoted}` } },
    { type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` } },
    approvalFooterBlock(),
  ];

  const ts = await postToSlack({
    channel: REPLY_APPROVAL_CHANNEL,
    text: `DEMO, auto-reply draft, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
  });
  console.log("[demo] reply-approval ts:", ts);
}

async function postFuApproval() {
  const fuBody =
    "Hi Sarah,\n\nWanted to share two fits since our last note:\n\nMid-Atlantic HVAC services rollup, $32M EBITDA, 60 percent recurring service contracts.\nSpecialty electrical distributor, $24M EBITDA, family owned, 40 years operating.\n\nTwo slots if either resonates:\n\nWed 11am ET\nThu 3pm ET\n\nOr book directly: https://calendly.com/lukas-maxen/intro\n\n{SENDER_EMAIL_SIGNATURE}";
  const fuQuoted = quoteForSlack(fuBody, 2500);

  const blocks: object[] = [
    DEMO_BANNER,
    {
      type: "header",
      text: { type: "plain_text", text: "FU step 2 draft, needs review", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToName(workspaceSlug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Sequence:* full  ·  *Step:* 2/5`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* two industrial deals worth a look` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's original reply:*\n${inboundPreview}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted follow-up:*\n${fuQuoted}` } },
    { type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` } },
    approvalFooterBlock(),
  ];

  const ts = await postToSlack({
    channel: FU_APPROVAL_CHANNEL,
    text: `DEMO, FU step 2 draft, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
  });
  console.log("[demo] fu-approval ts:", ts);
}

async function postManualReplies() {
  const blocks: object[] = [
    DEMO_BANNER,
    {
      type: "header",
      text: { type: "plain_text", text: "Manual booking needed", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToName(workspaceSlug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Intent:* interested  ·  *FU sequence:* abbreviated`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reason:*\nLead asked for a Tuesday afternoon slot, manual booking needed to confirm exact time.`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` } },
  ];

  const ts = await postToSlack({
    channel: MANUAL_REPLIES_CHANNEL,
    text: `DEMO, manual booking needed, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
  });
  console.log("[demo] manual-replies ts:", ts);
}

async function main() {
  await postReplyApproval();
  await postFuApproval();
  await postManualReplies();
}

main().catch(err => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
