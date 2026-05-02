import pool from "@/lib/db";
import fs from "fs";
import path from "path";

interface AutoReplyResult {
  action: "auto_send" | "manual" | "do_nothing";
  intent: string;
  reply_body?: string;
  manual_reason?: string;
  flag_unsubscribe: boolean;
  flag_meeting_booked: boolean;
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

interface SlackReplyCard {
  header: string;
  workspaceSlug: string;
  reply: Record<string, any>;
  instanceUrl: string;
  reason?: string;
}

function slugToName(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function buildSlackBlocks({ header, workspaceSlug, reply, instanceUrl, reason }: SlackReplyCard) {
  const ebLink = reply.email_bison_reply_id
    ? `${instanceUrl}/inbox/replies/${reply.email_bison_reply_id}`
    : null;

  const fields = [
    `*Lead:*\n${reply.lead_name ? `${reply.lead_name} ` : ""}${reply.lead_email ?? ""}`,
    `*Email account:*\n${reply.sender_email ?? ""}`,
    `*Campaign:*\n${reply.campaign ?? ""}`,
    `*Subject:*\n${reply.subject ?? ""}`,
  ];

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Client:* ${slugToName(workspaceSlug)}` }],
    },
    {
      type: "section",
      fields: fields.map(f => ({ type: "mrkdwn", text: f })),
    },
  ];

  if (ebLink) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*View in EmailBison:*\n<${ebLink}|Open reply>` },
    });
  }

  if (reply.message) {
    const preview = reply.message.slice(0, 300) + (reply.message.length > 300 ? "..." : "");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Message:*\n${preview}` },
    });
  }

  if (reason) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Reason:*\n${reason}` },
    });
  }

  return blocks;
}

async function postToSlack(payload: string | { blocks: object[]; text: string }): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[auto-reply] SLACK_BOT_TOKEN not set — skipping Slack notification");
    return;
  }
  // #manual-replies channel
  const channelId = "C0B0MMMMNKZ";
  const body = typeof payload === "string"
    ? { channel: channelId, text: payload }
    : { channel: channelId, ...payload };
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<AutoReplyResult | null> {
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
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    console.error("[auto-reply] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean) as AutoReplyResult;
  } catch {
    console.error("[auto-reply] Failed to parse Claude response:", raw);
    return null;
  }
}

async function sendReplyToEmailBison(
  reply: Record<string, any>,
  body: string
): Promise<boolean> {
  const instanceUrl = reply.email_bison_instance_url;
  const apiKey = reply.email_bison_api_key;
  const emailBisonReplyId = reply.email_bison_reply_id;
  const senderEmailId = reply.sender_email_id;

  if (!instanceUrl || !apiKey || !emailBisonReplyId || !senderEmailId) {
    console.error("[auto-reply] Missing EmailBison fields for reply", reply.id);
    return false;
  }

  const toEmails = [{
    name: reply.lead_name ?? null,
    email_address: reply.to_email ?? reply.lead_email,
  }];

  const linkify = (text: string) =>
    text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

  const htmlBody = body
    .split("\n\n")
    .map(para => `<p style="margin:0 0 16px 0;">${linkify(para.replace(/\n/g, "<br>"))}</p>`)
    .join("");

  const ebResponse = await fetch(
    `${instanceUrl}/api/replies/${emailBisonReplyId}/reply`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        message: htmlBody,
        sender_email_id: senderEmailId,
        to_emails: toEmails,
        inject_previous_email_body: true,
        content_type: "html",
      }),
    }
  );

  if (!ebResponse.ok) {
    console.error("[auto-reply] EmailBison error:", ebResponse.status, await ebResponse.text());
    return false;
  }

  return true;
}

export async function processAutoReply(replyId: string, workspaceSlug: string): Promise<void> {
  // Skip Hahnbeck, ITG Group, and Sonaro AI — client handles replies directly
  if (workspaceSlug === "hahnbeck" || workspaceSlug === "itg-group" || workspaceSlug === "sonaro-ai") {
    console.log(`[auto-reply] Skipping ${workspaceSlug} reply ${replyId}`);
    return;
  }

  // Atomic claim: only process if status is 'new'
  const claim = await pool.query(
    `UPDATE replies SET status = 'processing' WHERE id = $1 AND status = 'new' RETURNING *`,
    [replyId]
  );
  if (claim.rows.length === 0) {
    console.log(`[auto-reply] Reply ${replyId} already claimed or processed — skipping`);
    return;
  }

  const reply = claim.rows[0];

  // Fetch workspace credentials
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1`,
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) {
    console.error("[auto-reply] Workspace not found:", workspaceSlug);
    return;
  }
  const workspace = wsResult.rows[0];
  const replyWithCreds = { ...reply, ...workspace };

  // Read client file and global context
  const clientFile = readFile(path.join(process.cwd(), "clients", `${workspaceSlug}.md`));
  const contextFile = readFile(
    path.join(process.cwd(), "1. Departments", "reply-management", "CONTEXT_Replies.md")
  );

  if (!clientFile) {
    console.error("[auto-reply] Client file not found for:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  const systemPrompt = `You are an autonomous reply agent for Maxen Partners, managing cold email replies for B2B clients in M&A and business services.

Analyze the inbound lead reply and return ONLY a valid JSON object. No markdown, no explanation, no code fences.

OUTPUT FORMAT:
{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested_urgent" | "interested" | "needs_info" | "neutral" | "not_interested" | "unsubscribe",
  "reply_body": "full email body — include greeting (Hi Name,) on its own line, then a blank line, then body paragraphs each separated by blank lines, then a blank line, then {SENDER_EMAIL_SIGNATURE} on its own line. Never write Best or any name before the signature variable. Plain text. No subject line. Omit this field if action is not auto_send.",
  "manual_reason": "one short sentence on what needs human attention. Only include if action is manual.",
  "flag_unsubscribe": true | false,
  "flag_meeting_booked": true | false
}

WHEN TO USE EACH ACTION:
- "auto_send": use for ALL replies that can be handled without a human. This includes: general interest (send Calendly), teaser requests (send teaser link + Calendly), reschedule requests (send Calendly), soft declines (acknowledge cleanly in 1-2 lines), unsubscribes (confirm removal, 2 lines max). When in doubt, draft and auto-send.
- "manual": use ONLY when the lead has given a specific day/time window for a meeting that requires manually booking a calendar event, OR when they request a phone call to a specific number immediately. Do not use for general interest, objections, or ambiguity.
- "do_nothing": use for out-of-office auto-replies, delivery failure notices, or replies that are already fully handled with nothing new to address.

TONE RULES (non-negotiable):
- No em dashes (not — and not --)
- No bullet points unless answering multiple specific questions
- No phrases: "That's fantastic", "Sounds great!", "I'm excited", "I'd love to", "Thrilled", "Delighted", "Genuinely", "Straightforward"
- Match reply length to lead message — short reply gets a short email
- Closings: "Looking forward to speaking with you." or "Looking forward to it."
- Never volunteer pricing or valuation numbers unless explicitly asked
- Always include the client's Calendly link when replying to an interested lead

GLOBAL REPLY CONTEXT:
${contextFile}`;

  const userMessage = `CLIENT WORKSPACE: ${workspaceSlug}

CLIENT FILE:
${clientFile}

INBOUND LEAD REPLY:
Lead name: ${reply.lead_name}
Lead company: ${reply.lead_company ?? "unknown"}
Lead title: ${reply.lead_title ?? "unknown"}
Campaign: ${reply.campaign}
Subject: ${reply.subject}

Their message:
${reply.message}`;

  const result = await callClaude(systemPrompt, userMessage);

  if (!result) {
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    await postToSlack({
      text: `Auto-reply failed (Claude error) — ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildSlackBlocks({
        header: "⚠️ Auto-reply failed (Claude error)",
        workspaceSlug,
        reply,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        reason: "Claude API error — needs manual handling",
      }),
    });
    return;
  }

  if (result.flag_unsubscribe) {
    await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET meeting_booked = FALSE, next_fu_due = NULL WHERE reply_id = $1`, [replyId]);
  }

  if (result.flag_meeting_booked) {
    await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET meeting_booked = TRUE, next_fu_due = NULL WHERE reply_id = $1`, [replyId]);
  }

  if (result.action === "auto_send" && result.reply_body) {
    const sent = await sendReplyToEmailBison(replyWithCreds, result.reply_body);

    if (sent) {
      const sentId = `auto-${replyId}-${Date.now()}`;
      await pool.query(
        `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
         VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [sentId, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", result.reply_body]
      );
      await pool.query(
        `UPDATE replies SET status = 'replied', interested = $1, ai_analysis = $2, ai_analyzed_at = NOW() WHERE id = $3`,
        [
          ["interested", "interested_urgent", "needs_info"].includes(result.intent) ? true : null,
          JSON.stringify({ intent: result.intent, auto_replied: true }),
          replyId,
        ]
      );
      console.log(`[auto-reply] Sent reply for ${replyId} (${workspaceSlug} / ${reply.lead_name})`);
    } else {
      await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
      await postToSlack({
        text: `Auto-reply failed (EmailBison error) — ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildSlackBlocks({
          header: "⚠️ Auto-reply failed (EmailBison error)",
          workspaceSlug,
          reply: replyWithCreds,
          instanceUrl: workspace.email_bison_instance_url ?? "",
          reason: "EmailBison send error — needs manual handling",
        }),
      });
    }

  } else if (result.action === "manual") {
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    await postToSlack({
      text: `Manual booking needed — ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildSlackBlocks({
        header: "📅 Manual booking needed",
        workspaceSlug,
        reply: replyWithCreds,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        reason: result.manual_reason ?? "Needs manual handling",
      }),
    });

  } else {
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    console.log(`[auto-reply] No action needed for ${replyId}`);
  }
}
