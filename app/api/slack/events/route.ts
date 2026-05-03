import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  verifySlackSignature,
  APPROVE_REACTIONS,
  EDIT_APPROVE_REACTIONS,
  REJECT_REACTIONS,
  addReaction,
  postToSlack,
  getSlackUserName,
  sanitizeDashes,
  quoteForSlack,
} from "@/lib/slack-approval";

interface ReplyDraftRow {
  id: string;
  reply_id: string;
  workspace_slug: string;
  lead_name: string | null;
  lead_email: string | null;
  intent: string | null;
  action: string | null;
  fu_sequence_type: "full" | "abbreviated" | "none" | null;
  flag_unsubscribe: boolean;
  flag_meeting_booked: boolean;
  manual_reason: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  slack_ts: string | null;
}

interface FollowUpDraftRow {
  id: string;
  follow_up_id: string;
  reply_id: string;
  workspace_slug: string;
  lead_name: string | null;
  lead_email: string | null;
  fu_step: number;
  subject: string | null;
  body: string;
  status: string;
  slack_ts: string | null;
  total_emails: number;
  fu_sequence_type: "full" | "abbreviated" | "none";
  email_bison_api_key: string | null;
  email_bison_instance_url: string | null;
}

function linkifyHtml(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function bodyToHtml(body: string): string {
  return body
    .split("\n\n")
    .map(para => `<p style="margin:0 0 16px 0;">${linkifyHtml(para.replace(/\n/g, "<br>"))}</p>`)
    .join("");
}

async function sendViaEmailBison(
  reply: { email_bison_reply_id: string | null; sender_email_id: string | null; lead_name: string | null; lead_email: string | null; to_email: string | null },
  apiKey: string,
  instanceUrl: string,
  body: string
): Promise<boolean> {
  if (!reply.email_bison_reply_id || !reply.sender_email_id || !apiKey || !instanceUrl) {
    console.error("[slack-events] Missing EmailBison fields, cannot send");
    return false;
  }
  // Always send to the lead's email. reply.to_email is the address THE LEAD sent
  // their reply TO (our sender), not where we should reply BACK to.
  const toEmails = [
    {
      name: reply.lead_name ?? null,
      email_address: reply.lead_email,
    },
  ];
  const response = await fetch(
    `${instanceUrl}/api/replies/${reply.email_bison_reply_id}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: bodyToHtml(body),
        sender_email_id: reply.sender_email_id,
        to_emails: toEmails,
        inject_previous_email_body: true,
        content_type: "html",
      }),
    }
  );
  if (!response.ok) {
    console.error("[slack-events] EmailBison error:", response.status, await response.text());
    return false;
  }
  return true;
}

// ─── Reply draft handlers ──────────────────────────────────────────────────────

async function approveReplyDraft(draft: ReplyDraftRow, slackUserId: string, channel: string, ts: string): Promise<void> {
  // Pull reply + workspace creds
  const replyResult = await pool.query(
    `SELECT r.*, w.email_bison_api_key, w.email_bison_instance_url
     FROM replies r JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [draft.reply_id]
  );
  if (replyResult.rows.length === 0) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Reply not found, cannot send.",
    });
    return;
  }
  const reply = replyResult.rows[0];

  if (!draft.body) {
    await postToSlack({ channel, threadTs: ts, text: "Draft body missing, cannot send." });
    return;
  }

  const sent = await sendViaEmailBison(
    reply,
    reply.email_bison_api_key,
    reply.email_bison_instance_url,
    draft.body
  );
  if (!sent) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "EmailBison send failed. Draft kept in pending state for another try.",
    });
    return;
  }

  const sentId = `auto-${draft.reply_id}-${Date.now()}`;
  await pool.query(
    `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
     VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
    [sentId, draft.reply_id, draft.workspace_slug, reply.lead_email, reply.lead_name, reply.subject ?? "", draft.body]
  );

  await pool.query(
    `UPDATE replies SET status = 'replied', interested = $1, ai_analysis = jsonb_set(COALESCE(ai_analysis, '{}'::jsonb), '{auto_replied}', 'true'::jsonb), ai_analyzed_at = NOW() WHERE id = $2`,
    [
      ["interested", "interested_urgent", "needs_info"].includes(draft.intent ?? "") ? true : null,
      draft.reply_id,
    ]
  );

  await pool.query(
    `UPDATE reply_drafts SET status = 'sent', sent_at = NOW(), reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );

  // Now create the FU record (only after approved + sent)
  if (draft.fu_sequence_type && draft.fu_sequence_type !== "none" && !draft.flag_meeting_booked && !draft.flag_unsubscribe) {
    const totalEmails = draft.fu_sequence_type === "abbreviated" ? 2 : 5;
    const fuId = `fu-${draft.reply_id}-${Date.now()}`;
    await pool.query(
      `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
       SELECT $1, $2, $3, $4, $5, NOW(), 0, $6, $7, FALSE, NOW() + INTERVAL '2 days'
       WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
      [fuId, draft.reply_id, draft.workspace_slug, draft.lead_name, draft.lead_email, totalEmails, draft.fu_sequence_type]
    );
  }

  await addReaction(channel, ts, "outbox_tray");
  console.log(`[slack-events] Approved + sent reply draft ${draft.id}`);
}

async function rejectReplyDraft(draft: ReplyDraftRow, slackUserId: string, channel: string, ts: string): Promise<void> {
  await pool.query(
    `UPDATE reply_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );
  await pool.query(
    `UPDATE replies SET status = 'new' WHERE id = $1`,
    [draft.reply_id]
  );
  await addReaction(channel, ts, "wastebasket");
  console.log(`[slack-events] Rejected reply draft ${draft.id}`);
}

// ─── Follow-up draft handlers ──────────────────────────────────────────────────

async function approveFollowUpDraft(draft: FollowUpDraftRow, slackUserId: string, channel: string, ts: string): Promise<void> {
  // Pull reply for sender info + recipient
  const replyResult = await pool.query(
    `SELECT * FROM replies WHERE id = $1`,
    [draft.reply_id]
  );
  if (replyResult.rows.length === 0 || !draft.email_bison_api_key || !draft.email_bison_instance_url) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Reply or workspace creds missing, cannot send.",
    });
    return;
  }
  const reply = replyResult.rows[0];

  const sent = await sendViaEmailBison(
    reply,
    draft.email_bison_api_key,
    draft.email_bison_instance_url,
    draft.body
  );
  if (!sent) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "EmailBison send failed. Draft kept in pending state.",
    });
    return;
  }

  const sentId = `fu-${draft.follow_up_id}-${draft.fu_step}-${Date.now()}`;
  await pool.query(
    `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
     VALUES ($1,$2,$3,$4,$5,'follow_up',$6,$7,NOW())`,
    [sentId, draft.reply_id, draft.workspace_slug, reply.lead_email, reply.lead_name, draft.subject ?? "", draft.body]
  );

  // Advance the follow_ups row
  const isFinal = draft.fu_step >= draft.total_emails;
  await pool.query(
    `UPDATE follow_ups
       SET fu_step = $1,
           last_fu_sent_at = NOW(),
           next_fu_due = $2,
           outcome = $3
     WHERE id = $4`,
    [
      draft.fu_step,
      isFinal ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isFinal ? "exhausted" : null,
      draft.follow_up_id,
    ]
  );

  await pool.query(
    `UPDATE follow_up_drafts SET status = 'sent', sent_at = NOW(), reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );

  await addReaction(channel, ts, "outbox_tray");
  console.log(`[slack-events] Approved + sent FU draft ${draft.id}`);
}

async function rejectFollowUpDraft(draft: FollowUpDraftRow, slackUserId: string, channel: string, ts: string): Promise<void> {
  // Skip this step but keep the sequence alive: advance fu_step without sending, schedule next.
  const isFinal = draft.fu_step >= draft.total_emails;
  await pool.query(
    `UPDATE follow_ups
       SET fu_step = $1,
           next_fu_due = $2,
           outcome = $3
     WHERE id = $4`,
    [
      draft.fu_step,
      isFinal ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isFinal ? "exhausted" : null,
      draft.follow_up_id,
    ]
  );
  await pool.query(
    `UPDATE follow_up_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );
  await addReaction(channel, ts, "wastebasket");
  console.log(`[slack-events] Rejected FU draft ${draft.id}`);
}

// ─── Reaction handler ──────────────────────────────────────────────────────────

async function handleReactionAdded(event: any): Promise<void> {
  const reaction: string = event.reaction;
  const ts: string = event.item?.ts;
  const channel: string = event.item?.channel;
  const userId: string = event.user;

  if (!ts || !channel) return;

  // Ignore the bot's own reactions (we add confirmations like outbox_tray, eyes).
  if (event.bot_id) return;

  const isApprove = APPROVE_REACTIONS.has(reaction);
  const isEditApprove = EDIT_APPROVE_REACTIONS.has(reaction);
  const isReject = REJECT_REACTIONS.has(reaction);
  if (!isApprove && !isEditApprove && !isReject) return;

  // Resolve the Slack user ID to a display name once. Falls back to ID if lookup fails.
  const userName = await getSlackUserName(userId);

  // Try reply_drafts first
  const rd = await pool.query<ReplyDraftRow>(
    `SELECT * FROM reply_drafts WHERE slack_ts = $1 AND status = 'pending' LIMIT 1`,
    [ts]
  );
  if (rd.rows.length > 0) {
    const draft = rd.rows[0];
    if (isApprove) await approveReplyDraft(draft, userName, channel, ts);
    else if (isEditApprove) await regenerateReplyDraft(draft, userName, channel, ts);
    else await rejectReplyDraft(draft, userName, channel, ts);
    return;
  }

  // Try follow_up_drafts
  const fud = await pool.query<FollowUpDraftRow>(
    `SELECT fud.*, fu.total_emails, fu.fu_sequence_type,
            w.email_bison_api_key, w.email_bison_instance_url
     FROM follow_up_drafts fud
     JOIN follow_ups fu ON fu.id = fud.follow_up_id
     JOIN workspaces w ON w.slug = fud.workspace_slug
     WHERE fud.slack_ts = $1 AND fud.status = 'pending' LIMIT 1`,
    [ts]
  );
  if (fud.rows.length > 0) {
    const draft = fud.rows[0];
    if (isApprove) await approveFollowUpDraft(draft, userName, channel, ts);
    else if (isEditApprove) await regenerateFollowUpDraft(draft, userName, channel, ts);
    else await rejectFollowUpDraft(draft, userName, channel, ts);
  }
}

/**
 * Pulls every thread feedback message left on a draft card (oldest first).
 * Returns empty array if no feedback exists.
 */
async function getThreadFeedback(parentTs: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT message_text FROM draft_feedback
     WHERE parent_slack_ts = $1
     ORDER BY created_at ASC`,
    [parentTs]
  );
  return result.rows
    .map(r => (r.message_text as string)
      .replace(/<@[A-Z0-9]+>/g, "")
      .replace(/<#[A-Z0-9]+\|[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim())
    .filter(t => t.length > 0);
}

function readContextFile(rel: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), rel), "utf-8");
  } catch {
    return "";
  }
}

interface RegenResult {
  body: string;
  subject?: string;
}

async function regenerateViaClaude(systemPrompt: string, userMessage: string): Promise<RegenResult | null> {
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
    console.error("[slack-events] Claude regenerate error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(raw) as RegenResult;
  } catch {
    console.error("[slack-events] regenerate JSON parse failed:", raw);
    return null;
  }
}

async function regenerateReplyDraft(draft: ReplyDraftRow, reviewerName: string, channel: string, ts: string): Promise<void> {
  const feedback = await getThreadFeedback(ts);
  if (feedback.length === 0) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "No feedback found in this thread. Add a comment with what to change, then react :pencil2: again.",
    });
    return;
  }

  // Pull the original lead reply for full context
  const replyResult = await pool.query(
    `SELECT * FROM replies WHERE id = $1`,
    [draft.reply_id]
  );
  if (replyResult.rows.length === 0) return;
  const reply = replyResult.rows[0];

  const clientFile = readContextFile(`clients/${draft.workspace_slug}.md`);
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);

  const systemPrompt = `You are revising a drafted first-response email for Maxen Partners based on human feedback. Apply the feedback to produce a new draft.

OUTPUT FORMAT (strict): a single JSON object, no preamble, no fences. Shape:
{
  "subject": "short subject line, no Re: prefix (or keep the existing one if not changed)",
  "body": "full revised email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. Plain text only."
}

Apply the human feedback as the priority. Keep what is already good in the original draft. Honour every rule in CONTEXT_Replies.md (tone, formatting, no dashes, no colons in body, banned phrases, booking prompt format, etc).

If the human feedback contradicts a rule in CONTEXT_Replies.md, follow the feedback (humans are training the system).

=== CONTEXT_Replies.md ===
${replyContext}`;

  const userMessage = `CLIENT WORKSPACE: ${draft.workspace_slug}

CLIENT FILE:
${clientFile}

LEAD:
Name: ${reply.lead_name}
Company: ${reply.lead_company ?? "unknown"}
Title: ${reply.lead_title ?? "unknown"}

ORIGINAL LEAD REPLY:
${reply.message}

CURRENT DRAFT (subject: ${draft.subject ?? ""}):
${draft.body ?? ""}

HUMAN FEEDBACK (most recent last):
${feedback.map((f, i) => `[${i + 1}] ${f}`).join("\n\n")}

Produce the revised draft now.`;

  const regen = await regenerateViaClaude(systemPrompt, userMessage);
  if (!regen?.body) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Could not regenerate the draft (Claude error). Try again or paste the full revised email and react :pencil2:.",
    });
    return;
  }

  const newBody = sanitizeDashes(regen.body);
  const newSubject = regen.subject ? sanitizeDashes(regen.subject) : draft.subject;

  await pool.query(
    `UPDATE reply_drafts SET body = $1, subject = $2 WHERE id = $3`,
    [newBody, newSubject, draft.id]
  );

  await postToSlack({
    channel,
    threadTs: ts,
    text: `Regenerated by ${reviewerName}, react :white_check_mark: on the card to send, or comment + :pencil2: again to iterate.\n\n*New subject:* ${newSubject}\n\n*New body:*\n${quoteForSlack(newBody, 2500)}`,
  });
}

async function regenerateFollowUpDraft(draft: FollowUpDraftRow, reviewerName: string, channel: string, ts: string): Promise<void> {
  const feedback = await getThreadFeedback(ts);
  if (feedback.length === 0) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "No feedback found in this thread. Add a comment with what to change, then react :pencil2: again.",
    });
    return;
  }

  const replyResult = await pool.query(
    `SELECT * FROM replies WHERE id = $1`,
    [draft.reply_id]
  );
  if (replyResult.rows.length === 0) return;
  const reply = replyResult.rows[0];

  const prevSent = await pool.query(
    `SELECT body FROM sent_emails WHERE reply_id = $1 AND email_type IN ('follow_up','auto_reply') ORDER BY sent_at ASC`,
    [draft.reply_id]
  );
  const prevBodies = prevSent.rows.map(r => r.body).filter(Boolean);

  const clientFile = readContextFile(`clients/${draft.workspace_slug}.md`);
  const fuContext = readContextFile(`1. Departments/follow-up-management/CONTEXT_FollowUps.md`);
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);

  const systemPrompt = `You are revising a drafted follow-up email for Maxen Partners based on human feedback. Apply the feedback to produce a new draft.

OUTPUT FORMAT (strict): a single JSON object, no preamble, no fences. Shape:
{
  "subject": "short subject line, no Re: prefix (or keep existing if not changed)",
  "body": "full revised email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line."
}

This is a follow-up, NOT a first response. The lead has already received our previous emails (listed below) and not replied. Apply the human feedback as the priority. Honour all rules in the context files.

=== CONTEXT_FollowUps.md ===
${fuContext}

=== CONTEXT_Replies.md (cross-cutting tone and formatting) ===
${replyContext}`;

  const userMessage = `CLIENT WORKSPACE: ${draft.workspace_slug}

CLIENT FILE:
${clientFile}

LEAD:
Name: ${reply.lead_name}
Company: ${reply.lead_company ?? "unknown"}
Title: ${reply.lead_title ?? "unknown"}

ORIGINAL LEAD REPLY:
${reply.message}

PREVIOUSLY SENT EMAILS (do not repeat these angles):
${prevBodies.length > 0 ? prevBodies.map((b, i) => `=== Email ${i + 1} ===\n${b}`).join("\n\n") : "(none on record)"}

CURRENT FU DRAFT (step ${draft.fu_step} of ${draft.total_emails}, subject: ${draft.subject ?? ""}):
${draft.body}

HUMAN FEEDBACK (most recent last):
${feedback.map((f, i) => `[${i + 1}] ${f}`).join("\n\n")}

Produce the revised follow-up draft now.`;

  const regen = await regenerateViaClaude(systemPrompt, userMessage);
  if (!regen?.body) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Could not regenerate the FU draft (Claude error). Try again or paste the full revised email and react :pencil2:.",
    });
    return;
  }

  const newBody = sanitizeDashes(regen.body);
  const newSubject = regen.subject ? sanitizeDashes(regen.subject) : draft.subject;

  await pool.query(
    `UPDATE follow_up_drafts SET body = $1, subject = $2 WHERE id = $3`,
    [newBody, newSubject, draft.id]
  );

  await postToSlack({
    channel,
    threadTs: ts,
    text: `Regenerated by ${reviewerName}, react :white_check_mark: on the card to send, or comment + :pencil2: again to iterate.\n\n*New subject:* ${newSubject}\n\n*New body:*\n${quoteForSlack(newBody, 2500)}`,
  });
}

// ─── Thread message handler (feedback capture) ─────────────────────────────────

async function handleThreadMessage(event: any): Promise<void> {
  // Skip bot messages and edits
  if (event.subtype === "bot_message" || event.bot_id) return;
  if (event.subtype === "message_changed" || event.subtype === "message_deleted") return;

  const parentTs: string | undefined = event.thread_ts;
  const text: string = event.text ?? "";
  const userId: string = event.user;
  const ts: string = event.ts;
  const channel: string = event.channel;

  if (!parentTs || parentTs === ts) return; // not a thread reply
  if (!text.trim()) return;

  // Find the draft by parent ts
  let draftType: "reply" | "follow_up" | null = null;
  let draftId: string | null = null;
  let workspaceSlug: string | null = null;

  const rd = await pool.query(
    `SELECT id, workspace_slug FROM reply_drafts WHERE slack_ts = $1 LIMIT 1`,
    [parentTs]
  );
  if (rd.rows.length > 0) {
    draftType = "reply";
    draftId = rd.rows[0].id;
    workspaceSlug = rd.rows[0].workspace_slug;
  } else {
    const fud = await pool.query(
      `SELECT id, workspace_slug FROM follow_up_drafts WHERE slack_ts = $1 LIMIT 1`,
      [parentTs]
    );
    if (fud.rows.length > 0) {
      draftType = "follow_up";
      draftId = fud.rows[0].id;
      workspaceSlug = fud.rows[0].workspace_slug;
    }
  }

  if (!draftType || !draftId) return; // not on a draft thread

  const userName = await getSlackUserName(userId);
  const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await pool.query(
    `INSERT INTO draft_feedback
       (id, draft_type, draft_id, workspace_slug, slack_user_id, slack_user_name, message_text, action, slack_ts, parent_slack_ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'feedback',$8,$9)`,
    [feedbackId, draftType, draftId, workspaceSlug, userId, userName, text, ts, parentTs]
  );

  await addReaction(channel, ts, "memo");
  console.log(`[slack-events] Captured feedback ${feedbackId} on ${draftType} ${draftId}`);
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // URL verification challenge from Slack during initial setup.
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify signature for actual events.
  const signature = req.headers.get("x-slack-signature") ?? "";
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  if (!event) return NextResponse.json({ ok: true });

  try {
    if (event.type === "reaction_added") {
      await handleReactionAdded(event);
    } else if (event.type === "message") {
      await handleThreadMessage(event);
    }
  } catch (err: any) {
    console.error("[slack-events] handler error:", err);
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk Slack events" });
}
