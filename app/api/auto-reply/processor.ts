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
import {
  INTENT_TO_PATH,
  INTENT_TO_TEMPLATE,
  renderTemplate,
  varsFromReply,
} from "@/lib/template-replies";

interface AutoReplyResult {
  action: "auto_send" | "manual" | "do_nothing";
  intent: string;
  fu_sequence_type: "full" | "abbreviated" | "none";
  reply_body?: string;
  manual_reason?: string;
  flag_unsubscribe: boolean;
  flag_meeting_booked: boolean;
  // Optional: populated when the reply is from a different person than the
  // original lead (forwarded internally, redirected via EA, etc).
  recipient_email?: string;
  recipient_name?: string;
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
  intent?: string;
  fuSequenceType?: string;
}

function buildSlackBlocks({ header, workspaceSlug, reply, instanceUrl, reason, intent, fuSequenceType }: SlackReplyCard) {
  // EmailBison's inbox URL uses the reply UUID (replies.id), not the integer reply ID.
  const ebLink = reply.id && instanceUrl
    ? `${instanceUrl}/inbox/replies/${reply.id}`
    : null;

  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");

  const metaLine = [
    intent ? `*Intent:* ${intent}` : null,
    fuSequenceType ? `*FU sequence:* ${fuSequenceType}` : null,
  ].filter(Boolean).join("  ·  ");

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
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
        text: metaLine ? `*Lead:* ${leadLine}\n${metaLine}` : `*Lead:* ${leadLine}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` },
    },
  ];

  if (reply.message) {
    const inboundPreview = quoteForSlack(reply.message, 600);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Lead's reply:*\n${inboundPreview}` },
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
      text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` },
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
  // EmailBison's inbox URL uses the reply UUID (replies.id), not the integer reply ID.
  const ebLink = reply.id && instanceUrl
    ? `${instanceUrl}/inbox/replies/${reply.id}`
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

interface ClassifyResult {
  intent: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Tier-1 classification using Haiku. Cheap (~$0.001), fast, only returns the
 * intent bucket so we can route to either the Sonnet drafter (interested
 * family) or the template engine (not-interested family) or skip entirely.
 */
async function classifyIntent(replyMessage: string, leadName: string, leadCompany: string | null): Promise<ClassifyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `Classify the inbound email reply into ONE intent. Output ONLY a JSON object, no preamble. Shape: {"intent":"...","confidence":"high"|"medium"|"low"}.

Possible intents:
- interested_urgent: explicit urgency ("call me now", "let's move fast")
- interested: positive signal, open to a call ("happy to chat", "tell me more")
- needs_info: asking a clarifying question, wants details before committing
- neutral: vague, no clear signal either way
- forwarded: someone other than the original lead is replying (forwarded internally, EA, colleague), OR the lead is redirecting us to someone else with their email or name
- not_interested: soft no with timing language ("not right now", "happy as is", "too busy", "bad timing")
- hard_no: definite disinterest ("we never sell", "sold last year", "family business not for sale ever")
- unsubscribe: explicit removal request ("remove me", "unsubscribe", "stop", "do not contact")
- wrong_target: wrong person/company, no useful redirect ("I'm not the owner", "we are a nonprofit", "wrong sector")
- out_of_office: vacation reply, will return on date
- bounce: delivery failure notification
- spam: clearly automated or unrelated
- nothing_to_address: thanks/acknowledgment with nothing to act on

Read the reply text, output the single most accurate intent. Be decisive, prefer high or medium confidence.`;

  const userMessage = `Lead name: ${leadName}
Lead company: ${leadCompany ?? "unknown"}

Reply text:
${replyMessage}

Classify now.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    console.error("[auto-reply] Haiku classify error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
  // Tolerant parse: extract first {...}.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    console.error("[auto-reply] classify: no JSON in response:", raw.slice(0, 200));
    return null;
  }
  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as ClassifyResult;
  } catch {
    console.error("[auto-reply] classify: JSON parse failed:", raw.slice(0, 200));
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

  // Recipient resolution: prefer the override set by the auto-reply (when a
  // forward/redirect was detected and Claude returned a different email),
  // otherwise fall back to the lead's email. Never use reply.to_email,
  // that is OUR sender address from the EmailBison webhook.
  const recipientEmail = reply.preferred_recipient_email ?? reply.lead_email;
  const recipientName = reply.preferred_recipient_name ?? reply.lead_name ?? null;
  const toEmails = [{
    name: recipientName,
    email_address: recipientEmail,
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

const FORWARDING_INTENTS = new Set(["interested", "interested_urgent", "needs_info"]);

/**
 * Forward an interested-family reply to the client's chosen email via EmailBison.
 * Reuses the existing /replies/{id}/reply endpoint with `to_emails` overridden
 * to the forwarding address, and `inject_previous_email_body: true` so the
 * client receives the full thread along with our short FYI note.
 */
async function forwardReplyToClient(
  replyWithCreds: Record<string, any>,
  forwardTo: string,
  intent: string
): Promise<boolean> {
  const instanceUrl = replyWithCreds.email_bison_instance_url;
  const apiKey = replyWithCreds.email_bison_api_key;
  const emailBisonReplyId = replyWithCreds.email_bison_reply_id;
  const senderEmailId = replyWithCreds.sender_email_id;

  if (!instanceUrl || !apiKey || !emailBisonReplyId || !senderEmailId) {
    console.error("[auto-reply][forward] Missing EmailBison fields for reply", replyWithCreds.id);
    return false;
  }

  const ebLink = `${instanceUrl}/inbox/replies/${replyWithCreds.id}`;
  const leadLine = [replyWithCreds.lead_name, replyWithCreds.lead_company]
    .filter(Boolean)
    .join(" at ") || replyWithCreds.lead_email || "lead";
  const intentLabel = intent.replace(/_/g, " ");

  const body = `FYI, new ${intentLabel} reply from ${leadLine}.

Open in EmailBison to read the full thread and respond.

${ebLink}`;

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
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: htmlBody,
        sender_email_id: senderEmailId,
        to_emails: [{ name: null, email_address: forwardTo }],
        inject_previous_email_body: true,
        content_type: "html",
      }),
    }
  );

  if (!ebResponse.ok) {
    console.error(
      "[auto-reply][forward] EmailBison error:",
      ebResponse.status,
      await ebResponse.text()
    );
    return false;
  }
  return true;
}

export async function processAutoReply(replyId: string, workspaceSlug: string): Promise<void> {
  // Workspaces that handle their own replies entirely (no forwarding, no auto-reply).
  // Hahnbeck used to be on this list but now uses the forward_replies_to_email path.
  if (workspaceSlug === "itg-group" || workspaceSlug === "sonaro-ai") {
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

  // Fetch workspace credentials + approval mode flag + forwarding email
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode, forward_replies_to_email FROM workspaces WHERE slug = $1`,
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

  // ── TIER 1: cheap Haiku classification ────────────────────────────────────
  // Routes the reply to either the Sonnet drafter (interested/needs_info etc),
  // the template engine (not_interested/unsubscribe etc), or no-action (OOO/bounce).
  const classification = await classifyIntent(reply.message, reply.lead_name, reply.lead_company);
  if (!classification) {
    // Could not classify, reset and bail. Falling back to manual handling.
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    console.error(`[auto-reply] Tier-1 classification failed for ${replyId}`);
    return;
  }

  const path1 = INTENT_TO_PATH[classification.intent] ?? "interested";
  console.log(`[auto-reply] ${replyId} classified as ${classification.intent} (${classification.confidence}), routing to ${path1}`);

  // ── Forwarding path: workspace forwards interested replies to a chosen email ──
  // When workspace.forward_replies_to_email is set, we never auto-reply or draft for
  // this workspace. Interested-family replies get forwarded to the client; everything
  // else is logged and skipped (the client handles it themselves).
  if (workspace.forward_replies_to_email) {
    if (FORWARDING_INTENTS.has(classification.intent)) {
      const forwarded = await forwardReplyToClient(
        replyWithCreds,
        workspace.forward_replies_to_email,
        classification.intent
      );

      if (forwarded) {
        const sentId = `fwd-${replyId}-${Date.now()}`;
        await pool.query(
          `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
           VALUES ($1,$2,$3,$4,$5,'forward_to_client',$6,$7,NOW())`,
          [
            sentId,
            replyId,
            workspaceSlug,
            reply.lead_email,
            reply.lead_name,
            reply.subject ?? "",
            `[Forwarded to ${workspace.forward_replies_to_email}]`,
          ]
        );
      }

      await pool.query(
        `UPDATE replies SET status = $1, ai_analysis = $2, ai_analyzed_at = NOW() WHERE id = $3`,
        [
          forwarded ? "forwarded" : "new",
          JSON.stringify({
            intent: classification.intent,
            confidence: classification.confidence,
            forwarded_to: workspace.forward_replies_to_email,
            forward_status: forwarded ? "sent" : "failed",
          }),
          replyId,
        ]
      );
      console.log(
        `[auto-reply] ${replyId} ${forwarded ? "forwarded" : "forward FAILED"} to ${workspace.forward_replies_to_email} (intent: ${classification.intent})`
      );

      if (!forwarded) {
        // Auto-forward to the client failed (EmailBison error, missing creds, etc).
        // Surface to #manual-replies so someone can forward by hand.
        await postToSlack({
          text: `Forward failed, ${workspaceSlug} / ${reply.lead_name}`,
          blocks: buildSlackBlocks({
            header: "Forward to client failed, needs manual forward",
            workspaceSlug,
            reply: replyWithCreds,
            instanceUrl: workspace.email_bison_instance_url ?? "",
            reason: `Auto-forward to ${workspace.forward_replies_to_email} failed. Please forward manually.`,
            intent: classification.intent,
          }),
        });
      }
      return;
    }

    // Forwarding enabled but intent doesn't qualify: log only, do nothing.
    await pool.query(
      `UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [
        JSON.stringify({
          intent: classification.intent,
          confidence: classification.confidence,
          forwarding_enabled: true,
          intent_below_forward_threshold: true,
        }),
        replyId,
      ]
    );
    console.log(
      `[auto-reply] ${replyId} forwarding skipped (intent ${classification.intent} below threshold for ${workspaceSlug})`
    );
    return;
  }

  // ── No-action path: log only, no email ─────────────────────────────────────
  if (path1 === "no_action") {
    await pool.query(
      `UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [
        JSON.stringify({ intent: classification.intent, confidence: classification.confidence, auto_replied: false, no_action_reason: "low-value classification" }),
        replyId,
      ]
    );
    return;
  }

  // ── Template path: deterministic substitute, no AI body ────────────────────
  if (path1 === "template") {
    const templateName = INTENT_TO_TEMPLATE[classification.intent];
    if (!templateName) {
      console.error(`[auto-reply] No template mapped for intent ${classification.intent}, treating as no_action`);
      await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
      return;
    }
    const vars = varsFromReply(reply, workspaceSlug);
    const body = renderTemplate(templateName, vars);
    if (!body) {
      console.error(`[auto-reply] Template ${templateName} missing or empty for ${replyId}`);
      await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
      return;
    }

    const isUnsub = classification.intent === "unsubscribe" || classification.intent === "wrong_target";
    if (isUnsub) {
      // Mark lead as unsubscribed and stop any future FU sequences.
      await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
      await pool.query(
        `UPDATE follow_ups SET meeting_booked = FALSE, next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`,
        [replyId]
      );
    }

    if (workspace.auto_reply_approval_mode) {
      // Stage the templated reply in reply_drafts so the team can ✅ to send.
      const draftId = `rd-${replyId}-${Date.now()}`;
      const slackTs = await postReplyApprovalCard({
        workspaceSlug,
        reply: replyWithCreds,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        result: {
          action: "auto_send",
          intent: classification.intent,
          fu_sequence_type: "none",
          reply_body: body,
          flag_unsubscribe: isUnsub,
          flag_meeting_booked: false,
        },
      });
      await pool.query(
        `INSERT INTO reply_drafts
          (id, reply_id, workspace_slug, lead_name, lead_email, intent, action,
           fu_sequence_type, flag_unsubscribe, flag_meeting_booked, manual_reason,
           subject, body, status, slack_ts, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'auto_send','none',$7,FALSE,$8,$9,$10,'pending',$11,NOW())`,
        [
          draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email,
          classification.intent, isUnsub, `[template:${templateName}]`,
          reply.subject ?? "", body, slackTs,
        ]
      );
      await pool.query(
        `UPDATE replies SET status = 'awaiting_approval', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [
          JSON.stringify({ intent: classification.intent, template: templateName, awaiting_approval: true }),
          replyId,
        ]
      );
      console.log(`[auto-reply] Staged template draft ${draftId} (${templateName}) for approval`);
      return;
    }

    // Direct send: no approval needed for this workspace.
    const sent = await sendReplyToEmailBison(replyWithCreds, body);
    if (sent) {
      const sentId = `auto-${replyId}-${Date.now()}`;
      await pool.query(
        `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
         VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [sentId, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", body]
      );
      await pool.query(
        `UPDATE replies SET status = 'replied', interested = $1, ai_analysis = $2, ai_analyzed_at = NOW() WHERE id = $3`,
        [
          isUnsub ? false : null,
          JSON.stringify({ intent: classification.intent, template: templateName, auto_replied: true }),
          replyId,
        ]
      );
      console.log(`[auto-reply] Sent template ${templateName} to ${reply.lead_name}`);
    } else {
      await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    }
    return;
  }

  // ── Sonnet path (interested family): full draft via existing flow ──────────
  // Falls through to the Sonnet system prompt below.

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
  "flag_meeting_booked": true | false,
  "recipient_email": "OPTIONAL. Populate ONLY when the inbound reply is from a different person than the original lead (forward, redirect, EA, colleague). Set this to the email address of the person who actually wrote the reply. Read CONTEXT_Replies.md 'Recipient Detection on Redirects' for when this fires. Omit when the lead replied directly themselves.",
  "recipient_name": "OPTIONAL. The display name of the new recipient when recipient_email is populated. Omit otherwise."
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
    // If Claude detected a forward/redirect, persist the new recipient on the
    // reply so every subsequent send (Slack approve, FU drafts) routes to the
    // right person instead of the original lead.
    if (result.recipient_email) {
      await pool.query(
        `UPDATE replies
           SET preferred_recipient_email = $1,
               preferred_recipient_name = $2
         WHERE id = $3`,
        [result.recipient_email, result.recipient_name ?? null, replyId]
      );
      // Refresh the in-memory reply so the direct-send path below uses the override.
      replyWithCreds.preferred_recipient_email = result.recipient_email;
      replyWithCreds.preferred_recipient_name = result.recipient_name ?? null;
    }

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
          JSON.stringify({ intent: result.intent, auto_replied: false, awaiting_approval: true, fu_sequence_type: result.fu_sequence_type, recipient_override: result.recipient_email ?? null }),
          replyId,
        ]
      );

      console.log(`[auto-reply] Staged draft ${draftId} for approval (${workspaceSlug} / ${reply.lead_name}${result.recipient_email ? `, recipient override: ${result.recipient_email}` : ""})`);
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
        intent: result.intent,
        fuSequenceType: result.fu_sequence_type,
      }),
    });

    await createFollowUpRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);

  } else {
    // do_nothing: Sonnet decided not to auto-handle this reply. Could be a
    // forwarding workspace where the client handles replies themselves, a
    // reply too specific to template, or a context the rules say to skip.
    // Surface to #manual-replies so a human can decide what to do.
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    await postToSlack({
      text: `Manual handling needed, ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildSlackBlocks({
        header: "Reply needs manual handling",
        workspaceSlug,
        reply: replyWithCreds,
        instanceUrl: workspace.email_bison_instance_url ?? "",
        reason: result.manual_reason ?? "Auto-reply rules said do nothing here, please review and respond manually",
        intent: result.intent,
        fuSequenceType: result.fu_sequence_type,
      }),
    });
    console.log(`[auto-reply] do_nothing for ${replyId}, posted to manual-replies`);
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

  // full = 6 steps (template, Sonnet, template, Sonnet, template, Sonnet)
  // abbreviated = 2 steps (Sonnet reframe + template break-up)
  const totalEmails = fuSequenceType === "abbreviated" ? 2 : 6;
  const fuId = `fu-${replyId}-${Date.now()}`;

  await pool.query(
    `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
     SELECT $1, $2, $3, $4, $5, NOW(), 0, $6, $7, FALSE, NOW() + INTERVAL '2 days'
     WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
    [fuId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, totalEmails, fuSequenceType]
  );

  console.log(`[auto-reply] Created ${fuSequenceType} FU record for ${replyId} (${reply.lead_name})`);
}
