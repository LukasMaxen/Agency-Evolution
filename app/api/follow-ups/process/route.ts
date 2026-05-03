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

  // Read client file + workflow context. Both define ALL rules.
  // The processor is intentionally rule-free: edit the markdown to change behaviour.
  const clientFile = readFile(path.join(process.cwd(), "clients", `${fu.workspace_slug}.md`));
  const followUpContext = readFile(
    path.join(process.cwd(), "1. Departments", "follow-up-management", "CONTEXT_FollowUps.md")
  );
  const replyContext = readFile(
    path.join(process.cwd(), "1. Departments", "reply-management", "CONTEXT_Replies.md")
  );

  if (!clientFile) {
    return { status: "skipped", reason: "client file missing" };
  }
  if (!followUpContext) {
    return { status: "skipped", reason: "CONTEXT_FollowUps.md missing" };
  }

  const systemPrompt = `You are an email drafter for Maxen Partners. Your only job is to draft one follow-up email for one lead.

All rules, step purposes, tone, examples, and process live in the two context files below. Read them, then draft the email per the rules they define.

OUTPUT FORMAT (the only thing this prompt enforces directly):
Return a single JSON object and nothing else. Start with "{" and end with "}". No preamble, no markdown fences, no thinking aloud, no commentary. The shape:

{
  "subject": "short subject line, no Re: prefix",
  "body": "full email body, plain text, greeting on its own line, blank line between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. No subject line inside the body."
}

WHICH STEP TO DRAFT:
Sequence type: ${fu.fu_sequence_type}
Step to draft: FU${nextStep} of ${fu.total_emails}

Apply the step purpose from CONTEXT_FollowUps.md that matches the sequence type and step number above. Apply all tone, formatting, and content rules from both context files. The user message contains the client GTM brief, the lead's data, and every email we have already sent in this thread.

=== CONTEXT_FollowUps.md ===
${followUpContext}

=== CONTEXT_Replies.md (cross-cutting tone, formatting, content rules apply to FUs too) ===
${replyContext}`;

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

PREVIOUS EMAILS WE SENT (the lead has read these and not replied back, do not repeat any angles or greetings):
${prevBodies.length > 0 ? prevBodies.map((b, i) => `=== Email ${i + 1}${i === 0 ? " (our first response to their reply)" : ` (FU step ${i})`} ===\n${b}`).join("\n\n") : "(none on record, but assume our cold email reached them and they replied to it)"}

Draft FU step ${nextStep} now.`;

  const draft = await callClaude(systemPrompt, userMessage);

  if (!draft) {
    return { status: "failed", reason: "claude error" };
  }

  // Strip any em/en dashes Claude leaked through despite the prompt.
  draft.body = sanitizeDashes(draft.body);
  draft.subject = sanitizeDashes(draft.subject);

  // Approval mode → stage in follow_up_drafts + post to Slack
  if (reply.fu_approval_mode) {
    const draftId = `fud-${fu.id}-${nextStep}-${Date.now()}`;

    const quotedBody = quoteForSlack(draft.body, 2500);

    const inboundPreview = (reply.message ?? "")
      .slice(0, 600)
      .split("\n")
      .map((l: string) => `> ${l}`)
      .join("\n");

    const slackTs = await postToSlackShared({
      channel: FU_APPROVAL_CHANNEL,
      text: `FU step ${nextStep} draft, ${fu.workspace_slug}, ${reply.lead_name}`,
      blocks: [
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
          text: { type: "mrkdwn", text: `*Lead:* ${reply.lead_name}, ${reply.lead_email}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Sequence:* ${fu.fu_sequence_type}  ·  *Step:* ${nextStep}/${fu.total_emails}`,
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
        approvalFooterBlock(),
      ],
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
