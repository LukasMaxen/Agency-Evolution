import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import fs from "fs";
import path from "path";

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

const FULL_STEP_PURPOSES: Record<number, string> = {
  1: "Reframe — gentle re-open. Acknowledge their reply, restate the value with a slightly different angle. Short.",
  2: "Social proof — reference a similar client outcome or relevant proof point. Different hook than step 1.",
  3: "Different angle — surface a new pain or motivation. Do NOT repeat any angle from steps 1 or 2.",
  4: "Different problem — focus on a specific operational/financial pain point. New angle from previous steps.",
  5: "Break-up — short, no-pressure final email. 'Closing the loop, happy to revisit later.' Two sentences max.",
};

const ABBREVIATED_STEP_PURPOSES: Record<number, string> = {
  1: "Reframe — gentle re-open after their soft objection. Acknowledge timing, restate value briefly.",
  2: "Break-up — short, no-pressure final email. 'Closing the loop, happy to revisit later.' Two sentences max.",
};

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function slugToName(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function postToSlack(blocks: object[], text: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[fu-process] SLACK_BOT_TOKEN not set — skipping Slack notification");
    return null;
  }
  const channelId = "C0B0MMMMNKZ";
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, text, blocks }),
  });
  const data = await response.json().catch(() => ({}));
  return data?.ts ?? null;
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<DraftResult | null> {
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
    console.error("[fu-process] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean) as DraftResult;
  } catch {
    console.error("[fu-process] Failed to parse Claude response:", raw);
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

  // Pull previous FU bodies so Claude doesn't repeat angles
  const prevSent = await pool.query(
    `SELECT body FROM sent_emails WHERE reply_id = $1 AND email_type IN ('follow_up','auto_reply') ORDER BY sent_at ASC`,
    [fu.reply_id]
  );
  const prevBodies = prevSent.rows.map(r => r.body).filter(Boolean);

  // Read client file + global FU context
  const clientFile = readFile(path.join(process.cwd(), "clients", `${fu.workspace_slug}.md`));
  const contextFile = readFile(
    path.join(process.cwd(), "1. Departments", "reply-management", "CONTEXT_Replies.md")
  );

  if (!clientFile) {
    return { status: "skipped", reason: "client file missing" };
  }

  const stepPurposes = fu.fu_sequence_type === "abbreviated"
    ? ABBREVIATED_STEP_PURPOSES
    : FULL_STEP_PURPOSES;
  const stepPurpose = stepPurposes[nextStep] ?? "Follow-up email.";

  const systemPrompt = `You are a follow-up email writer for Maxen Partners, a cold-email agency for B2B M&A and business services clients.

Draft FU step ${nextStep} of ${fu.total_emails} for this lead. Return ONLY a valid JSON object:

{
  "subject": "short subject line, no Re: prefix",
  "body": "full email body. Greeting (Hi Name,) on its own line, blank line, body paragraphs separated by blank lines, blank line, then {SENDER_EMAIL_SIGNATURE} on its own line. Plain text. No subject line in the body."
}

STEP PURPOSE: ${stepPurpose}

TONE RULES (non-negotiable):
- No em dashes, no en dashes, no double-hyphens. No colons in the email body.
- No bullet points
- No filler phrases ("That's fantastic", "Sounds great!", "I'm excited", "I'd love to", "Thrilled", "Delighted", "Genuinely", "Straightforward")
- Match length to context — shorter is better
- Closings: "Looking forward to speaking with you." or "Looking forward to it." or for break-up "Happy to revisit later."
- Never volunteer pricing/valuation numbers unless explicitly asked
- For interested re-opens, include the client's Calendly link with exactly two suggested time slots

CRITICAL: Do not repeat any angle, hook, or pain point from the previous emails listed below. Each FU must take a fresh angle.

GLOBAL REPLY CONTEXT:
${contextFile}`;

  const userMessage = `CLIENT WORKSPACE: ${fu.workspace_slug}

CLIENT FILE:
${clientFile}

LEAD:
Name: ${reply.lead_name}
Company: ${reply.lead_company ?? "unknown"}
Title: ${reply.lead_title ?? "unknown"}
Email: ${reply.lead_email}

ORIGINAL REPLY (the one that started this sequence):
${reply.message}

PREVIOUS EMAILS WE SENT (do not repeat these angles):
${prevBodies.length > 0 ? prevBodies.map((b, i) => `--- Email ${i + 1} ---\n${b}`).join("\n\n") : "(none — this is the first FU)"}

Draft FU step ${nextStep} now.`;

  const draft = await callClaude(systemPrompt, userMessage);

  if (!draft) {
    return { status: "failed", reason: "claude error" };
  }

  // Approval mode → stage in follow_up_drafts + post to Slack
  if (reply.fu_approval_mode) {
    const draftId = `fud-${fu.id}-${nextStep}-${Date.now()}`;

    const slackTs = await postToSlack(
      [
        {
          type: "header",
          text: { type: "plain_text", text: `📋 FU step ${nextStep} draft — needs review`, emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Client:* ${slugToName(fu.workspace_slug)}\n*Lead:* ${reply.lead_name} — ${reply.lead_email}\n*Sequence:* ${fu.fu_sequence_type} (step ${nextStep}/${fu.total_emails})` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Subject:* ${draft.subject}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Body:*\n\`\`\`${draft.body.slice(0, 2500)}\`\`\`` },
        },
      ],
      `FU step ${nextStep} draft — ${fu.workspace_slug} / ${reply.lead_name}`
    );

    await pool.query(
      `INSERT INTO follow_up_drafts
        (id, follow_up_id, reply_id, workspace_slug, lead_name, lead_email, fu_step, subject, body, status, slack_ts, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,NOW())`,
      [draftId, fu.id, fu.reply_id, fu.workspace_slug, reply.lead_name, reply.lead_email, nextStep, draft.subject, draft.body, slackTs]
    );

    // Don't advance fu_step yet — that happens when the draft is approved/sent.
    // But push next_fu_due forward so we don't redraft this same step every cron tick.
    await pool.query(
      `UPDATE follow_ups SET next_fu_due = NOW() + INTERVAL '1 day' WHERE id = $1`,
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

  // Advance step + schedule next
  const isFinalStep = nextStep >= fu.total_emails;
  await pool.query(
    `UPDATE follow_ups
       SET fu_step = $1,
           last_fu_sent_at = NOW(),
           next_fu_due = $2
     WHERE id = $3`,
    [nextStep, isFinalStep ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), fu.id]
  );

  if (isFinalStep) {
    await pool.query(
      `UPDATE follow_ups SET outcome = 'exhausted' WHERE id = $1`,
      [fu.id]
    );
  }

  return { status: "sent" };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const due = await pool.query<FollowUpRow>(
      `SELECT id, reply_id, workspace_slug, lead_name, lead_email, fu_step, total_emails, fu_sequence_type, next_fu_due
       FROM follow_ups
       WHERE next_fu_due IS NOT NULL
         AND next_fu_due <= NOW()
         AND meeting_booked = FALSE
         AND (outcome IS NULL OR outcome NOT IN ('booked','re_engaged','exhausted','unsubscribed'))
       ORDER BY next_fu_due ASC
       LIMIT 50`
    );

    const results: { id: string; status: string; reason?: string }[] = [];
    for (const fu of due.rows) {
      try {
        const result = await processOne(fu);
        results.push({ id: fu.id, ...result });
      } catch (err: any) {
        console.error("[fu-process] error processing", fu.id, err);
        results.push({ id: fu.id, status: "error", reason: err.message });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (err: any) {
    console.error("[fu-process] fatal:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
