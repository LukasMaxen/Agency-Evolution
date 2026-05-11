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
  MANUAL_INTENT_REASONS,
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

// Map workspace slugs that should read another workspace's client file.
// Avoids duplicating client context across multiple workspaces that share
// the same business (eg internal-campaigns reuses agency-evolution).
const CLIENT_FILE_ALIASES: Record<string, string> = {
  "internal-campaigns": "agency-evolution",
};

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
- neutral: vague, no clear signal either way. Do NOT use for angry or frustrated replies ("why are you still emailing me", "did you not read my last email") — those are not_interested or unsubscribe.
- forwarded: someone other than the original lead is replying (forwarded internally, EA, colleague), OR the lead is redirecting us to someone else with their email or name, OR the account is unused/inactive and the message contains a new email address to contact instead. If a redirect email address is present anywhere in the message, always classify as forwarded regardless of any OOO language.
- not_interested: soft no with timing language ("not right now", "happy as is", "too busy", "bad timing")
- hard_no: definite disinterest ("we never sell", "sold last year", "family business not for sale ever")
- unsubscribe: explicit removal request ("remove me", "unsubscribe", "stop", "do not contact")
- wrong_target: wrong person/company, no useful redirect ("I'm not the owner", "we are a nonprofit", "wrong sector")
- reschedule_request: lead has already booked or confirmed a meeting and is asking to move it ("can't make it Tuesday", "let's reschedule", "today is a bank holiday so I can't make it")
- phone_call_requested: lead asks to be called or gives a phone number ("call me", "give me a call", "call me at 720-878-9184", "my cell is X", "telephone number please", "prefer a phone call over video"). Any explicit request for a phone call, with or without a number.
- their_process_required: lead redirects us into their own intake funnel or external application process ("apply for funding here", "submit your information through our intake form")
- advisor_engaged: a third-party M&A advisor, broker, or investment bank replies on behalf of the lead, often with their own engagement language ("we have been engaged by X to assist with their exit", "I represent the seller")
- hostile: abusive, angry, or threatening language ("get out of my inbox", "stop spamming me you idiots", "this is harassment")
- out_of_office: vacation reply, will return on date. Only use this if there is NO redirect email in the message.
- bounce: delivery failure notification
- automated_notice: system-generated noise that is not marketing spam (SharePoint or Dropbox file shares, ClickUp/Asana invites, Google security alerts, anti-spam confirmation challenges like Mailinblack, "your message expired in moderation", calendar invite notifications)
- spam: marketing blasts, newsletters, or unrelated cold pitches sent TO us (not from leads)
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
 * Returns true if this reply should go to #reply-approval.
 *
 * Rule:
 *   Phase 1 (default): first 5 eligible replies each day go to approval, rest auto-send.
 *   Phase 2 (weekly recalibration): quota = 50% of 7-day rolling average of eligible
 *   replies per active weekday. Minimum quota is always 5.
 *
 * "Today" resets at midnight Eastern time so it stays consistent with EmailBison timezone.
 */
async function shouldRouteToApproval(): Promise<boolean> {
  // 7-day rolling average: count interested replies per active weekday (>=5 replies)
  // over the last 21 days. Excludes weekends naturally via the HAVING >= 5 filter.
  const avgResult = await pool.query<{ avg_per_day: string }>(`
    WITH daily AS (
      SELECT DATE(received_at AT TIME ZONE 'America/New_York') AS day,
             COUNT(*) AS cnt
      FROM replies
      WHERE interested = TRUE
        AND received_at >= NOW() - INTERVAL '21 days'
      GROUP BY 1
      HAVING COUNT(*) >= 5
      ORDER BY 1 DESC
      LIMIT 7
    )
    SELECT AVG(cnt) AS avg_per_day FROM daily
  `);
  const rawAvg = parseFloat(avgResult.rows[0]?.avg_per_day ?? "0");
  // Minimum base of 20 ensures quota never drops below 5. Once real volume data
  // exists and weekly average > 20, the 25% formula takes over.
  const avgPerDay = Math.max(20, rawAvg);
  const dailyQuota = Math.ceil(avgPerDay * 0.50);

  // Count how many have been staged for approval so far today (Eastern time).
  const todayResult = await pool.query<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt
    FROM reply_drafts
    WHERE status = 'pending'
      AND (created_at AT TIME ZONE 'America/New_York')::date
          = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  const todayApprovalCount = parseInt(todayResult.rows[0]?.cnt ?? "0", 10);

  console.log(
    `[auto-reply] approval quota: ${todayApprovalCount}/${dailyQuota} used today (7d avg ${rawAvg > 0 ? rawAvg.toFixed(1) : "no data yet"}/day)`
  );

  return todayApprovalCount < dailyQuota;
}

/**
 * Forward an interested-family reply to the client's chosen email via EmailBison.
 * Reuses the existing /replies/{id}/reply endpoint with `to_emails` overridden
 * to the forwarding address, and `inject_previous_email_body: true` so the
 * client receives the full thread along with our short FYI note.
 */
async function forwardReplyToClient(
  replyWithCreds: Record<string, any>,
  forwardTo: string,
  intent: string,
  ccEmails: string | null
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

  // Parse comma-separated CC list (per-workspace setting). Trim and drop empties.
  // EmailBison's /replies/{id}/reply endpoint silently ignores cc_emails, so we
  // send via bcc_emails instead. If they also ignore bcc_emails, we will fall
  // back to expanding into to_emails (visible to the recipient).
  const ccList = (ccEmails ?? "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean)
    .map(email_address => ({ name: null, email_address }));

  const payload: Record<string, unknown> = {
    message: htmlBody,
    sender_email_id: senderEmailId,
    to_emails: [{ name: null, email_address: forwardTo }],
    inject_previous_email_body: true,
    content_type: "html",
  };
  if (ccList.length > 0) {
    payload.bcc_emails = ccList;
  }

  const ebResponse = await fetch(
    `${instanceUrl}/api/replies/${emailBisonReplyId}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
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
  if (process.env.AUTO_REPLY_PAUSED === "true") {
    console.log(`[auto-reply] PAUSED — skipping ${replyId} (${workspaceSlug})`);
    return;
  }
  // Outer guard: any uncaught throw inside the processor (SQL drift, Anthropic
  // outage, EmailBison error, missing creds) marks the reply 'errored' so it
  // does not get re-processed in a tight loop, and surfaces a card to
  // #manual-replies. Without this, a single bug silently stalls every inbound
  // reply, like the migration-009 incident.
  try {
    await processAutoReplyImpl(replyId, workspaceSlug);
  } catch (err: any) {
    console.error(`[auto-reply] CRASH for ${replyId} (${workspaceSlug}):`, err);

    // Best-effort: mark the reply errored so retries do not pile up.
    try {
      await pool.query(`UPDATE replies SET status = 'errored' WHERE id = $1`, [replyId]);
    } catch (sqlErr) {
      console.error(`[auto-reply] Could not mark reply errored:`, sqlErr);
    }

    // Best-effort: surface to #manual-replies. Pull lead context for the card,
    // fall back to a minimal card if even that lookup fails.
    try {
      const r = await pool.query(
        `SELECT r.lead_name, r.lead_email, r.subject, r.message, r.campaign,
                w.email_bison_instance_url
         FROM replies r LEFT JOIN workspaces w ON w.slug = r.workspace_slug
         WHERE r.id = $1`,
        [replyId]
      );
      const reply = r.rows[0] ?? {};
      const errMsg = ((err?.message ?? String(err)) || "unknown error").slice(0, 500);
      await postToSlack({
        text: `Auto-reply processor crashed, ${workspaceSlug} / ${reply.lead_name ?? replyId}`,
        blocks: buildSlackBlocks({
          header: "Auto-reply processor crashed, needs investigation",
          workspaceSlug,
          reply: { id: replyId, ...reply },
          instanceUrl: reply.email_bison_instance_url ?? "",
          reason: `Error: ${errMsg}\n\nReply marked status='errored' to prevent retry loop. Once fixed, UPDATE replies SET status='new' WHERE id='${replyId}' to re-queue.`,
        }),
      });
    } catch (alertErr) {
      console.error(`[auto-reply] Crash-alert post failed:`, alertErr);
    }
  }
}

async function processAutoReplyImpl(replyId: string, workspaceSlug: string): Promise<void> {
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

  // 6-minute hold: do not process until at least 6 minutes have passed since
  // the lead replied. Releases the claim so the sweep picks it up later.
  const receivedAt = new Date(reply.received_at).getTime();
  const ageMs = Date.now() - receivedAt;
  if (ageMs < 6 * 60 * 1000) {
    const waitSec = Math.ceil((6 * 60 * 1000 - ageMs) / 1000);
    console.log(`[auto-reply] Holding ${replyId} — ${waitSec}s remaining in 6-min window`);
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  // Fetch workspace credentials + approval mode flag + forwarding email
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode, forward_replies_to_email, forward_cc_emails FROM workspaces WHERE slug = $1`,
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) {
    console.error("[auto-reply] Workspace not found:", workspaceSlug);
    return;
  }
  const workspace = wsResult.rows[0];
  const replyWithCreds = { ...reply, ...workspace };

  // Load all context: client file, all skill files, all context files.
  // Slug aliases let one client file back multiple workspaces.
  const fileSlug = CLIENT_FILE_ALIASES[workspaceSlug] ?? workspaceSlug;
  const clientFile = readFile(path.join(process.cwd(), "clients", `${fileSlug}.md`));
  const contextFile = readFile(
    path.join(process.cwd(), "1. Departments", "reply-management", "CONTEXT_Replies.md")
  );
  const skillFile = readFile(
    path.join(process.cwd(), "1. Departments", "reply-management", "SKILL_Reply-Management.md")
  );
  const fuSkillFile = readFile(
    path.join(process.cwd(), "1. Departments", "follow-up-management", "SKILL_FollowUps.md")
  );
  const fuContextFile = readFile(
    path.join(process.cwd(), "1. Departments", "follow-up-management", "CONTEXT_FollowUps.md")
  );

  if (!clientFile) {
    console.error("[auto-reply] Client file not found for:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  // ── Forwarding path: workspace forwards interested replies to a chosen email ──
  if (workspace.forward_replies_to_email) {
    // Use a lightweight intent check to decide whether to forward.
    // Only forward replies that are plausibly interested — skip OOO, bounce, spam.
    const skipKeywords = /out of office|on vacation|auto.?reply|bounce|undeliverable/i;
    const looksLikeNoAction = skipKeywords.test(reply.message ?? "");

    if (!looksLikeNoAction) {
      const forwarded = await forwardReplyToClient(
        replyWithCreds,
        workspace.forward_replies_to_email,
        "interested",
        workspace.forward_cc_emails ?? null
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
            forwarded_to: workspace.forward_replies_to_email,
            forward_status: forwarded ? "sent" : "failed",
          }),
          replyId,
        ]
      );
      console.log(`[auto-reply] ${replyId} ${forwarded ? "forwarded" : "forward FAILED"} to ${workspace.forward_replies_to_email}`);

      if (!forwarded) {
        await postToSlack({
          text: `Forward failed, ${workspaceSlug} / ${reply.lead_name}`,
          blocks: buildSlackBlocks({
            header: "Forward to client failed, needs manual forward",
            workspaceSlug,
            reply: replyWithCreds,
            instanceUrl: workspace.email_bison_instance_url ?? "",
            reason: `Auto-forward to ${workspace.forward_replies_to_email} failed. Please forward manually.`,
          }),
        });
      }
    } else {
      await pool.query(
        `UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ forwarding_enabled: true, skipped_reason: "auto-reply/OOO/bounce detected" }), replyId]
      );
      console.log(`[auto-reply] ${replyId} forwarding skipped (OOO/bounce/spam detected)`);
    }
    return;
  }

  // Intents that bypass the approval gate and auto-send directly.
  const ALWAYS_AUTO_SEND = new Set(["unsubscribe", "hard_no", "wrong_target", "hostile", "not_interested"]);

  const systemPrompt = `You are the auto-reply agent for Maxen Partners. Your job is to draft a situational first response to an inbound lead reply.

OPERATING INSTRUCTIONS:
1. Read every file provided below in full before writing a single word. They are your complete operating context.
2. SKILL_Reply-Management.md defines the reply process, intent definitions, FU sequence assignment, tone, formatting, and scenario library.
3. CONTEXT_Replies.md contains global reply rules, objection handling, formatting rules, and routing logic.
4. SKILL_FollowUps.md and CONTEXT_FollowUps.md define the follow-up sequence structure, step purposes, and FU drafting rules.
5. The CLIENT FILE is your most important input. It contains the offer, ICP, tone, reply guidelines, active mandates, teaser links, and Calendly link for this specific client.
6. The FULL THREAD HISTORY shows every email previously sent to this lead. Read it before drafting. Never repeat anything already said.
7. Draft a reply from scratch based on what the lead actually said, the full thread, and the client context. Never copy-paste anything blindly.
8. If the reply is an out-of-office, automated notice, bounce, or spam, set action to "do_nothing".
9. If you are unsure about ANYTHING — the correct intent, what to say, whether the lead is misunderstood, whether the situation is unusual — set action to "manual" with a clear reason. Never guess. When in doubt, always route to manual.

OUTPUT FORMAT:
Return a single JSON object and nothing else. Start with "{" and end with "}". No preamble, no markdown fences, no commentary.

{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested_urgent" | "interested" | "needs_info" | "neutral" | "not_interested" | "hard_no" | "unsubscribe" | "wrong_target" | "hostile",
  "fu_sequence_type": "full" | "abbreviated" | "none",
  "reply_body": "full email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. Never write 'Best' or any name before the signature variable. Omit if action is not auto_send.",
  "manual_reason": "one short sentence on what needs human attention. Only include if action is manual.",
  "flag_unsubscribe": true | false,
  "flag_meeting_booked": true | false,
  "recipient_email": "OPTIONAL. Only when a different person than the original lead wrote the reply. See Recipient Detection section in CONTEXT_Replies.md.",
  "recipient_name": "OPTIONAL. Display name when recipient_email is populated."
}

INTENT RULES:
- manual = lead gives a specific time window ("next week", "Monday") OR a phone number. Needs a human to open the calendar. NOT for angry, difficult, or ambiguous replies — draft and auto_send those.
- not_interested = soft no with timing language ("not right now", "bad timing") — abbreviated FU sequence (2 steps), auto_send a 1-line acknowledgment
- hard_no = definite close ("sold last year", "never doing M&A") — FU sequence none, auto_send a 2-line professional close
- unsubscribe = explicit removal request — FU sequence none, flag_unsubscribe true, auto_send a 1-sentence confirmation
- wrong_target = wrong person/company with no redirect — FU sequence none, flag_unsubscribe true, auto_send a brief apology
- hostile = abusive language — FU sequence none, flag_unsubscribe true, auto_send a 1-line acknowledgment

FU SEQUENCE RULES:
- interested_urgent, interested, needs_info, neutral, forwarded, advisor_engaged → full (6 steps)
- not_interested → abbreviated (2 steps)
- hard_no, unsubscribe, wrong_target, hostile → none

HARD RULE — SELL-SIDE BUYER FRAMING: Never write "a number of buyers", "multiple buyers", or any marketplace language. Always mirror the specific buyer framing from the campaign.

=== SKILL_Reply-Management.md ===
${skillFile}

=== CONTEXT_Replies.md ===
${contextFile}

=== SKILL_FollowUps.md ===
${fuSkillFile}

=== CONTEXT_FollowUps.md ===
${fuContextFile}`;

  // Fetch full thread: all emails previously sent to this lead so Sonnet
  // can read the complete correspondence before drafting.
  const threadResult = await pool.query<{ email_type: string; subject: string; body: string; sent_at: Date }>(
    `SELECT email_type, subject, body, sent_at
     FROM sent_emails
     WHERE workspace_slug = $1 AND lead_email = $2
     ORDER BY sent_at ASC`,
    [workspaceSlug, reply.lead_email]
  );
  const threadHistory = threadResult.rows.length > 0
    ? threadResult.rows.map((e, i) =>
        `--- Email ${i + 1} (${e.email_type}, ${new Date(e.sent_at).toISOString().slice(0, 10)}) ---\nSubject: ${e.subject}\n${e.body}`
      ).join("\n\n")
    : "No prior emails on record for this lead.";

  const userMessage = `CLIENT WORKSPACE: ${workspaceSlug}

CLIENT FILE:
${clientFile}

FULL THREAD HISTORY (all emails previously sent to this lead, oldest first):
${threadHistory}

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

    // Approval gate: route to #reply-approval only while today's quota (50% of
    // 7-day rolling average) is not yet filled. Once filled, auto-send directly.
    // Unsubscribes, hard nos, hostile, wrong-target, and soft-no closes never go
    // to the approval queue — they send immediately like the old template path did.
    const withinQuota = !ALWAYS_AUTO_SEND.has(result.intent)
      && workspace.auto_reply_approval_mode
      && await shouldRouteToApproval();
    if (withinQuota) {
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
      const isPositiveIntent = ["interested", "interested_urgent", "needs_info"].includes(result.intent);
      await pool.query(
        `UPDATE replies SET status = 'replied', interested = $1, ai_analysis = $2, ai_analyzed_at = NOW() WHERE id = $3`,
        [
          isPositiveIntent ? true : null,
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
    // Set status to 'awaiting_manual' (NOT 'new') so the sweeper's atomic
    // claim (which matches status='new') skips this reply on subsequent
    // ticks. Without this, every 60s sweep re-claimed the row, Sonnet
    // returned 'manual' again, and another #manual-replies card got posted.
    await pool.query(`UPDATE replies SET status = 'awaiting_manual' WHERE id = $1`, [replyId]);
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
    // do_nothing: Sonnet decided not to auto-handle this reply.
    // For clear closes (not_interested or unsubscribe with no FU), just mark read and move on.
    // Only surface to #manual-replies for ambiguous do_nothing cases that need a human eye.
    const isClearClose =
      (result.intent === "not_interested" || result.intent === "unsubscribe") &&
      result.fu_sequence_type === "none";

    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);

    if (!isClearClose) {
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
    } else {
      console.log(`[auto-reply] do_nothing for ${replyId}, clear close (intent: ${result.intent}), silently closed`);
    }
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
