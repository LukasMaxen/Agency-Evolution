// Test script — fires a sample Slack notification with real reply data
// Usage: SLACK_BOT_TOKEN=xoxb-... node test-slack-notify.js

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error("Set SLACK_BOT_TOKEN=xoxb-... before running");
  process.exit(1);
}

const CHANNEL_ID = "C0B0MMMMNKZ"; // #manual-replies

const reply = {
  lead_name: "Mike Osmond",
  lead_email: "mike.osmond@emtech-systems.com",
  sender_email: "nick@statera-capital.com",
  campaign: "16th Apr: Sell Side Advisory",
  subject: "Re: Sell Side Advisory",
  message: "Thanks for your interest, we aren't looking for investment opportunities right now.",
  email_bison_reply_id: 220646,
};

const instanceUrl = "https://send.emailagencyevolution.com";

const ebLink = `${instanceUrl}/inbox/replies/${reply.email_bison_reply_id}`;

const fields = [
  `*Lead:*\n${reply.lead_name} ${reply.lead_email}`,
  `*Email account:*\n${reply.sender_email}`,
  `*Campaign:*\n${reply.campaign}`,
  `*Subject:*\n${reply.subject}`,
];

const workspaceSlug = "statera-capital";
const clientName = workspaceSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const blocks = [
  {
    type: "header",
    text: { type: "plain_text", text: "📅 Manual booking needed [TEST]", emoji: true },
  },
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: `*Client:* ${clientName}` }],
  },
  {
    type: "section",
    fields: fields.map(f => ({ type: "mrkdwn", text: f })),
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: `*View in EmailBison:*\n<${ebLink}|Open reply>` },
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: `*Message:*\n${reply.message}` },
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: `*Reason:*\nLead gave specific availability — needs manual booking` },
  },
];

fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    channel: CHANNEL_ID,
    text: "Manual booking needed [TEST] — statera-capital / Mike Osmond",
    blocks,
  }),
})
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      console.log("Posted to #manual-replies successfully");
    } else {
      console.error("Slack error:", data.error);
    }
  })
  .catch(e => console.error(e.message));
