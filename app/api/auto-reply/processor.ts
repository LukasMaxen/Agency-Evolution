import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  REPLY_APPROVAL_CHANNEL,
  MANUAL_REPLIES_CHANNEL,
  postToSlack as postToSlackShared,
  approvalFooterBlock,
  quoteForSlack,
  slugToName as slugToNameShared,
  sanitizeDashes,
} from "@/lib/slack-approval";

interface AutoReplyResult {
  action: "auto_send" | "manual" | "do_nothing";
  intent: string;
  fu_sequence_type: "full" | "abbreviated" | "none";
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

  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Client:* ${slugToName(workspaceSlug)}\n*Lead:* ${leadLine}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? ""}` },
        { type: "mrkdwn", text: `*Subject:*\n${reply.subject ?? ""}` },
      ],
    },
  ];

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

  if (ebLink) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*View in EmailBison:* <${ebLink}|Open reply>` },
    });
  }

  return blocks;
}

async function postToSlack(payload: { blocks: object[]; text: string }): Promise<string | null> {
  return postToSlackShared({
    channel: MANUAL_REPLIES_CHANNEL,
    text: payload.text,
    blocks: payload.blocks,
  });
}

interface ReplyApprovalCardOpts {
  workspaceSlug: string;
  reply: Record<string, any>;
  instanceUrl: string;
  result: AutoReplyResult;
}

async function postReplyApprovalCard(opts: ReplyApprovalCardOpts): Promise<string | null> {
  const { workspaceSlug, reply, instanceUrl, result } = opts;
  const ebLink = reply.email_bison_reply_id
    ? `${instanceUrl}/inbox/replies/${reply.email_bison_reply_id}`
    : null;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");
  const inboundPreview = (reply.message ?? "")
    .slice(0, 600)
    .split("\n")
    .map((l: string) => `> ${l}`)
    .join("\n");
  const draftQuoted = quoteForSlack(result.reply_body ?? "", 2500);

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Auto-reply draft, needs review`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${slugToNameShared(workspaceSlug)}` },
        { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lead:* ${leadLine}\n*Intent:* ${result.intent}  ·  *FU sequence:* ${result.fu_sequence_type}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Drafted first response:*\n${draftQuoted}` },
    },
  ];

  if (ebLink) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` },
    });
  }
  blocks.push(approvalFooterBlock());

  return postToSlackShared({
    channel: REPLY_APPROVAL_CHANNEL,
    text: `Auto-reply draft, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
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

  // Always send to the lead's email. reply.to_email is the address THE LEAD sent
  // their reply TO (our sender), not where we should reply BACK to.
  const toEmails = [{
    name: reply.lead_name ?? null,
    email_address: reply.lead_email,
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
  // Skip Hahnbeck, ITG Group, and Sonaro AI, the client handles replies directly
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
    console.log(`[auto-reply] Reply ${replyId} already claimed or processed, skipping`);
    return;
  }

  const reply = claim.rows[0];

  // Fetch workspace credentials + approval mode flag
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode FROM workspaces WHERE slug = $1`,
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

  const systemPrompt = `You are the auto-reply agent for Maxen Partners. Your only job is to classify one inbound reply and, if applicable, draft the first response.

All rules, action logic, intent definitions, FU sequence assignment, tone, formatting, scenarios, and templates live in the context file below. Read it, then classify and draft per the rules it defines.

OUTPUT FORMAT (the only thing this prompt enforces directly):
Return a single JSON object and nothing else. Start with "{" and end with "}". No preamble, no markdown fences, no commentary. The shape:

{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested_urgent" | "interested" | "needs_info" | "neutral" | "not_interested" | "unsubscribe",
  "fu_sequence_type": "full" | "abbreviated" | "none",
  "reply_body": "full email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. Never write 'Best' or any name before the signature variable. Omit this field entirely if action is not auto_send.",
  "manual_reason": "one short sentence on what needs human attention. Only include if action is manual.",
  "flag_unsubscribe": true | false,
  "flag_meeting_booked": true | false
}

The user message contains the client GTM brief and the lead's reply. Apply every rule from the context file when deciding action, intent, fu_sequence_type, and drafting reply_body.

=== CONTEXT_Replies.md ===
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
      text: `Auto-reply failed (Claude error), ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildSlackBlocks({
        header: "Auto-reply failed (Claude error)",
        workspaceSlug,
        reply,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        reason: "Claude API error, needs manual handling",
      }),
    });
    return;
  }

  // Strip any em/en dashes Claude leaked through despite the rules in CONTEXT_Replies.md.
  if (result.reply_body) {
    result.reply_body = sanitizeDashes(result.reply_body);
  }
  if (result.manual_reason) {
    result.manual_reason = sanitizeDashes(result.manual_reason);
  }

  if (result.flag_unsubscribe) {
    await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
    await pool.query(
      `UPDATE follow_ups SET meeting_booked = FALSE, next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`,
      [replyId]
    );
  }

  if (result.flag_meeting_booked) {
    await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
    await pool.query(
      `UPDATE follow_ups SET meeting_booked = TRUE, next_fu_due = NULL, outcome = 'booked' WHERE reply_id = $1`,
      [replyId]
    );
  }

  if (result.action === "auto_send" && result.reply_body) {
    // Approval gate: stage in reply_drafts and post to #reply-approval if workspace is in approval mode.
    if (workspace.auto_reply_approval_mode) {
      const draftId = `rd-${replyId}-${Date.now()}`;
      const slackTs = await postReplyApprovalCard({
        workspaceSlug,
        reply: replyWithCreds,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        result,
      });

      await pool.query(
        `INSERT INTO reply_drafts
          (id, reply_id, workspace_slug, lead_name, lead_email, intent, action,
           fu_sequence_type, flag_unsubscribe, flag_meeting_booked, manual_reason,
           subject, body, status, slack_ts, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW())`,
        [
          draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email,
          result.intent, result.action, result.fu_sequence_type,
          result.flag_unsubscribe, result.flag_meeting_booked, result.manual_reason ?? null,
          reply.subject ?? "", result.reply_body, slackTs,
        ]
      );

      await pool.query(
        `UPDATE replies SET status = 'awaiting_approval', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [
          JSON.stringify({ intent: result.intent, auto_replied: false, awaiting_approval: true, fu_sequence_type: result.fu_sequence_type }),
          replyId,
        ]
      );

      console.log(`[auto-reply] Staged draft ${draftId} for approval (${workspaceSlug} / ${reply.lead_name})`);
      return;
    }

    // Direct send path (approval mode off for this workspace)
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
          JSON.stringify({ intent: result.intent, auto_replied: true, fu_sequence_type: result.fu_sequence_type }),
          replyId,
        ]
      );

      await createFollowUpRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);

      console.log(`[auto-reply] Sent reply for ${replyId} (${workspaceSlug} / ${reply.lead_name})`);
    } else {
      await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
      await postToSlack({
        text: `Auto-reply failed (EmailBison error), ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildSlackBlocks({
          header: "Auto-reply failed (EmailBison error)",
          workspaceSlug,
          reply: replyWithCreds,
          instanceUrl: workspace.email_bison_instance_url ?? "",
          reason: "EmailBison send error, needs manual handling",
        }),
      });
    }

  } else if (result.action === "manual") {
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    await postToSlack({
      text: `Manual booking needed, ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildSlackBlocks({
        header: "Manual booking needed",
        workspaceSlug,
        reply: replyWithCreds,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        reason: result.manual_reason ?? "Needs manual handling",
      }),
    });

    await createFollowUpRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);

  } else {
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    console.log(`[auto-reply] No action needed for ${replyId}`);
  }
}

async function createFollowUpRecord(
  replyId: string,
  workspaceSlug: string,
  reply: Record<string, any>,
  fuSequenceType: "full" | "abbreviated" | "none",
  flagMeetingBooked: boolean,
  flagUnsubscribe: boolean
): Promise<void> {
  if (fuSequenceType === "none" || flagMeetingBooked || flagUnsubscribe) return;

  // full = 5 steps; abbreviated = 2 steps (FU1 reframe + FU5 break-up)
  const totalEmails = fuSequenceType === "abbreviated" ? 2 : 5;
  const fuId = `fu-${replyId}-${Date.now()}`;

  await pool.query(
    `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
     SELECT $1, $2, $3, $4, $5, NOW(), 0, $6, $7, FALSE, NOW() + INTERVAL '2 days'
     WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
    [fuId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, totalEmails, fuSequenceType]
  );

  console.log(`[auto-reply] Created ${fuSequenceType} FU record for ${replyId} (${reply.lead_name})`);
}
