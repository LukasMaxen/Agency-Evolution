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

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutoReplyResult {
  action: "auto_send" | "manual" | "do_nothing";
  intent: string;
  fu_sequence_type: "full" | "abbreviated" | "none";
  reply_body?: string;
  manual_reason?: string;
  flag_unsubscribe: boolean;
  flag_meeting_booked: boolean;
  recipient_email?: string;
  recipient_name?: string;
}

// ─── Client file aliases ───────────────────────────────────────────────────────

const CLIENT_FILE_ALIASES: Record<string, string> = {
  "internal-campaigns": "agency-evolution",
};

// Workspaces that skip auto-reply entirely (handled externally, churned, or excluded).
const SKIP_WORKSPACES = new Set(["itg-group", "sonaro-ai", "sro-consulting"]);

// Minimum 2000 — replies load up to 8 thread messages + system prompt + client file.
// Below 2000, Claude truncates mid-reply and the 80-char body guard routes everything to manual.
const CLAUDE_MAX_TOKENS = 2500;

// ─── File helpers ──────────────────────────────────────────────────────────────

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); }
  catch { return ""; }
}

/**
 * Extracts only the ## REPLY QUICK REFERENCE section from a client file.
 * This keeps input tokens minimal — Claude gets exactly what it needs, nothing more.
 */
function extractQuickReference(clientFileContent: string): string {
  const marker = "## REPLY QUICK REFERENCE";
  const start = clientFileContent.indexOf(marker);
  if (start === -1) return clientFileContent.slice(0, 2000); // fallback: first 2000 chars

  // Find the next ## heading after the quick reference
  const rest = clientFileContent.slice(start + marker.length);
  const nextHeading = rest.search(/\n## /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return marker + section.trim();
}

// ─── Pre-filters (zero Claude cost) ───────────────────────────────────────────

/** OOO, bounces, delivery failures, automated notices. */
function isNoActionReply(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    /out of office|on vacation|away from (the )?office|annual leave|maternity leave|parental leave/.test(m) ||
    /auto.?reply|automated (response|reply)|this is an automated/.test(m) ||
    /undeliverable|delivery has failed|delivery failure|bounce|mailer.daemon|postmaster/.test(m) ||
    /do not reply to this (email|message)|please do not reply/.test(m) ||
    /message could not be delivered/.test(m)
  );
}

/** Clear opt-out / not-interested patterns.
 * unsubscribe: returns body to send (confirmation reply).
 * not_interested: returns body = "" (close silently, no reply).
 */
function detectOptOut(message: string, leadFirstName: string): { intent: string; body: string } | null {
  if (!message) return null;
  const body = message.split(/\n[-]{3,}|\nOn .+ wrote:|\n_{3,}/)[0]?.toLowerCase() ?? "";

  const unsubPatterns = [
    /\bstop (emailing|contacting|sending|following up)\b/,
    /\bdo not (contact|email|follow up|reach out)\b/,
    /\bdon.?t (contact|email|follow up|reach out)\b/,
    /remove.*(?:from|off).*list/,
    /please (unsubscribe|remove|delete|take) (me|us)/,
    /i.?d like to unsubscribe/,
    /^unsubscribe\.?\s*$/im,  // "Unsubscribe" alone on a line (explicit request, not footer link text)
    /\bopt.?out\b/,
    /take me off/,
  ];
  if (unsubPatterns.some(p => p.test(body))) {
    return {
      intent: "unsubscribe",
      body: `Hi ${leadFirstName},\n\nRemoved — you won't hear from us again.\n\n{SENDER_EMAIL_SIGNATURE}`,
    };
  }

  const niPatterns = [
    /^no[.,!]?\s*$/m, /^no thanks[.,!]?\s*$/m, /^not interested[.,!]?\s*$/m,
    /\bnot interested\b/, /\bno thanks\b/, /\bno thank you\b/,
    /\bnot for (me|us)\b/, /\bno interest\b/,
    /\bwe('re| are) not interested\b/,
  ];
  if (niPatterns.some(p => p.test(body))) {
    // Never reply to not-interested leads. Close silently.
    return { intent: "not_interested", body: "" };
  }

  return null;
}

/**
 * Scans the message for email addresses that differ from the lead on record.
 * Returns a warning string if a different sender is detected.
 */
function detectAlternateSender(message: string, leadEmail: string): string | null {
  if (!message || !leadEmail) return null;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = [...new Set((message.match(emailRegex) ?? []).map(e => e.toLowerCase()))];
  const leadNorm = leadEmail.toLowerCase();
  const others = found.filter(e =>
    e !== leadNorm &&
    !e.startsWith("noreply") && !e.startsWith("no-reply") &&
    !e.startsWith("donotreply") && !e.includes("mailer-daemon") &&
    !e.includes("postmaster")
  );
  if (others.length === 0) return null;
  // Only check the new reply body (before the quote trail). Emails that appear
  // only in the quoted section are from previous exchanges — flagging those would
  // produce false positives pointing to our own sender address or forwarded context.
  const bodyBeforeQuote = message.split(/\n[-]{3,}|\nOn .+ wrote:/)[0] ?? "";
  const inBody = others.filter(e => bodyBeforeQuote.toLowerCase().includes(e));
  if (inBody.length === 0) return null; // no alternate email in the new reply — skip
  return `RECIPIENT DETECTION: The reply contains email address(es) differing from the lead on record (${leadEmail}). Possible alternate sender(s): ${inBody.join(", ")}. Check whether to set recipient_email.`;
}

// ─── Claude API call (with prompt caching) ────────────────────────────────────

async function callClaude(systemPrompt: string, userMessage: string): Promise<AutoReplyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: CLAUDE_MAX_TOKENS,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] Claude timed out after 90s");
    else console.error("[auto-reply] Claude fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.error("[auto-reply] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();

  // Tolerant parse
  try { return JSON.parse(raw) as AutoReplyResult; }
  catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as AutoReplyResult; }
      catch { /* fall through */ }
    }
    console.error("[auto-reply] Failed to parse Claude response:", raw.slice(0, 300));
    return null;
  }
}

// ─── EmailBison send ───────────────────────────────────────────────────────────

async function sendToEmailBison(reply: Record<string, any>, body: string): Promise<boolean> {
  const { email_bison_instance_url: url, email_bison_api_key: key, email_bison_reply_id: ebId, sender_email_id: senderId } = reply;
  if (!url || !key || !ebId || !senderId) {
    console.error("[auto-reply] Missing EmailBison fields for reply", reply.id);
    return false;
  }

  const recipientEmail = reply.preferred_recipient_email ?? reply.lead_email;
  const recipientName = reply.preferred_recipient_name ?? reply.lead_name ?? null;

  const linkify = (t: string) => t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const htmlBody = body.split("\n\n")
    .map(p => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, "<br>"))}</p>`)
    .join("");

  const res = await fetch(`${url}/api/replies/${ebId}/reply`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      message: htmlBody,
      sender_email_id: senderId,
      to_emails: [{ name: recipientName, email_address: recipientEmail }],
      inject_previous_email_body: true,
      content_type: "html",
    }),
  });

  if (!res.ok) {
    console.error("[auto-reply] EmailBison error:", res.status, await res.text());
    return false;
  }
  return true;
}

// ─── Approval quota ────────────────────────────────────────────────────────────


async function shouldRouteToApproval(): Promise<boolean> {
  const avgResult = await pool.query<{ avg_per_day: string }>(`
    WITH daily AS (
      SELECT DATE(received_at AT TIME ZONE 'America/New_York') AS day, COUNT(*) AS cnt
      FROM replies
      WHERE interested = TRUE AND received_at >= NOW() - INTERVAL '21 days'
      GROUP BY 1 HAVING COUNT(*) >= 5
      ORDER BY 1 DESC LIMIT 7
    )
    SELECT AVG(cnt) AS avg_per_day FROM daily
  `);
  const rawAvg = parseFloat(avgResult.rows[0]?.avg_per_day ?? "0");
  const dailyQuota = Math.ceil(Math.max(20, rawAvg) * 0.50);

  // Count ALL drafts sent to approval today (not just still-pending ones).
  // Counting only 'pending' resets the quota each time the team reviews drafts,
  // allowing more than the intended daily limit to go to approval.
  const todayResult = await pool.query<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt FROM reply_drafts
    WHERE (created_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  return parseInt(todayResult.rows[0]?.cnt ?? "0", 10) < dailyQuota;
}

// ─── Forward to client ─────────────────────────────────────────────────────────

async function forwardToClient(reply: Record<string, any>, forwardTo: string, ccEmails: string | null): Promise<boolean> {
  const { email_bison_instance_url: url, email_bison_api_key: key, email_bison_reply_id: ebId, sender_email_id: senderId } = reply;
  if (!url || !key || !ebId || !senderId) return false;

  const ebLink = `${url}/inbox/replies/${reply.id}`;
  const leadLine = [reply.lead_name, reply.lead_company].filter(Boolean).join(" at ") || reply.lead_email;
  const body = `FYI, new interested reply from ${leadLine}.\n\nOpen in EmailBison to read the full thread and respond.\n\n${ebLink}`;
  const linkify = (t: string) => t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const htmlBody = body.split("\n\n").map(p => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, "<br>"))}</p>`).join("");

  const ccList = (ccEmails ?? "").split(",").map(e => e.trim()).filter(Boolean).map(email_address => ({ name: null, email_address }));
  const payload: Record<string, unknown> = {
    message: htmlBody, sender_email_id: senderId,
    to_emails: [{ name: null, email_address: forwardTo }],
    inject_previous_email_body: true, content_type: "html",
  };
  if (ccList.length > 0) payload.bcc_emails = ccList;

  const res = await fetch(`${url}/api/replies/${ebId}/reply`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// ─── Slack helpers ─────────────────────────────────────────────────────────────

async function postManual(payload: { blocks: object[]; text: string }): Promise<void> {
  await postToSlackShared({ channel: MANUAL_REPLIES_CHANNEL, ...payload });
}

function buildCard(header: string, workspaceSlug: string, reply: Record<string, any>, instanceUrl: string, extra?: { reason?: string; intent?: string; sendingTo?: string }): object[] {
  const ebLink = reply.id && instanceUrl ? `${instanceUrl}/inbox/replies/${reply.id}` : null;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");
  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: header, emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Client:*\n${slugToNameShared(workspaceSlug)}` },
      { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: `*Lead:* ${extra?.sendingTo ?? leadLine}${extra?.intent ? `\n*Intent:* ${extra.intent}` : ""}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` } },
  ];
  if (reply.message) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${quoteForSlack(reply.message, 600)}` } });
  }
  if (extra?.reason) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${extra.reason}` } });
  if (ebLink) blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open in EmailBison>` } });
  return blocks;
}

async function postApprovalCard(opts: {
  workspaceSlug: string; reply: Record<string, any>; instanceUrl: string; result: AutoReplyResult;
}): Promise<string | null> {
  const { workspaceSlug, reply, instanceUrl, result } = opts;
  const ebLink = reply.id && instanceUrl ? `${instanceUrl}/inbox/replies/${reply.id}` : null;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");

  const recipientOverride = result.recipient_email && result.recipient_email !== reply.lead_email;
  const sendingToLine = recipientOverride
    ? `:warning: *Sending to:* ${result.recipient_name ?? ""} <${result.recipient_email}> _(differs from lead: ${reply.lead_email})_`
    : `*Sending to:* ${leadLine}`;

  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: "Auto-reply draft, needs review", emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Client:*\n${slugToNameShared(workspaceSlug)}` },
      { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: `${sendingToLine}\n*Intent:* ${result.intent}  ·  *FU:* ${result.fu_sequence_type}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${quoteForSlack(reply.message ?? "", 600)}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted reply:*\n${quoteForSlack(result.reply_body ?? "", 2500)}` } },
  ];
  if (result.manual_reason) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `:warning: *Note:* ${result.manual_reason}` } });
  }
  if (ebLink) blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open in EmailBison>` } });
  blocks.push(approvalFooterBlock());

  return postToSlackShared({
    channel: REPLY_APPROVAL_CHANNEL,
    text: `Auto-reply draft, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
  });
}

// ─── FU record ────────────────────────────────────────────────────────────────

async function createFuRecord(replyId: string, workspaceSlug: string, reply: Record<string, any>, fuType: "full" | "abbreviated" | "none", meetingBooked: boolean, unsubscribed: boolean): Promise<void> {
  if (fuType === "none" || meetingBooked || unsubscribed) return;
  const totalEmails = fuType === "abbreviated" ? 2 : 6;
  const fuId = `fu-${replyId}-${Date.now()}`;
  await pool.query(
    `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
     SELECT $1,$2,$3,$4,$5,NOW(),0,$6,$7,FALSE,NOW() + INTERVAL '2 days'
     WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
    [fuId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, totalEmails, fuType]
  );
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function processAutoReply(replyId: string, workspaceSlug: string): Promise<void> {
  if (process.env.AUTO_REPLY_PAUSED === "true") {
    console.log(`[auto-reply] PAUSED — skipping ${replyId}`);
    return;
  }
  try {
    await processAutoReplyImpl(replyId, workspaceSlug);
  } catch (err: any) {
    console.error(`[auto-reply] CRASH for ${replyId} (${workspaceSlug}):`, err);
    try { await pool.query(`UPDATE replies SET status = 'errored' WHERE id = $1`, [replyId]); } catch { /* ignore */ }
    try {
      const r = await pool.query(`SELECT r.lead_name, r.lead_email, r.subject, r.message, r.campaign, w.email_bison_instance_url FROM replies r LEFT JOIN workspaces w ON w.slug = r.workspace_slug WHERE r.id = $1`, [replyId]);
      const reply = r.rows[0] ?? {};
      await postManual({
        text: `Auto-reply crashed, ${workspaceSlug} / ${reply.lead_name ?? replyId}`,
        blocks: buildCard("Auto-reply processor crashed", workspaceSlug, { id: replyId, ...reply }, reply.email_bison_instance_url ?? "", {
          reason: `${((err?.message ?? String(err)) || "unknown").slice(0, 400)}\n\nTo re-queue: UPDATE replies SET status='new' WHERE id='${replyId}'`,
        }),
      });
    } catch { /* ignore */ }
  }
}

async function processAutoReplyImpl(replyId: string, workspaceSlug: string): Promise<void> {
  // Skip workspaces that handle their own replies
  if (SKIP_WORKSPACES.has(workspaceSlug)) {
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1 AND status = 'new'`, [replyId]);
    return;
  }

  // Atomic claim
  const claim = await pool.query(`UPDATE replies SET status = 'processing' WHERE id = $1 AND status = 'new' RETURNING *`, [replyId]);
  if (claim.rows.length === 0) return;
  const reply = claim.rows[0];

  // 6-minute hold
  const ageMs = Date.now() - new Date(reply.received_at).getTime();
  if (ageMs < 6 * 60 * 1000) {
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  // Superseded check: if a newer reply from same lead is queued, skip this one.
  // Guard on non-empty lead_email — a null/empty email would match all empty-email replies.
  if (reply.lead_email) {
    const newer = await pool.query(
      `SELECT id FROM replies WHERE workspace_slug=$1 AND lead_email=$2 AND id!=$3 AND status='new' AND received_at>$4 LIMIT 1`,
      [workspaceSlug, reply.lead_email, replyId, reply.received_at]
    );
    if (newer.rows.length > 0) {
      await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
      return;
    }
  }

  // Workspace + credentials
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode, forward_replies_to_email, forward_cc_emails FROM workspaces WHERE slug = $1`,
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) {
    console.error("[auto-reply] Workspace not found in DB:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ skipped_reason: "workspace_not_found", workspace_slug: workspaceSlug }), replyId]);
    await postManual({
      text: `Auto-reply failed — workspace "${workspaceSlug}" not found in DB`,
      blocks: buildCard("Workspace not found in DB", workspaceSlug, { id: replyId, workspace_slug: workspaceSlug }, "", {
        reason: `No workspaces row found for slug "${workspaceSlug}". Check DB or onboard this workspace. Reset to 'new' once fixed.`,
      }),
    });
    return;
  }
  const workspace = wsResult.rows[0];
  const replyWithCreds = { ...reply, ...workspace };

  // ── Pre-filter 0: Empty message ──────────────────────────────────────────────
  const messageText = (reply.message ?? "").trim();
  if (!messageText) {
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "no_action", skipped_reason: "empty_message" }), replyId]);
    return;
  }

  // ── Pre-filter 1: OOO / bounce / spam ────────────────────────────────────────
  // Run BEFORE forwarding so we don't forward bounces/OOO to clients.
  if (isNoActionReply(messageText)) {
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "no_action", skipped_reason: "OOO/bounce/spam" }), replyId]);
    return;
  }

  // ── Forwarding path ───────────────────────────────────────────────────────────
  // Check BEFORE opt-out pre-filter: forwarding workspaces (e.g. Hahnbeck) want
  // ALL replies forwarded to the client — including not-interested, unsubscribes,
  // soft nos, everything. Only OOO/bounces are excluded above.
  const fileSlug = CLIENT_FILE_ALIASES[workspaceSlug] ?? workspaceSlug;
  const clientFileRaw = readFile(path.join(process.cwd(), "clients", `${fileSlug}.md`));
  if (!clientFileRaw) {
    console.error("[auto-reply] Client file not found:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  if (workspace.forward_replies_to_email) {
    const forwarded = await forwardToClient(replyWithCreds, workspace.forward_replies_to_email, workspace.forward_cc_emails ?? null);
    if (forwarded) {
      await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'forward_to_client',$6,$7,NOW())`,
        [`fwd-${replyId}-${Date.now()}`, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", `[Forwarded to ${workspace.forward_replies_to_email}]`]);
    }
    await pool.query(`UPDATE replies SET status=$1, ai_analysis=$2, ai_analyzed_at=NOW() WHERE id=$3`,
      [forwarded ? "forwarded" : "new", JSON.stringify({ forwarded_to: workspace.forward_replies_to_email, status: forwarded ? "sent" : "failed" }), replyId]);
    if (!forwarded) {
      await postManual({ text: `Forward failed, ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildCard("Forward failed", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: `Forward to ${workspace.forward_replies_to_email} failed.` }) });
    }
    return;
  }

  // ── Pre-filter 2: Opt-outs / not-interested ──────────────────────────────────
  const firstName = reply.lead_name?.split(" ").filter(Boolean)[0] || "there";
  const optOut = detectOptOut(messageText, firstName);
  if (optOut) {
    if (optOut.body) {
      // Unsubscribe: send confirmation reply
      const sent = await sendToEmailBison(replyWithCreds, optOut.body);
      if (sent) {
        await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
          [`auto-${replyId}-${Date.now()}`, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", optOut.body]);
      }
      await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
      await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`, [replyId]);
      await pool.query(`UPDATE replies SET status = 'replied', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: optOut.intent, auto_replied: true }), replyId]);
    } else {
      // Not-interested: close silently, no reply sent
      await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'closed' WHERE reply_id = $1`, [replyId]);
      await pool.query(`UPDATE replies SET status = 'read', interested = FALSE, ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: optOut.intent, auto_replied: false, skipped_reason: "not_interested_no_reply" }), replyId]);
    }
    return;
  }

  const quickRef = extractQuickReference(clientFileRaw);

  // ── Build thread history ──────────────────────────────────────────────────────
  // Includes: original cold email (step 0), our reply/FU emails, and prior inbound replies.
  // This gives Claude the full picture — including what was promised in the original pitch.
  const [coldEmailResult, outbound, inbound] = await Promise.all([
    // The original cold email the lead is responding to — gives context the lead may reference.
    pool.query(
      `SELECT email_body AS body, subject, sent_at
       FROM emails_sent
       WHERE workspace_slug=$1 AND lead_email=$2 AND email_body IS NOT NULL
       ORDER BY sent_at ASC LIMIT 1`,
      [workspaceSlug, reply.lead_email]
    ),
    pool.query(
      `SELECT 'outbound' AS dir, email_type, subject, body, sent_at
       FROM sent_emails
       WHERE workspace_slug=$1 AND lead_email=$2 AND email_type NOT IN ('forward_to_client')`,
      [workspaceSlug, reply.lead_email]
    ),
    pool.query(
      `SELECT 'inbound' AS dir, 'lead_reply' AS email_type, subject, message AS body, received_at AS sent_at
       FROM replies WHERE workspace_slug=$1 AND lead_email=$2 AND id!=$3`,
      [workspaceSlug, reply.lead_email, replyId]
    ),
  ]);

  const allMessages = [...outbound.rows, ...inbound.rows].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  const recentMessages = allMessages.slice(-8);
  const threadHistory = recentMessages.length > 0
    ? recentMessages.map((m) => `[${m.dir === "inbound" ? "LEAD" : "US"}] ${new Date(m.sent_at).toISOString().slice(0, 10)}: ${m.body?.slice(0, 400)}`).join("\n\n")
    : "No prior messages.";

  const coldEmailBody = coldEmailResult.rows[0]?.body?.slice(0, 600) ?? null;

  // ── Context injections ────────────────────────────────────────────────────────
  const alternateSender = detectAlternateSender(messageText, reply.lead_email);

  // ── System prompt ─────────────────────────────────────────────────────────────
  const systemPrompt = `You are the reply agent for Maxen Partners, a cold email agency managing outbound campaigns for M&A advisors, PE firms, franchise brands, and creative agencies. Your job is to draft replies that read like they came from a senior person who carefully read the whole thread — not an AI working through a checklist.

Every reply is sent AS the client's sender (e.g. Jeff Zanardi from ACT Capital, Nicklas Larsen from Larsen Digital, Svetlin Petrov from Statera Capital). You are not Maxen Partners. You are that person. Write in first person as them. Never refer to the sender by name as a subject ("Nicklas works with" is wrong. "I work with" is right. Always).

## BEFORE YOU WRITE ANYTHING — DO THESE FOUR THINGS

1. READ THE REPLY QUICK REFERENCE. It tells you the campaign type, Calendly link, teasers, and rules for this exact client. Every client is different. The REPLY QUICK REFERENCE overrides everything below.

2. READ THE THREAD HISTORY AND ORIGINAL EMAIL. Know what was already said and what was offered. Never repeat a link, stat, case study, or value prop already in the thread. If the teaser was already sent, do not send it again — acknowledge it and pull to a call.

3. READ WHAT THE LEAD ACTUALLY WROTE. Respond to their message, not the category of their message. If they asked a specific question, answer it. If they gave a time window, do not pretend they did not.

4. CHECK THE RECIPIENT. If the reply was sent by someone other than the lead on record (different name, "forwarded to me by", reply from a different email address), set recipient_email and recipient_name to that person. Address them directly.

## CAMPAIGN TYPE RULES (REPLY QUICK REFERENCE overrides these)

Sell-side advisory (approaching business owners about selling): goal is a call. No teaser. Send Calendly only. Never name the buyer.

Mandate / buy-side (approaching investors or buyers with a deal): send the correct teaser, then pull to a call. Match the teaser to the campaign name and trigger keywords in the REPLY QUICK REFERENCE. If two mandates exist, pick the one whose keywords match the campaign name. If unclear, default to a call.

Agency / services (franchise, CGI, growth): goal is a call. Answer what they asked — case studies, pricing, how it works — then redirect to a call.

## HOW TO DRAFT

Mirror their length and energy. A one-line reply gets a three-line response. A detailed message can justify more. Never default to a three-paragraph structure by habit.

Start with the substance. The first sentence responds to what they said. Not "Thanks for getting back to me." Jump straight to the point.

Make it specific. Reference something from their actual message — their company, their question, their hesitation. Generic replies that could go to anyone are wrong.

The goal is a 30-minute call. Every reply should move toward it. When you send the Calendly link, make the ask feel natural.

If they already said yes to a call: do not re-pitch. Do not ask "Worth a quick call?" again. They said yes. Send the link and stop.

If they said no: stop. No reply at all. Not even an acknowledgment unless they asked to be removed from the list.

## CALENDLY AND AVAILABILITY

Never confirm specific times. Never say "Thursday works" or "I have availability." Always use the Calendly link from the REPLY QUICK REFERENCE with a natural line: "Feel free to grab a time here: [link]"

Exception: if the REPLY QUICK REFERENCE says always_send_calendly:true (Larsen Digital), always send Calendly even when the lead gives a specific day or time.

Route to manual ONLY when: (1) lead explicitly says "call me" or "give me a call" AND provides a phone number they want to be called on — a phone number in their email signature alone does not count; (2) lead gives a specific day AND time AND always_send_calendly is not true.

## WHAT NEVER TO DO

- Never use em dashes or en dashes. Restructure the sentence instead.
- Never open with: "Hope this finds you well", "Thanks for reaching out", "I appreciate you taking the time", "Sounds great!", "I'd love to", "Excited to"
- Never confirm times or fabricate availability
- Never reply to a not-interested or hard-no lead
- Never send a teaser that does not match the campaign — default to a call if unsure
- Never refer to the sender in third person as the subject of a sentence
- Never end with "Best," or any name — the signature variable handles everything
- Never pad a short yes-reply into multiple paragraphs
- Never repeat a stat, link, or angle already in the thread

## REPLY STRUCTURE

Hi [First Name],

[Blank line]

[Substance — start here, no preamble]

[Blank line between every paragraph]

{SENDER_EMAIL_SIGNATURE}

## OUTPUT — JSON ONLY. NO PREAMBLE. NO FENCES.

{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested" | "needs_info" (asked a question, wants info) | "neutral" (vague, no clear signal) | "not_interested" | "unsubscribe" | "hard_no" (definitive disqualification) | "wrong_target" | "hostile",
  "fu_sequence_type": "full" (interested/needs_info/neutral) | "abbreviated" (soft timing objection: "not right now", "not the right time") | "none" (booked/unsubscribe/hard_no/wrong_target/hostile),
  "reply_body": "full plain text reply. Required when action is auto_send.",
  "manual_reason": "one sentence. Required when action is manual.",
  "flag_unsubscribe": false,
  "flag_meeting_booked": false,
  "recipient_email": "only if reply was written by someone other than the lead on record",
  "recipient_name": "display name if recipient_email is set"
}`;

  const userMessage = `REPLY QUICK REFERENCE:
${quickRef}

${alternateSender ? `${alternateSender}\n\n` : ""}${coldEmailBody ? `ORIGINAL COLD EMAIL SENT TO THIS LEAD (what they are responding to):\n${coldEmailBody}\n\n` : ""}THREAD HISTORY — WHAT HAS BEEN SAID (oldest first, do not repeat anything already here):
${threadHistory}

INBOUND REPLY TO RESPOND TO:
From: ${reply.lead_name} <${reply.lead_email}>
Company: ${reply.lead_company ?? "unknown"} | Title: ${reply.lead_title ?? "unknown"}
Campaign: ${reply.campaign ?? "unknown"}
Subject: ${reply.subject ?? ""}

${messageText.slice(0, 3000)}`;

  // ── Call Claude ───────────────────────────────────────────────────────────────
  const result = await callClaude(systemPrompt, userMessage);

  if (!result) {
    // Track consecutive Claude failures. After 3 failures, mark errored instead of
    // resetting to 'new' — prevents infinite retry loops when the API key is out of
    // credits or the model is down for an extended period.
    const prevAnalysis = reply.ai_analysis as Record<string, any> ?? {};
    const failCount = (prevAnalysis.claude_fail_count ?? 0) + 1;

    if (failCount >= 3) {
      await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ ...prevAnalysis, claude_fail_count: failCount, skipped_reason: "claude_repeated_failure" }), replyId]);
      await postManual({ text: `Auto-reply failed 3x (Claude error), ${workspaceSlug} / ${reply.lead_name} — marked errored`,
        blocks: buildCard("Auto-reply failed repeatedly (Claude error)", workspaceSlug, reply, workspace.email_bison_instance_url ?? "", {
          reason: `Claude API returned null ${failCount} times. Possible cause: API key out of credits, rate limited, or model down. Manual reply needed. Reset status to 'new' once resolved.`,
        }) });
    } else {
      await pool.query(`UPDATE replies SET status = 'new', ai_analysis = $1 WHERE id = $2`,
        [JSON.stringify({ ...prevAnalysis, claude_fail_count: failCount }), replyId]);
      console.warn(`[auto-reply] Claude returned null for ${replyId} (fail ${failCount}/3) — will retry`);
    }
    return;
  }

  // Sanitize
  if (result.reply_body) result.reply_body = sanitizeDashes(result.reply_body);
  if (result.manual_reason) result.manual_reason = sanitizeDashes(result.manual_reason);

  // Hard gate: not_interested and hard_no are NEVER replied to, regardless of Claude's action.
  // The pre-filter catches most of these for free; this catches any that slip through to Claude.
  if (result.intent === "not_interested" || result.intent === "hard_no") {
    await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'closed' WHERE reply_id = $1`, [replyId]);
    await pool.query(`UPDATE replies SET status = 'read', interested = FALSE, ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: result.intent, auto_replied: false, skipped_reason: "not_interested_no_reply" }), replyId]);
    return;
  }

  // Enforce fu_sequence_type = none for hard-close intents
  if (["unsubscribe", "wrong_target", "hostile"].includes(result.intent)) {
    result.fu_sequence_type = "none";
  }

  // Override: force auto_send for always-auto intents even if Claude returned manual
  if (result.action === "manual" && new Set(["unsubscribe","wrong_target","hostile"]).has(result.intent)) {
    result.action = "auto_send";
    if (!result.reply_body) {
      const body1line = `Hi ${firstName},\n\nRemoved — you won't hear from us again.\n\n{SENDER_EMAIL_SIGNATURE}`;
      result.reply_body = body1line;
    }
  }

  // Body length guard: 80 chars catches truncated replies ("Hi John,", "Hi John,\n\nSounds great!")
  // while allowing valid short replies through. 80 was set after the 2026-05-11 batch incident.
  if (result.action === "auto_send" && result.reply_body) {
    const stripped = result.reply_body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    if (stripped.length < 80) {
      result.action = "manual";
      result.manual_reason = `Generated reply too short (${stripped.length} chars) — likely truncation. Needs manual review.`;
    }
  }

  // Signature guard
  if (result.action === "auto_send" && result.reply_body && !/\{SENDER_EMAIL_SIGNATURE\}/i.test(result.reply_body)) {
    result.reply_body = result.reply_body.trimEnd() + "\n\n{SENDER_EMAIL_SIGNATURE}";
  }

  // DB flags
  if (result.flag_unsubscribe) {
    await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`, [replyId]);
  }
  if (result.flag_meeting_booked) {
    await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET meeting_booked = TRUE, next_fu_due = NULL, outcome = 'booked' WHERE reply_id = $1`, [replyId]);
  }

  // Persist recipient override BEFORE routing — approval path reads it from DB later.
  // Previously this was inside the auto_send branch, so approved drafts sent to wrong address.
  if (result.recipient_email) {
    await pool.query(`UPDATE replies SET preferred_recipient_email=$1, preferred_recipient_name=$2 WHERE id=$3`,
      [result.recipient_email, result.recipient_name ?? null, replyId]);
    replyWithCreds.preferred_recipient_email = result.recipient_email;
    replyWithCreds.preferred_recipient_name = result.recipient_name ?? null;
  }

  // ── Route ─────────────────────────────────────────────────────────────────────

  if (result.action === "auto_send" && result.reply_body) {
    const alwaysAutoSend = new Set(["unsubscribe","hard_no","wrong_target","hostile","not_interested"]);
    const isComplexThread = allMessages.length >= 6;
    // Complex threads always go to approval regardless of approval_mode — too much context to auto-send blind.
    const forceApproval = isComplexThread && !alwaysAutoSend.has(result.intent);
    const withinQuota = !alwaysAutoSend.has(result.intent) && workspace.auto_reply_approval_mode && await shouldRouteToApproval();

    if (withinQuota || forceApproval) {
      if (forceApproval && !withinQuota) {
        result.manual_reason = `Complex thread (${allMessages.length} prior messages) — forced to approval for review.`;
      }
      const draftId = `rd-${replyId}-${Date.now()}`;
      const slackTs = await postApprovalCard({ workspaceSlug, reply: replyWithCreds, instanceUrl: workspace.email_bison_instance_url ?? "", result });

      if (!slackTs) {
        // Slack post failed — fall through to direct send rather than leaving the
        // reply stuck at 'awaiting_approval' with no way to approve it.
        console.warn(`[auto-reply] Approval card post failed for ${replyId} — falling through to direct send`);
      } else {
        await pool.query(
          `INSERT INTO reply_drafts (id,reply_id,workspace_slug,lead_name,lead_email,intent,action,fu_sequence_type,flag_unsubscribe,flag_meeting_booked,manual_reason,subject,body,status,slack_ts,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW())`,
          [draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, result.intent, result.action, result.fu_sequence_type, result.flag_unsubscribe, result.flag_meeting_booked, result.manual_reason ?? null, reply.subject ?? "", result.reply_body, slackTs]
        );
        await pool.query(`UPDATE replies SET status='awaiting_approval', ai_analysis=$1, ai_analyzed_at=NOW() WHERE id=$2`,
          [JSON.stringify({ intent: result.intent, auto_replied: false, awaiting_approval: true, fu_sequence_type: result.fu_sequence_type }), replyId]);
        return;
      }
    }

    // Direct send
    const sent = await sendToEmailBison(replyWithCreds, result.reply_body);
    if (sent) {
      await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [`auto-${replyId}-${Date.now()}`, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", result.reply_body]);
      const interested = ["interested","interested_urgent","needs_info"].includes(result.intent);
      await pool.query(`UPDATE replies SET status='replied', interested=$1, ai_analysis=$2, ai_analyzed_at=NOW() WHERE id=$3`,
        [interested ? true : null, JSON.stringify({ intent: result.intent, auto_replied: true, fu_sequence_type: result.fu_sequence_type }), replyId]);
      await createFuRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);
      console.log(`[auto-reply] Sent ${replyId} (${workspaceSlug} / ${reply.lead_name})`);
    } else {
      const prevAnalysis2 = reply.ai_analysis as Record<string, any> ?? {};
      const ebFails = (prevAnalysis2.eb_fail_count ?? 0) + 1;
      if (ebFails >= 3) {
        await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1 WHERE id = $2`,
          [JSON.stringify({ ...prevAnalysis2, eb_fail_count: ebFails }), replyId]);
        await postManual({ text: `Auto-reply send failed 3x (EmailBison error), ${workspaceSlug} / ${reply.lead_name} — marked errored`,
          blocks: buildCard("EmailBison send failed repeatedly", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: `EmailBison returned error ${ebFails} times. Check EmailBison API status. Manual reply needed.` }) });
      } else {
        await pool.query(`UPDATE replies SET status = 'new', ai_analysis = $1 WHERE id = $2`,
          [JSON.stringify({ ...prevAnalysis2, eb_fail_count: ebFails }), replyId]);
        console.warn(`[auto-reply] EmailBison send failed for ${replyId} (fail ${ebFails}/3) — will retry`);
      }
    }

  } else if (result.action === "manual") {
    await pool.query(`UPDATE replies SET status = 'awaiting_manual' WHERE id = $1`, [replyId]);
    await postManual({ text: `Manual handling needed, ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildCard("Manual handling needed", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: result.manual_reason ?? "Needs human attention.", intent: result.intent }) });
    await createFuRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);

  } else {
    // do_nothing
    const clearClose = (result.intent === "not_interested" || result.intent === "unsubscribe") && result.fu_sequence_type === "none";
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    if (result.intent === "unsubscribe") {
      // Kill any active FU sequence — lead has opted out.
      await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`, [replyId]);
    }
    if (!clearClose) {
      await postManual({ text: `Reply needs review, ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildCard("Reply needs manual review", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: result.manual_reason ?? "Auto-reply set do_nothing — please review." }) });
    }
  }
}
