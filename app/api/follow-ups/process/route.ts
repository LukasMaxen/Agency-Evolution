import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  FU_APPROVAL_CHANNEL,
  postToSlack as postToSlackShared,
  approvalFooterBlock,
  quoteForSlack,
  slugToName,
  sanitizeDashes,
} from "@/lib/slack-approval";
import {
  daysUntilNextStep,
} from "@/lib/template-replies";

// Shared with auto-reply processor: extract structured lead intelligence from
// their message and signature so the FU drafter has real context about who they are.
function extractLeadIntelligence(message: string, leadEmail: string): string {
  if (!message) return "";
  const lines = message.split("\n").map(l => l.trim()).filter(Boolean);
  const intel: string[] = [];
  const domain = leadEmail.split("@")[1] ?? "";
  if (domain && !["gmail","yahoo","hotmail","outlook"].some(d => domain.includes(d))) {
    intel.push(`Company domain: ${domain}`);
  }
  const urls = message.match(/https?:\/\/(?!calendly|linkedin|twitter|facebook|instagram|tiktok|youtube|google|aka\.ms)[^\s\]>)]+/g) ?? [];
  if (urls.length > 0) intel.push(`Company website(s): ${[...new Set(urls)].slice(0,2).join(", ")}`);
  const selfDesc = lines.filter(l =>
    /^(we (are|work|help|focus|specialize|operate)|our (company|firm|fund|team|business)|i (am|work|run|represent))/i.test(l) && l.length > 20 && l.length < 300
  );
  if (selfDesc.length > 0) intel.push(`Lead's self-description: ${selfDesc.slice(0,2).join(" | ")}`);
  if (intel.length === 0) return "";
  return `LEAD INTELLIGENCE:\n${intel.join("\n")}`;
}

// Haiku critic for FU drafts — same quality gate as the auto-reply processor.
async function critiqueFuDraft(draft: string, originalReply: string, workspace: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: `You are a quality checker for follow-up cold emails. Check the draft and output "PASS" if it is good, or a short list of issues (2-3 words each) if not.

Checklist:
1. Is it written in first person? (never "Nicklas works with", always "I work with")
2. Does it bring a new angle not visible in the original reply context?
3. Is it free of AI filler? ("Sounds great", "I'd love to", "Excited to show you")
4. Is it appropriately concise — not padded?
5. Does it NOT confirm availability or suggest specific time slots?
6. Does it end with {SENDER_EMAIL_SIGNATURE}?

Output only "PASS" or a short issues list. Nothing else.`,
        messages: [{ role: "user", content: `Original lead reply:\n${originalReply.slice(0,400)}\n\nFU draft:\n${draft}\n\nCheck now.` }],
      }),
      signal: controller.signal,
    });
  } catch { return null; } finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const data = await response.json();
  const result = (data.content?.[0]?.text ?? "").trim();
  return result.toUpperCase().startsWith("PASS") ? null : (result || null);
}

interface FollowUpRow {
  id: string;
  reply_id: string;
  workspace_slug: string;
  lead_name: string;
  lead_email: string;
  fu_step: number;
  total_emails: number;
  fu_sequence_type: "full" | "abbreviated";
  next_fu_due: string;
}

interface DraftResult {
  subject: string;
  body: string;
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}


async function callClaude(systemPrompt: string, userMessage: string): Promise<DraftResult | null> {
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
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error("[fu-process] Claude API call timed out after 90s");
    } else {
      console.error("[fu-process] Claude API fetch error:", err?.message ?? err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.error("[fu-process] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean) as DraftResult;
  } catch {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.slice(firstBrace, lastBrace + 1)) as DraftResult;
      } catch { /* fall through */ }
    }
    console.error("[fu-process] Failed to parse Claude response:", raw.slice(0, 500));
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
    console.error("[fu-process] Missing EmailBison fields for reply", reply.id);
    return false;
  }

  // Recipient resolution: prefer override (set when forward/redirect was detected
  // by the auto-reply processor), fall back to lead's email. Never use to_email,
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
    console.error("[fu-process] EmailBison error:", ebResponse.status, await ebResponse.text());
    return false;
  }
  return true;
}

async function processOne(fu: FollowUpRow): Promise<{ status: string; reason?: string }> {
  const nextStep = fu.fu_step + 1;

  // Sequence exhausted — mark and stop
  if (nextStep > fu.total_emails) {
    await pool.query(
      `UPDATE follow_ups SET outcome = 'exhausted', next_fu_due = NULL WHERE id = $1`,
      [fu.id]
    );
    return { status: "exhausted" };
  }

  // Fetch the original reply + workspace credentials
  const replyResult = await pool.query(
    `SELECT r.*, w.email_bison_api_key, w.email_bison_instance_url, w.fu_approval_mode
     FROM replies r
     JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [fu.reply_id]
  );
  if (replyResult.rows.length === 0) {
    return { status: "skipped", reason: "reply not found" };
  }
  const reply = replyResult.rows[0];

  // Pull full thread: all outgoing emails + any subsequent inbound replies from the lead.
  // Including manual replies and inbound replies prevents Claude from repeating angles
  // already covered or ignoring things the lead has said since the sequence started.
  const prevSent = await pool.query(
    `SELECT 'outbound' AS direction, email_type, body, sent_at
     FROM sent_emails
     WHERE reply_id = $1
       AND email_type IN ('follow_up', 'auto_reply', 'reply')
     UNION ALL
     SELECT 'inbound' AS direction, 'lead_reply' AS email_type, message AS body, received_at AS sent_at
     FROM replies
     WHERE workspace_slug = $2 AND lead_email = $3 AND id != $1
     ORDER BY sent_at ASC`,
    [fu.reply_id, fu.workspace_slug, fu.lead_email]
  );
  const prevBodies = prevSent.rows
    .map(r => {
      const label = r.direction === "inbound" ? "[LEAD REPLIED]" : `[US — ${r.email_type}]`;
      return `${label}\n${r.body}`;
    })
    .filter(Boolean);

  // Slug aliases: some workspaces share a client file (eg internal-campaigns → agency-evolution).
  const CLIENT_FILE_ALIASES: Record<string, string> = { "internal-campaigns": "agency-evolution" };
  const fileSlug = CLIENT_FILE_ALIASES[fu.workspace_slug] ?? fu.workspace_slug;

  // ── Intent pre-check: kill the sequence if the lead's stored ai_analysis
  // shows a hard close. This prevents FU drafts firing on leads who already said
  // hard no, unsubscribe, or wrong target — regardless of what fu_sequence_type
  // was set at the time of the original reply.
  const closedIntents = new Set(["hard_no", "unsubscribe", "wrong_target", "hostile"]);
  const storedIntent = (reply.ai_analysis as any)?.intent ?? "";
  if (closedIntents.has(storedIntent)) {
    await pool.query(
      `UPDATE follow_ups SET next_fu_due = NULL, outcome = 'closed_on_intent' WHERE id = $1`,
      [fu.id]
    );
    console.log(`[fu-process] Killing FU sequence ${fu.id} — stored intent is ${storedIntent}`);
    return { status: "skipped", reason: `closed intent: ${storedIntent}` };
  }

  // Also do a quick regex check on the original reply text for clear opt-outs
  // that might have been misclassified at time of first reply.
  const replyText = (reply.message ?? "").toLowerCase();
  // ABSOLUTE RULE (2026-05-13): Never send a FU to any not-interested lead.
  // No exceptions. No soft reframes. No step-back emails. Nothing. Stop and close.
  const optOutSignals = [
    /\bno thank(s| you)\b/, /\bnot interested\b/, /\bremove me\b/, /\bunsubscribe\b/,
    /\bdo not contact\b/, /\bstop emailing\b/, /\bhard pass\b/, /\bpass\b/,
    /\bnot relevant\b/, /\bnot in our charter\b/, /\bnot in our mandate\b/,
    /\bnot something we (are|need)\b/, /\bwe are all set\b/, /\ball set\b/,
    /\bnot for (us|me|now)\b/, /\bno interest\b/, /\bnot the right fit\b/,
    /\bnot looking (to sell|at selling|for)\b/, /\btake a pass\b/,
  ];
  if (optOutSignals.some(p => p.test(replyText))) {
    await pool.query(
      `UPDATE follow_ups SET next_fu_due = NULL, outcome = 'closed_on_intent' WHERE id = $1`,
      [fu.id]
    );
    console.log(`[fu-process] Killing FU sequence ${fu.id} — opt-out signal in reply text`);
    return { status: "skipped", reason: "opt-out signal in original reply" };
  }

  // FU drafts only need the FU-specific context + client file.
  // SKILL_Reply-Management and CONTEXT_Replies are for first replies only —
  // loading them here burns ~30k tokens per call for zero benefit.
  const clientFile = readFile(path.join(process.cwd(), "clients", `${fileSlug}.md`));
  const followUpSkill = readFile(
    path.join(process.cwd(), "1. Departments", "follow-up-management", "SKILL_FollowUps.md")
  );
  const followUpContext = readFile(
    path.join(process.cwd(), "1. Departments", "follow-up-management", "CONTEXT_FollowUps.md")
  );

  if (!clientFile) {
    return { status: "skipped", reason: "client file missing" };
  }
  if (!followUpContext) {
    return { status: "skipped", reason: "CONTEXT_FollowUps.md missing" };
  }

  const systemPrompt = `You are the follow-up email drafter for Maxen Partners. Draft a follow-up that reads like a real person who carefully read the full thread — not a template, not a nudge.

## RULES (no exceptions)

READ FIRST: client file, SKILL_FollowUps.md, CONTEXT_FollowUps.md, full thread, original reply. In that order.

NEVER DRAFT IF: the lead said anything resembling not interested, no thanks, not relevant, hard pass, remove me, or not the right time. Output {"subject":"","body":""} instead.

NEVER REPEAT: any angle, link, case study, or stat already used in the thread.

FIRST PERSON: never refer to the sender by name. Always "I", "me", "we".

NO DASHES: no em dashes, en dashes, or hyphens as punctuation.

NO AI PHRASES: never use "Sounds great", "I'd love to", "Excited to show you", "Genuinely", "Thrilled", "Straightforward".

NO TIME SLOTS: no calendar access. Only send the Calendly link.

SIGNATURE: end with {SENDER_EMAIL_SIGNATURE} on its own line. No name or "Best" before it.

BLANK LINES between every paragraph.

MATCH TONE: short reply from lead = short FU. Formal lead = formal FU.

SEQUENCE: ${fu.fu_sequence_type} — step ${nextStep} of ${fu.total_emails}
Apply the step purpose from CONTEXT_FollowUps.md for this step.

## OUTPUT

Return only a JSON object — no preamble, no fences.
{"subject":"...","body":"..."}

=== SKILL_FollowUps.md ===
${followUpSkill}

=== CONTEXT_FollowUps.md ===
${followUpContext}`;

  const leadIntelligence = extractLeadIntelligence(reply.message ?? "", reply.lead_email ?? "");

  const userMessage = `CLIENT WORKSPACE: ${fu.workspace_slug}

CLIENT FILE:
${clientFile}

LEAD:
Name: ${reply.lead_name}
Company: ${reply.lead_company ?? "unknown"}
Title: ${reply.lead_title ?? "unknown"}
Email: ${reply.lead_email}
${leadIntelligence ? `\n${leadIntelligence}\n` : ""}
ORIGINAL REPLY (the one that started this sequence):
${reply.message}

FULL THREAD — ALL EMAILS SENT AND RECEIVED (do not repeat any angle, link, case study, or stat already used):
${prevBodies.length > 0 ? prevBodies.map((b, i) => `=== Message ${i + 1} ===\n${b}`).join("\n\n") : "(none on record)"}

Draft FU step ${nextStep} now.`;

  // Every FU step goes through Sonnet with full context — no templates.
  // Templates produced generic, context-blind drafts that regularly misfired
  // (eg fu-nudge firing after a lead said "No thank you"). Full context is
  // non-negotiable: client file, skill files, full thread, original reply.
  const draft = await callClaude(systemPrompt, userMessage);
  const templateName: string | null = null; // kept for quality-check guard below

  if (!draft) {
    return { status: "failed", reason: "claude error" };
  }

  // Strip any em/en dashes Claude leaked through despite the prompt.
  draft.body = sanitizeDashes(draft.body);
  draft.subject = sanitizeDashes(draft.subject);

  // Guard: reject a body that is too short (truncation risk). Templates exempt.
  if (!templateName) {
    const bodyWithoutSignature = draft.body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    if (bodyWithoutSignature.length < 80) {
      console.warn(`[fu-process] FU body too short (${bodyWithoutSignature.length} chars) for ${fu.workspace_slug} / ${fu.lead_name} step ${nextStep} — skipping`);
      return { status: "failed", reason: "generated body too short, possible truncation" };
    }
  }

  // Daily QA sample: send 2 FU drafts per day to #follow-up-approval regardless
  // of fu_approval_mode, so quality can be monitored without reviewing every email.
  const todayFuApprovalCount = await pool.query<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt
    FROM follow_up_drafts
    WHERE status = 'pending'
      AND (created_at AT TIME ZONE 'America/New_York')::date
          = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  const fuApprovalToday = parseInt(todayFuApprovalCount.rows[0]?.cnt ?? "0", 10);
  let routeToFuApproval = reply.fu_approval_mode || fuApprovalToday < 2;

  // Haiku critique removed — too expensive at scale.

  // Approval mode → stage in follow_up_drafts + post to Slack
  if (routeToFuApproval) {
    const draftId = `fud-${fu.id}-${nextStep}-${Date.now()}`;

    const quotedBody = quoteForSlack(draft.body, 2500);

    const inboundPreview = (reply.message ?? "")
      .slice(0, 600)
      .split("\n")
      .map((l: string) => `> ${l}`)
      .join("\n");

    // EmailBison's inbox URL uses the reply UUID (replies.id), not the integer reply ID.
    const ebLink = reply.id && reply.email_bison_instance_url
      ? `${reply.email_bison_instance_url}/inbox/replies/${reply.id}`
      : null;

    const fuBlocks: object[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `FU step ${nextStep} draft, needs review`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Client:*\n${slugToName(fu.workspace_slug)}` },
          { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Lead:* ${reply.lead_name}, ${reply.lead_email}\n*Sequence:* ${fu.fu_sequence_type}  ·  *Step:* ${nextStep}/${fu.total_emails}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Subject:* ${draft.subject}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Lead's original reply:*\n${inboundPreview}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Drafted follow-up:*\n${quotedBody}` },
      },
    ];

    if (ebLink) {
      fuBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `<${ebLink}|Open reply in EmailBison>` },
      });
    }
    fuBlocks.push(approvalFooterBlock());

    const slackTs = await postToSlackShared({
      channel: FU_APPROVAL_CHANNEL,
      text: `FU step ${nextStep} draft, ${fu.workspace_slug}, ${reply.lead_name}`,
      blocks: fuBlocks,
    });

    await pool.query(
      `INSERT INTO follow_up_drafts
        (id, follow_up_id, reply_id, workspace_slug, lead_name, lead_email, fu_step, subject, body, status, slack_ts, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,NOW())`,
      [draftId, fu.id, fu.reply_id, fu.workspace_slug, reply.lead_name, reply.lead_email, nextStep, draft.subject, draft.body, slackTs]
    );

    // Pause the row until the draft is approved or rejected via Slack reactions.
    // Approval will advance fu_step + reschedule next_fu_due.
    // Rejection will skip this step + reschedule next_fu_due.
    await pool.query(
      `UPDATE follow_ups SET next_fu_due = NULL WHERE id = $1`,
      [fu.id]
    );

    return { status: "drafted_for_review" };
  }

  // Auto-send mode → send via EmailBison directly
  const sent = await sendReplyToEmailBison(reply, draft.body);

  if (!sent) {
    return { status: "failed", reason: "emailbison error" };
  }

  const sentId = `fu-${fu.id}-${nextStep}-${Date.now()}`;
  await pool.query(
    `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
     VALUES ($1,$2,$3,$4,$5,'follow_up',$6,$7,NOW())`,
    [sentId, fu.reply_id, fu.workspace_slug, reply.lead_email, reply.lead_name, draft.subject, draft.body]
  );

  // Advance step + schedule next using the cadence helper
  const isFinalStep = nextStep >= fu.total_emails;
  const gapDays = daysUntilNextStep(fu.fu_sequence_type, nextStep);
  await pool.query(
    `UPDATE follow_ups
       SET fu_step = $1,
           last_fu_sent_at = NOW(),
           next_fu_due = $2
     WHERE id = $3`,
    [nextStep, isFinalStep ? null : new Date(Date.now() + gapDays * 24 * 60 * 60 * 1000), fu.id]
  );

  if (isFinalStep) {
    await pool.query(
      `UPDATE follow_ups SET outcome = 'exhausted' WHERE id = $1`,
      [fu.id]
    );
  }

  return { status: "sent" };
}

// Exported so the in-process scheduler (instrumentation.ts) can call this
// directly without going through HTTP. Keep it pure: no auth, no Response.
export async function runFollowUpProcessorOnce(): Promise<{
  processed: number;
  results: { id: string; status: string; reason?: string }[];
}> {
  const due = await pool.query<FollowUpRow>(
    `SELECT id, reply_id, workspace_slug, lead_name, lead_email, fu_step, total_emails, fu_sequence_type, next_fu_due
     FROM follow_ups
     WHERE next_fu_due IS NOT NULL
       AND next_fu_due <= NOW()
       AND meeting_booked = FALSE
       AND (outcome IS NULL OR outcome NOT IN ('booked','re_engaged','exhausted','unsubscribed','manually_closed','closed','closed_on_intent'))
     ORDER BY next_fu_due ASC
     LIMIT 10`
  );

  const results: { id: string; status: string; reason?: string }[] = [];
  for (let i = 0; i < due.rows.length; i++) {
    const fu = due.rows[i];
    try {
      const result = await processOne(fu);
      results.push({ id: fu.id, ...result });
    } catch (err: any) {
      console.error("[fu-process] error processing", fu.id, err);
      results.push({ id: fu.id, status: "error", reason: err.message });
    }
    // Pacing to stay under Anthropic 30k tokens/min limit.
    if (i < due.rows.length - 1) {
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  return { processed: results.length, results };
}

export async function GET(req: NextRequest) {
  // Open endpoint — no token required. Only processes our own DB rows.

  try {
    const result = await runFollowUpProcessorOnce();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[fu-process] fatal:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
