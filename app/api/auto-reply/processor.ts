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

interface Mandate {
  name: string;
  teaser: string;
  calendly: string;
  keywords: string[];
}

/**
 * Extracts structured lead intelligence from their message and email signature.
 * Pulls title, company description, website, phone, and any self-description
 * the lead included. This gives Claude real context without any external API —
 * leads typically describe themselves in detail in their signatures and messages.
 */
function extractLeadIntelligence(
  message: string,
  leadName: string,
  leadEmail: string,
  leadCompany: string | null,
  leadTitle: string | null
): string {
  if (!message) return "";

  const lines = message.split("\n").map(l => l.trim()).filter(Boolean);
  const intel: string[] = [];

  // Email domain as a company signal
  const domain = leadEmail.split("@")[1] ?? "";
  if (domain && !domain.includes("gmail") && !domain.includes("yahoo") && !domain.includes("hotmail") && !domain.includes("outlook")) {
    intel.push(`Company domain: ${domain}`);
  }

  // Extract website URLs from the message (often in signatures)
  const urls = message.match(/https?:\/\/(?!calendly|linkedin|twitter|facebook|instagram|tiktok|youtube|google|aka\.ms)[^\s\]>)]+/g) ?? [];
  const companyUrls = urls.filter(u => !u.includes("emailagencyevolution") && !u.includes("actcapital") && !u.includes("ventureexits") && !u.includes("stateracap"));
  if (companyUrls.length > 0) {
    intel.push(`Company website(s): ${[...new Set(companyUrls)].slice(0, 3).join(", ")}`);
  }

  // Extract phone numbers
  const phones = message.match(/(?:\+?\d[\d\s\-().]{7,}\d)/g) ?? [];
  if (phones.length > 0) {
    intel.push(`Phone number(s) in message: ${phones.slice(0, 2).join(", ")}`);
  }

  // Extract title from signature lines (lines containing common title keywords)
  const titleLine = lines.find(l =>
    /\b(CEO|CFO|COO|CTO|CMO|founder|owner|president|director|partner|managing|principal|manager|head of|VP|vice|associate|analyst|advisor|consultant|chairman|board)\b/i.test(l) &&
    l.length < 120 &&
    !l.startsWith("From:") &&
    !l.startsWith("To:") &&
    !l.startsWith("Subject:")
  );
  if (titleLine && titleLine !== leadTitle) {
    intel.push(`Title/role from signature: ${titleLine}`);
  }

  // Extract any sentence where the lead describes their company or role
  // Look for self-description patterns: "We are", "Our company", "I work", "We work", "We help", "We focus"
  const selfDescriptions = lines.filter(l =>
    /^(we (are|work|help|focus|specialize|operate|run|manage|invest|provide|build)|our (company|firm|fund|team|business|focus|mandate)|i (am|work|help|run|manage|represent|focus))/i.test(l) &&
    l.length > 20 &&
    l.length < 300
  );
  if (selfDescriptions.length > 0) {
    intel.push(`Lead's self-description: ${selfDescriptions.slice(0, 3).join(" | ")}`);
  }

  // Extract any specific numbers, metrics, or named entities they mentioned
  // (revenue figures, fund sizes, locations, partner names, accreditations)
  const namedEntities = lines.filter(l =>
    /\$[\d,.]+[MBK]?|\d+[MBK]\s*(AUM|revenue|fund|raise)|\b(IFC|PE|VC|LP|GP|NDA|LOI|LOC|EBITDA|EPC|M&A)\b/i.test(l) &&
    l.length < 200
  );
  if (namedEntities.length > 0) {
    intel.push(`Key metrics/entities mentioned: ${namedEntities.slice(0, 3).join(" | ")}`);
  }

  if (intel.length === 0) return "";

  return `LEAD INTELLIGENCE (extracted from their message and signature — use this to write a reply that proves you read carefully):
${intel.join("\n")}`;
}

/**
 * Haiku-powered draft critic. Reads the drafted reply against a short quality
 * checklist and returns issues found, or null if the draft passes.
 * Costs ~$0.001 per call — runs on every auto_send draft.
 */
async function critiqueDraft(
  draft: string,
  leadMessage: string,
  leadName: string,
  senderContext: string
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: `You are a quality checker for cold email replies. You check a drafted reply against a strict checklist and report ONLY genuine issues. Be concise. If the draft is good, say "PASS". If there are issues, list them briefly.

Checklist:
1. Is the reply written in first person? (never "Nicklas works with", always "I work with")
2. Does it directly address what the lead asked — not what we want them to do?
3. Does it reference at least one specific detail from the lead's message or company?
4. Is the tone appropriate for the lead's register (formal/casual/direct)?
5. Is it free of AI-sounding filler phrases? ("That's fantastic!", "I'd love to", "Excited to show you")
6. Is it concise — not padded out unnecessarily?
7. Does it NOT confirm a specific time or availability?

Output format: either the single word "PASS" or a short list of issues found (2-3 words each, max 5 issues). Nothing else.`,
        messages: [{
          role: "user",
          content: `Lead's message:
${leadMessage.slice(0, 800)}

Sender context: ${senderContext}

Drafted reply:
${draft}

Check the draft now.`,
        }],
      }),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return null;

  const data = await response.json();
  const result = (data.content?.[0]?.text ?? "").trim();
  if (result.toUpperCase().startsWith("PASS")) return null;
  return result || null;
}

/**
 * Sonnet revision pass. Takes the original draft + Haiku's critique and
 * produces a revised reply that addresses the issues found.
 */
async function reviseDraft(
  originalDraft: string,
  critique: string,
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
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
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [
          { role: "user", content: userMessage },
          { role: "assistant", content: JSON.stringify({ action: "auto_send", intent: "interested", fu_sequence_type: "full", reply_body: originalDraft, flag_unsubscribe: false, flag_meeting_booked: false }) },
          { role: "user", content: `A quality check found the following issues with the reply_body you drafted:\n${critique}\n\nRevise ONLY the reply_body to fix these issues. Return the complete JSON object again with the revised reply_body. All other fields stay the same.` },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] revision timed out");
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return null;

  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed.reply_body ?? null;
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      try {
        const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
        return parsed.reply_body ?? null;
      } catch { /* fall through */ }
    }
    return null;
  }
}

/**
 * Extracts mandate definitions from a client file and matches the best one
 * against the campaign name and lead message. Returns the matched mandate or
 * null if no match found (non-mandate campaign or no keyword overlap).
 *
 * Reads structured mandate blocks from client files using the pattern:
 *   ### Mandate N — [Name]
 *   **Teaser:** [url]
 *   **Trigger keywords:** [kw1, kw2, ...]
 */
function matchMandate(clientFileContent: string, campaignName: string, leadMessage: string): Mandate | null {
  if (!clientFileContent) return null;

  const mandateBlocks = clientFileContent.split(/###\s+Mandate\s+\d+/i).slice(1);
  if (mandateBlocks.length === 0) return null;

  const mandates: Mandate[] = [];
  for (const block of mandateBlocks) {
    const nameMatch = block.match(/^[^\n]*—\s*(.+)/);
    const teaserMatch = block.match(/\*\*Teaser:\*\*\s*(https?:\/\/\S+)/);
    const calendlyMatch = block.match(/\*\*Calendly:\*\*\s*(https?:\/\/\S+)/);
    const keywordsMatch = block.match(/\*\*Trigger keywords:\*\*\s*(.+)/);

    if (!teaserMatch) continue;

    const keywords = keywordsMatch
      ? keywordsMatch[1].split(",").map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];

    mandates.push({
      name: nameMatch?.[1]?.trim() ?? "Unknown",
      teaser: teaserMatch[1].trim(),
      calendly: calendlyMatch?.[1]?.trim() ?? "",
      keywords,
    });
  }

  if (mandates.length === 0) return null;

  const searchText = `${campaignName} ${leadMessage}`.toLowerCase();

  // Score each mandate by keyword matches
  let bestMandate: Mandate | null = null;
  let bestScore = 0;

  for (const mandate of mandates) {
    const score = mandate.keywords.filter(kw => searchText.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMandate = mandate;
    }
  }

  // Only return a match if at least one keyword matched
  return bestScore > 0 ? bestMandate : null;
}

/**
 * Scans the inbound reply message for email addresses and names that differ
 * from the original lead. Returns a plain-text warning string if a different
 * sender is detected, or null if the reply looks like it came from the lead.
 *
 * Catches patterns like:
 *   - A different "From:" address in a quoted thread
 *   - An email address in the signature block that differs from lead_email
 *   - "I am [name]" or "My name is [name]" with a different email
 */
function detectAlternateSender(message: string, leadEmail: string): string | null {
  if (!message || !leadEmail) return null;

  // Extract all email addresses from the message
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = [...new Set((message.match(emailRegex) ?? []).map(e => e.toLowerCase()))];
  const leadNorm = leadEmail.toLowerCase();

  // Filter out the lead's own address and common no-reply/system addresses
  const others = found.filter(e =>
    e !== leadNorm &&
    !e.startsWith("noreply") &&
    !e.startsWith("no-reply") &&
    !e.startsWith("donotreply") &&
    !e.includes("mailer-daemon") &&
    !e.includes("postmaster")
  );

  if (others.length === 0) return null;

  // Check if the message body (before quoted thread) contains an alternate address —
  // addresses only appearing deep in quoted headers are less reliable signals.
  const bodyBeforeQuote = message.split(/\n[-]{3,}|\nOn .+ wrote:/)[0] ?? message;
  const inBody = others.filter(e => bodyBeforeQuote.toLowerCase().includes(e));

  const candidates = inBody.length > 0 ? inBody : others;

  return `RECIPIENT DETECTION WARNING: The reply message contains email address(es) that differ from the lead on record (${leadEmail}). Possible alternate sender(s): ${candidates.join(", ")}. Check whether the reply was written by a different person and set recipient_email accordingly.`;
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

  const recipientOverride = result.recipient_email && result.recipient_email !== reply.lead_email;
  const sendingToLine = recipientOverride
    ? `*Sending to:* :warning: ${result.recipient_name ?? ""} <${result.recipient_email}> _(differs from lead on record: ${reply.lead_email})_`
    : `*Sending to:* ${leadLine}`;

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
        text: `${sendingToLine}\n*Intent:* ${result.intent}  ·  *FU sequence:* ${result.fu_sequence_type}`,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000); // 90-second hard timeout

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error("[auto-reply] Claude API call timed out after 90s");
    } else {
      console.error("[auto-reply] Claude API fetch error:", err?.message ?? err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.error("[auto-reply] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();

  // Tolerant parse: try strict first, fall back to extracting the outermost {...}
  try {
    return JSON.parse(clean) as AutoReplyResult;
  } catch {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.slice(firstBrace, lastBrace + 1)) as AutoReplyResult;
      } catch { /* fall through */ }
    }
    console.error("[auto-reply] Failed to parse Claude response:", raw.slice(0, 500));
    return null;
  }
}

/**
 * OOO / bounce / spam pre-filter. Returns true if the message is clearly
 * a no-action reply that should never reach Claude. Catches the most common
 * patterns before spending a Sonnet call on them.
 */
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

  // Superseded reply check: if a newer reply from the same lead in this workspace
  // is already queued (status = 'new'), this one is outdated. Mark it read and exit
  // so only the latest message gets processed. Prevents replying to an old message
  // when the lead has already sent follow-ups.
  const newerReply = await pool.query(
    `SELECT id FROM replies
     WHERE workspace_slug = $1
       AND lead_email = $2
       AND id != $3
       AND status = 'new'
       AND received_at > $4
     LIMIT 1`,
    [workspaceSlug, reply.lead_email, replyId, reply.received_at]
  );
  if (newerReply.rows.length > 0) {
    await pool.query(`UPDATE replies SET status = 'read' WHERE id = $1`, [replyId]);
    console.log(`[auto-reply] ${replyId} superseded by newer reply from same lead — skipping`);
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

  const systemPrompt = `You are the reply agent for Maxen Partners. You draft replies that are indistinguishable from what a sharp, experienced human operator would write after carefully reading the full conversation.

The standard is not "good enough to send." The standard is: would a senior person at Maxen Partners look at this reply and be proud to put their name on it? If not, route to manual.

---

## STEP 1 — READ EVERYTHING BEFORE WRITING A WORD

Do this in order. Do not skip steps.

1. Read the CLIENT FILE in full. Know the offer, the sender, the Calendly link, the mandates, the tone, and the reply guidelines before looking at anything else.
2. Read CONTEXT_Replies.md in full, especially the section "Hard Rules — Learned From Live Incidents." These rules are non-negotiable.
3. Read SKILL_Reply-Management.md for the full process, scenario library, and intent definitions.
4. Read the FULL THREAD HISTORY. Understand the entire relationship: what was sent, what was said, where the conversation is now.
5. Read the INBOUND LEAD REPLY — the specific message you are responding to right now.

Only after completing all five steps above should you begin drafting.

---

## STEP 2 — PROFILE THE LEAD BEFORE DRAFTING

Before writing a single word of the reply, extract the following from the lead's message and the thread:

**Who are they?**
- What is their title and role? (CEO, Personal Assistant to Chairman, Investment Principal, Franchise Owner?)
- What company are they at and what does it do? Reference this in your reply.
- Are they the decision maker or a screener?

**What are they actually asking for?**
- Not what you want them to do. What did they actually ask?
- If they asked for a teaser, send the teaser. Do not redirect to a call instead.
- If they asked a specific question, answer it. Do not ignore it and push to a call.
- If they confirmed a booking, just confirm back. Do not re-pitch.

**What is their tone and register?**
- Formal and detailed (long email, professional vocabulary) → match it
- Short and direct (two words, casual) → match it
- Warm and personal → match it
- Frustrated or skeptical → acknowledge it, do not pretend it is not there

**What has already been said in this thread?**
- What links have already been sent? Do not send them again.
- What value props, case studies, or stats have already been used? Do not repeat them.
- What has the lead already agreed to or confirmed? Do not ask again.
- Has the lead raised an objection before? Has it been addressed?

**What specific detail from their message can you reference?**
Every reply must contain at least one specific reference to something the lead wrote or something unique about their company or situation. Generic phrasing that could be copy-pasted to any lead is wrong. If you cannot find a specific detail to reference, you are not reading carefully enough.

---

## STEP 3 — DECIDE THE ACTION

Use this decision tree strictly:

**do_nothing** if:
- Out-of-office, vacation reply, delivery failure, automated notice, bounce
- Nothing to respond to (empty message, forwarding notice with no new content)

**manual** if:
- Lead gives a phone number and asks to be called
- Lead explicitly requests a phone call over a video/calendar booking
- Lead gives a specific day AND time for non-Larsen Digital clients (e.g. "Monday at 2pm", "tomorrow morning")
- The situation is genuinely unusual and you are not confident in the correct response — route to manual rather than guessing

**auto_send** for everything else, including:
- Angry replies, hostile replies, difficult objections — draft and send, do not escalate
- Ambiguous replies — draft the most reasonable response and send
- All interested signals — draft and send (or stage for approval)

---

## STEP 4 — DRAFT THE REPLY

Apply every rule below. Check each one before finalising.

**Sender identity (absolute)**
You are the sender. Write in first person always.
WRONG: "The partners Nicklas works with have closed over $1B"
RIGHT: "The partners I work with have closed over $1B"
WRONG: "Romain is based in France and specialises in CGI"
RIGHT: "I am based in France and specialise in CGI"
Any sentence where you would write the sender's name as a subject → replace with I, me, my, we, our.

**Respond to the latest message only**
The INBOUND LEAD REPLY is the message you are responding to. Thread history is context. Do not reply to an older message in the thread even if it seems more relevant.

**Never confirm availability**
No calendar access exists. Never write "next Friday works well", "that time works", "Monday is fine." When a lead asks for availability or names a day → send the Calendly link. Nothing else.

**Match length to the lead's message**
- Lead wrote 2 sentences → reply in 2-3 sentences
- Lead wrote a detailed 5-paragraph email → reply can be more substantial, but still concise
- Lead confirmed a booking → 2 lines max. No re-pitch. No "if anything shifts."
- Lead said yes to a call → skip "worth a quick call?" — they already said yes. Just send the Calendly link.

**Reference something specific**
Every reply must prove you read the message. Reference their company, their situation, something they said, or something unique about their business. If your reply could be sent word-for-word to a different lead, it is too generic. Rewrite it.

**Mandate campaigns — always use the correct teaser**
If a MANDATE MATCH note is present in the context, use that teaser and Calendly link. Always include the teaser when a buyer expresses interest in a mandate campaign — this is non-negotiable. Do not redirect to a call without first sending the teaser.

**Never repeat what is already in the thread**
If the teaser was sent in a prior email, do not send it again. Acknowledge it and push to next step. If a case study was used in FU2, do not use it again in FU4.

**No AI-sounding phrases**
Never use: "Sounds great!", "That's fantastic!", "I'm excited to...", "I'd love to hop on a quick call", "Looking forward to diving into this", "Genuinely", "Straightforward", "Thrilled", "Delighted", "Excited to show you what we can do."
Use: "Great.", "Happy to.", "Worth a quick call?", "Looking forward to speaking.", "Feel free to grab a time here."

**No dashes**
No em dashes, en dashes, or hyphens used as punctuation. Restructure the sentence instead.

**Signature**
Always end with {SENDER_EMAIL_SIGNATURE} on its own line. Never write "Best," or "Best regards," or any name before it.

**Blank lines between paragraphs**
Always. Never run paragraphs together.

---

## STEP 5 — QUALITY CHECK BEFORE OUTPUTTING

Ask yourself these four questions. If any answer is no, rewrite before outputting.

1. Does this reply directly address what the lead said in their latest message?
2. Does it reference at least one specific detail from their message or company?
3. Could this exact email be sent word-for-word to a different lead and still make sense? (If yes, it is too generic — rewrite it.)
4. Does it match the lead's length and tone?

If all four are yes, output the JSON. If not, fix the draft first.

---

## OUTPUT FORMAT

Return a single JSON object and nothing else. Start with "{" and end with "}". No preamble, no markdown fences, no commentary.

{
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested_urgent" | "interested" | "needs_info" | "neutral" | "not_interested" | "hard_no" | "unsubscribe" | "wrong_target" | "hostile",
  "fu_sequence_type": "full" | "abbreviated" | "none",
  "reply_body": "full email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. Never write Best or any name before the signature variable. Omit if action is not auto_send.",
  "manual_reason": "one short sentence on what needs human attention. Only include if action is manual.",
  "flag_unsubscribe": true | false,
  "flag_meeting_booked": true | false,
  "recipient_email": "OPTIONAL. Only when a different person than the original lead wrote the reply.",
  "recipient_name": "OPTIONAL. Display name when recipient_email is populated."
}

---

## INTENT RULES

- manual = phone number given, phone call explicitly requested, or specific day+time given (non-Larsen)
- not_interested = soft no with timing language — abbreviated FU (2 steps), auto_send 1-line acknowledgment
- hard_no = definite close — FU none, auto_send 2-line professional close
- unsubscribe = explicit removal — FU none, flag_unsubscribe true, auto_send 1-sentence confirmation
- wrong_target = wrong person/company, no redirect — FU none, flag_unsubscribe true, auto_send brief apology
- hostile = abusive language — FU none, flag_unsubscribe true, auto_send 1-line acknowledgment

## FU SEQUENCE RULES

- interested_urgent, interested, needs_info, neutral → full (6 steps)
- not_interested → abbreviated (2 steps)
- hard_no, unsubscribe, wrong_target, hostile → none

---

=== SKILL_Reply-Management.md ===
${skillFile}

=== CONTEXT_Replies.md ===
${contextFile}

=== SKILL_FollowUps.md ===
${fuSkillFile}

=== CONTEXT_FollowUps.md ===
${fuContextFile}`;

  // OOO / bounce / spam pre-filter: skip Claude entirely for obvious no-action replies.
  // This catches out-of-office, delivery failures, and auto-replies before spending
  // a Sonnet call on them.
  if (isNoActionReply(reply.message ?? "")) {
    await pool.query(
      `UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "out_of_office_or_bounce", auto_replied: false, skipped_reason: "pre-filter: OOO/bounce/spam detected" }), replyId]
    );
    console.log(`[auto-reply] ${replyId} skipped by OOO/bounce pre-filter`);
    return;
  }

  // Fetch full thread: outgoing emails AND inbound replies, merged chronologically.
  // Without inbound replies Claude only sees half the conversation and misses context
  // like forwarded threads, questions from new contacts, or multi-turn exchanges.
  const outboundResult = await pool.query<{ direction: string; email_type: string; subject: string; body: string; sent_at: Date }>(
    `SELECT 'outbound' AS direction, email_type, subject, body, sent_at
     FROM sent_emails
     WHERE workspace_slug = $1 AND lead_email = $2`,
    [workspaceSlug, reply.lead_email]
  );
  const inboundResult = await pool.query<{ direction: string; email_type: string; subject: string; body: string; sent_at: Date }>(
    `SELECT 'inbound' AS direction, 'lead_reply' AS email_type, subject, message AS body, received_at AS sent_at
     FROM replies
     WHERE workspace_slug = $1 AND lead_email = $2 AND id != $3
     ORDER BY received_at ASC`,
    [workspaceSlug, reply.lead_email, replyId]
  );

  const allMessages = [...outboundResult.rows, ...inboundResult.rows]
    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

  const threadHistory = allMessages.length > 0
    ? allMessages.map((e, i) => {
        const label = e.direction === "inbound" ? "LEAD" : `US (${e.email_type})`;
        return `--- Message ${i + 1} [${label}, ${new Date(e.sent_at).toISOString().slice(0, 10)}] ---\nSubject: ${e.subject}\n${e.body}`;
      }).join("\n\n")
    : "No prior messages on record for this lead.";

  const alternateSenderWarning = detectAlternateSender(reply.message, reply.lead_email);

  // Mandate pre-match: identify the correct teaser before calling Claude so it
  // never picks the wrong mandate or forgets to include the teaser link.
  const matchedMandate = matchMandate(clientFile, reply.campaign ?? "", reply.message ?? "");
  const mandateNote = matchedMandate
    ? `MANDATE MATCH: Based on the campaign and lead message, the correct mandate for this reply is "${matchedMandate.name}". Teaser: ${matchedMandate.teaser}${matchedMandate.calendly ? `. Calendly: ${matchedMandate.calendly}` : ""}. Always use this teaser and Calendly link when replying to this lead — do not use a different mandate's links.`
    : "";

  // Lead intelligence: extract structured context from their message and signature
  // so Claude has real information about who this person is without any external API.
  const leadIntelligence = extractLeadIntelligence(
    reply.message ?? "",
    reply.lead_name ?? "",
    reply.lead_email ?? "",
    reply.lead_company ?? null,
    reply.lead_title ?? null
  );

  const userMessage = `CLIENT WORKSPACE: ${workspaceSlug}

CLIENT FILE:
${clientFile}

FULL THREAD HISTORY (all messages with this lead, oldest first — includes both our outgoing emails and their inbound replies):
${threadHistory}

INBOUND LEAD REPLY (the message you are now responding to):
Lead name: ${reply.lead_name}
Lead company: ${reply.lead_company ?? "unknown"}
Lead title: ${reply.lead_title ?? "unknown"}
Campaign: ${reply.campaign}
Subject: ${reply.subject}
Lead email on record: ${reply.lead_email}
${leadIntelligence ? `\n${leadIntelligence}\n` : ""}${mandateNote ? `\n${mandateNote}\n` : ""}${alternateSenderWarning ? `\n${alternateSenderWarning}\n` : ""}
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

  // Two-pass quality check: Haiku critiques the draft, Sonnet revises if issues found.
  // Only runs on auto_send drafts — no point critiquing manual or do_nothing decisions.
  // Haiku call costs ~$0.001. Sonnet revision only fires when Haiku finds real issues.
  if (result.action === "auto_send" && result.reply_body) {
    const senderContext = `Sender is writing as themselves in first person (workspace: ${workspaceSlug})`;
    const critique = await critiqueDraft(
      result.reply_body,
      reply.message ?? "",
      reply.lead_name ?? "",
      senderContext
    );
    if (critique) {
      console.log(`[auto-reply] Haiku critique for ${replyId}: ${critique}`);
      const revised = await reviseDraft(result.reply_body, critique, systemPrompt, userMessage);
      if (revised) {
        const revisedClean = sanitizeDashes(revised);
        // Only use revision if it is at least as long as the original — never downgrade
        const revisedWithoutSig = revisedClean.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
        if (revisedWithoutSig.length >= 80) {
          result.reply_body = revisedClean;
          console.log(`[auto-reply] Reply revised based on critique for ${replyId}`);
        } else {
          console.warn(`[auto-reply] Revised body too short (${revisedWithoutSig.length} chars) — keeping original for ${replyId}`);
        }
      }
    }
  }

  // Guard: if reply_body is suspiciously short after removing the signature placeholder,
  // route to manual instead of sending an incomplete reply to the lead.
  if (result.action === "auto_send" && result.reply_body) {
    const bodyWithoutSignature = result.reply_body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    if (bodyWithoutSignature.length < 80) {
      console.warn(`[auto-reply] reply_body too short (${bodyWithoutSignature.length} chars) for ${replyId} — routing to manual`);
      result.action = "manual";
      result.manual_reason = "Generated reply body was too short (possible LLM output issue). Needs manual review before sending.";
    }
  }

  // Guard: {SENDER_EMAIL_SIGNATURE} must be present in every outgoing body.
  // If Claude dropped it, append it rather than sending a signatureless email.
  if (result.action === "auto_send" && result.reply_body) {
    if (!/\{SENDER_EMAIL_SIGNATURE\}/i.test(result.reply_body)) {
      console.warn(`[auto-reply] reply_body missing signature placeholder for ${replyId} — appending`);
      result.reply_body = result.reply_body.trimEnd() + "\n\n{SENDER_EMAIL_SIGNATURE}";
    }
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

    // Complex thread gate: if the lead has had 3+ prior exchanges with us, force
    // approval regardless of quota. Multi-turn threads require human judgment —
    // the situation has evolved and a templated or quota-bypassed auto-reply risks
    // being contextually wrong (as seen with Nic).
    const priorExchangeCount = allMessages.length;
    const isComplexThread = priorExchangeCount >= 6; // 3 exchanges = ~6 messages (sent + received each)
    const forceApprovalForComplexity = isComplexThread
      && !ALWAYS_AUTO_SEND.has(result.intent)
      && workspace.auto_reply_approval_mode;

    if (forceApprovalForComplexity) {
      console.log(`[auto-reply] Complex thread (${priorExchangeCount} prior messages) — forcing approval for ${replyId}`);
    }

    // Approval gate: route to #reply-approval only while today's quota (50% of
    // 7-day rolling average) is not yet filled. Once filled, auto-send directly.
    // Unsubscribes, hard nos, hostile, wrong-target, and soft-no closes never go
    // to the approval queue — they send immediately like the old template path did.
    const withinQuota = !ALWAYS_AUTO_SEND.has(result.intent)
      && workspace.auto_reply_approval_mode
      && await shouldRouteToApproval();
    if (withinQuota || forceApprovalForComplexity) {
      result.manual_reason = forceApprovalForComplexity && !withinQuota
        ? `Complex thread (${priorExchangeCount} prior messages) — forced to approval regardless of quota`
        : result.manual_reason;
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
