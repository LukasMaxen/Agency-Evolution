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

/**
 * Pre-matches mandate/teaser from client file against campaign name + message.
 * Injects the correct teaser so Claude never picks the wrong one.
 */
function matchMandate(quickRef: string, campaignName: string, leadMessage: string): string | null {
  const mandateBlocks = quickRef.split(/###\s+Mandate\s+\d+/i).slice(1);
  if (mandateBlocks.length === 0) return null;

  interface MandateCandidate { name: string; teaser: string; calendly: string; keywords: string[] }
  const mandates: MandateCandidate[] = [];

  for (const block of mandateBlocks) {
    const nameMatch = block.match(/^[^\n]*—\s*(.+)/);
    const teaserMatch = block.match(/\*\*Teaser:\*\*\s*(https?:\/\/\S+)/);
    const calendlyMatch = block.match(/\*\*Calendly:\*\*\s*(https?:\/\/\S+)/);
    const keywordsMatch = block.match(/\*\*Trigger keywords:\*\*\s*(.+)/);
    if (!teaserMatch) continue;
    mandates.push({
      name: nameMatch?.[1]?.trim() ?? "Unknown",
      teaser: teaserMatch[1].trim(),
      calendly: calendlyMatch?.[1]?.trim() ?? "",
      keywords: keywordsMatch ? keywordsMatch[1].split(",").map(k => k.trim().toLowerCase()) : [],
    });
  }

  if (mandates.length === 0) return null;
  const searchText = `${campaignName} ${leadMessage}`.toLowerCase();
  let best: MandateCandidate | null = null;
  let bestScore = 0;
  for (const m of mandates) {
    const score = m.keywords.filter(kw => searchText.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (!best || bestScore === 0) return null;
  return `MANDATE MATCH: Use this teaser — "${best.name}": ${best.teaser}${best.calendly ? `. Calendly: ${best.calendly}` : ""}. Do not use any other mandate link.`;
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
        max_tokens: 1000,
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

const ALWAYS_AUTO_SEND = new Set(["unsubscribe", "hard_no", "wrong_target", "hostile", "not_interested"]);

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

  const todayResult = await pool.query<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt FROM reply_drafts
    WHERE status = 'pending'
      AND (created_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date
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

  // Superseded check: if a newer reply from same lead is queued, skip this one
  const newer = await pool.query(
    `SELECT id FROM replies WHERE workspace_slug=$1 AND lead_email=$2 AND id!=$3 AND status='new' AND received_at>$4 LIMIT 1`,
    [workspaceSlug, reply.lead_email, replyId, reply.received_at]
  );
  if (newer.rows.length > 0) {
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    return;
  }

  // Workspace + credentials
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode, forward_replies_to_email, forward_cc_emails FROM workspaces WHERE slug = $1`,
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) { console.error("[auto-reply] Workspace not found:", workspaceSlug); return; }
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

  // ── Build thread history (outbound + inbound, chronological) ─────────────────
  const outbound = await pool.query(`SELECT 'outbound' AS dir, email_type, subject, body, sent_at FROM sent_emails WHERE workspace_slug=$1 AND lead_email=$2`, [workspaceSlug, reply.lead_email]);
  const inbound = await pool.query(`SELECT 'inbound' AS dir, 'lead_reply' AS email_type, subject, message AS body, received_at AS sent_at FROM replies WHERE workspace_slug=$1 AND lead_email=$2 AND id!=$3`, [workspaceSlug, reply.lead_email, replyId]);
  const allMessages = [...outbound.rows, ...inbound.rows].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  const threadHistory = allMessages.length > 0
    ? allMessages.map((m, i) => `[${m.dir === "inbound" ? "LEAD" : "US"}] ${new Date(m.sent_at).toISOString().slice(0, 10)}: ${m.body?.slice(0, 600)}`).join("\n\n")
    : "No prior messages.";

  // ── Context injections ────────────────────────────────────────────────────────
  const alternateSender = detectAlternateSender(messageText, reply.lead_email);
  const mandateNote = matchMandate(quickRef, reply.campaign ?? "", messageText);

  // ── System prompt (lean, cached) ──────────────────────────────────────────────
  const systemPrompt = `You are drafting a reply to an inbound email for Maxen Partners.

RULES:
1. Read the REPLY QUICK REFERENCE below — it tells you exactly what to say, what Calendly link to use, and what to never do. Follow it precisely.
2. Read the thread history to understand the full conversation. Never repeat what was already sent.
3. Respond to what the lead actually said in their latest message. Not what you want them to do — what they asked.
4. Write in first person as the sender. Never refer to the sender by name as subject ("Nicklas works with" = wrong, "I work with" = right).
5. Never confirm specific times or availability. Always use the Calendly link from the quick reference.
6. Match reply length to the lead's message. Short message = short reply.
7. No em dashes, no en dashes. No AI filler phrases ("Sounds great!", "I'd love to", "Excited to show you").
8. End every reply with {SENDER_EMAIL_SIGNATURE} on its own line. Nothing before it — no "Best," or name.
9. Always put a blank line between each paragraph. Never run text into one block.
10. If the teaser link was already sent to this lead in the thread history, do not send it again. Acknowledge it and push to the call instead.
11. If the lead is confirming a meeting already booked: reply in 2 lines max. No re-pitch, no "if anything shifts", no rescheduling offers. Acknowledge and close. Set flag_meeting_booked = true.

ROUTING:
- auto_send: you can draft a correct, complete reply
- manual: lead gave a phone number asking to be called, or gave a specific day+time (non-Larsen), or situation is genuinely unclear
- do_nothing: nothing to respond to

OUTPUT: single JSON object only. No preamble. No markdown.
{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested" | "needs_info" | "not_interested" | "unsubscribe" | "neutral" | "hard_no" | "wrong_target" | "hostile",
  "fu_sequence_type": "full" | "abbreviated" | "none",
  "reply_body": "plain text reply ending with {SENDER_EMAIL_SIGNATURE}. Omit if not auto_send.",
  "manual_reason": "one sentence. Omit if not manual.",
  "flag_unsubscribe": false,
  "flag_meeting_booked": false,
  "recipient_email": "only if reply came from different person than lead on record",
  "recipient_name": "display name if recipient_email is set"
}`;

  const userMessage = `REPLY QUICK REFERENCE:
${quickRef}

${mandateNote ? `${mandateNote}\n\n` : ""}${alternateSender ? `${alternateSender}\n\n` : ""}THREAD HISTORY (oldest first):
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
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    await postManual({ text: `Auto-reply failed (Claude error), ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildCard("Auto-reply failed (Claude error)", workspaceSlug, reply, workspace.email_bison_instance_url ?? "", { reason: "Claude API error — reply reset to new for retry." }) });
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

  // Body length guard (Sonnet only, not pre-filter templates)
  if (result.action === "auto_send" && result.reply_body) {
    const stripped = result.reply_body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    if (stripped.length < 30) {
      result.action = "manual";
      result.manual_reason = "Generated reply too short — needs manual review.";
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

  // Persist recipient override
  if (result.recipient_email && result.action === "auto_send") {
    await pool.query(`UPDATE replies SET preferred_recipient_email=$1, preferred_recipient_name=$2 WHERE id=$3`,
      [result.recipient_email, result.recipient_name ?? null, replyId]);
    replyWithCreds.preferred_recipient_email = result.recipient_email;
    replyWithCreds.preferred_recipient_name = result.recipient_name ?? null;
  }

  // ── Route ─────────────────────────────────────────────────────────────────────

  if (result.action === "auto_send" && result.reply_body) {
    const alwaysAutoSend = new Set(["unsubscribe","hard_no","wrong_target","hostile","not_interested"]);
    const isComplexThread = allMessages.length >= 6;
    const forceApproval = isComplexThread && !alwaysAutoSend.has(result.intent) && workspace.auto_reply_approval_mode;
    const withinQuota = !alwaysAutoSend.has(result.intent) && workspace.auto_reply_approval_mode && await shouldRouteToApproval();

    if (withinQuota || forceApproval) {
      if (forceApproval && !withinQuota) {
        result.manual_reason = `Complex thread (${allMessages.length} prior messages) — forced to approval for review.`;
      }
      const draftId = `rd-${replyId}-${Date.now()}`;
      const slackTs = await postApprovalCard({ workspaceSlug, reply: replyWithCreds, instanceUrl: workspace.email_bison_instance_url ?? "", result });
      await pool.query(
        `INSERT INTO reply_drafts (id,reply_id,workspace_slug,lead_name,lead_email,intent,action,fu_sequence_type,flag_unsubscribe,flag_meeting_booked,manual_reason,subject,body,status,slack_ts,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW())`,
        [draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, result.intent, result.action, result.fu_sequence_type, result.flag_unsubscribe, result.flag_meeting_booked, result.manual_reason ?? null, reply.subject ?? "", result.reply_body, slackTs]
      );
      await pool.query(`UPDATE replies SET status='awaiting_approval', ai_analysis=$1, ai_analyzed_at=NOW() WHERE id=$2`,
        [JSON.stringify({ intent: result.intent, auto_replied: false, awaiting_approval: true, fu_sequence_type: result.fu_sequence_type }), replyId]);
      return;
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
      await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
      await postManual({ text: `Auto-reply failed (EmailBison error), ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildCard("Auto-reply send failed", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: "EmailBison send error — reply reset for retry." }) });
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
    if (!clearClose) {
      await postManual({ text: `Reply needs review, ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildCard("Reply needs manual review", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: result.manual_reason ?? "Auto-reply set do_nothing — please review." }) });
    }
  }
}
