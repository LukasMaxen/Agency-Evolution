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
  getChannelName,
  bareChannelName,
  sanitizeDashes,
  quoteForSlack,
  FEEDBACK_REVIEW_CHANNEL,
} from "@/lib/slack-approval";
import { daysUntilNextStep } from "@/lib/template-replies";
import { readFileFromGitHub, commitFileToGitHub } from "@/lib/github-commit";

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
  reply: {
    email_bison_reply_id: string | null;
    sender_email_id: string | null;
    lead_name: string | null;
    lead_email: string | null;
    to_email: string | null;
    preferred_recipient_email?: string | null;
    preferred_recipient_name?: string | null;
  },
  apiKey: string,
  instanceUrl: string,
  body: string
): Promise<boolean> {
  if (!reply.email_bison_reply_id || !reply.sender_email_id || !apiKey || !instanceUrl) {
    console.error("[slack-events] Missing EmailBison fields, cannot send");
    return false;
  }
  // Recipient resolution: prefer override (set when forward/redirect detected),
  // fall back to lead. Never use to_email, that is OUR sender address.
  const recipientEmail = reply.preferred_recipient_email ?? reply.lead_email;
  const recipientName = reply.preferred_recipient_name ?? reply.lead_name ?? null;
  const toEmails = [
    {
      name: recipientName,
      email_address: recipientEmail,
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

  // Now create the FU record (only after approved + sent).
  // Wrapped in try-catch so a DB failure here does not silently eat the FU sequence
  // without any trace — the reply is already sent at this point.
  if (draft.fu_sequence_type && draft.fu_sequence_type !== "none" && !draft.flag_meeting_booked && !draft.flag_unsubscribe) {
    try {
      const totalEmails = draft.fu_sequence_type === "abbreviated" ? 2 : 6;
      const fuId = `fu-${draft.reply_id}-${Date.now()}`;
      await pool.query(
        `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
         SELECT $1, $2, $3, $4, $5, NOW(), 0, $6, $7, FALSE, NOW() + INTERVAL '2 days'
         WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
        [fuId, draft.reply_id, draft.workspace_slug, draft.lead_name, draft.lead_email, totalEmails, draft.fu_sequence_type]
      );
    } catch (err: any) {
      console.error(`[slack-events] FU record creation failed after approving draft ${draft.id}:`, err?.message ?? err);
      await postToSlack({ channel, threadTs: ts, text: `Warning: reply sent but FU sequence could not be created. Check logs. Reply ID: ${draft.reply_id}` });
    }
  }

  await addReaction(channel, ts, "outbox_tray");
  console.log(`[slack-events] Approved + sent reply draft ${draft.id}`);
}

async function rejectReplyDraft(draft: ReplyDraftRow, slackUserId: string, channel: string, ts: string): Promise<void> {
  // ❌ closes the reply out entirely. Draft is rejected, the reply is marked
  // closed so it does not re-enter the inbox or get re-processed, and no
  // email is sent. Any in-flight FU sequence for this reply is killed too.
  await pool.query(
    `UPDATE reply_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );
  await pool.query(
    `UPDATE replies SET status = 'closed' WHERE id = $1`,
    [draft.reply_id]
  );
  await pool.query(
    `UPDATE follow_ups SET next_fu_due = NULL, outcome = 'manually_closed' WHERE reply_id = $1`,
    [draft.reply_id]
  );
  await addReaction(channel, ts, "no_entry");
  console.log(`[slack-events] Closed reply draft ${draft.id} via ❌`);
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
      isFinal ? null : new Date(Date.now() + daysUntilNextStep(draft.fu_sequence_type, draft.fu_step) * 24 * 60 * 60 * 1000),
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
  // ❌ kills the entire FU sequence. No more drafts get scheduled for this lead.
  // The draft itself is marked rejected and no email is sent.
  await pool.query(
    `UPDATE follow_ups
       SET next_fu_due = NULL,
           outcome = 'manually_closed'
     WHERE id = $1`,
    [draft.follow_up_id]
  );
  await pool.query(
    `UPDATE follow_up_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
    [slackUserId, draft.id]
  );
  await addReaction(channel, ts, "no_entry");
  console.log(`[slack-events] Closed FU sequence via ❌, draft ${draft.id}`);
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
    return;
  }

  // Reaction is not on any tracked draft. If the message is in #feedback-review,
  // log the reaction and either auto-apply (✅) or just acknowledge (other emojis).
  const channelName = await getChannelName(channel);
  if (channelName === bareChannelName(FEEDBACK_REVIEW_CHANNEL)) {
    const reactionLabel = isApprove ? "approve" : isReject ? "reject" : "edit_request";
    await pool.query(
      `INSERT INTO draft_feedback
         (id, draft_type, draft_id, slack_user_id, slack_user_name, message_text, action, slack_ts, parent_slack_ts)
       VALUES ($1,'weekly_review',$2,$3,$4,$5,$6,$7,$7)`,
      [
        `fb-rxn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        userId,
        userName,
        `[reaction: :${reaction}:]`,
        reactionLabel === "approve" ? "approve_review" : reactionLabel === "reject" ? "reject_review" : "edit_request",
        ts,
      ]
    );

    if (isApprove) {
      // Trigger auto-apply: read the persisted weekly review summary, generate
      // markdown edits via Claude, commit them via the GitHub Contents API.
      await applyWeeklyReview(ts, channel, userName);
    } else {
      await addReaction(channel, ts, "eyes");
      console.log(`[slack-events] Logged ${reactionLabel} reaction by ${userName} on weekly review ${ts}`);
    }
  }
}

interface WeeklyReviewPattern {
  title: string;
  examples_count: number;
  proposed_rule_change: string;
  target_file: string;
  confidence: string;
}

interface WeeklyReviewSummary {
  headline: string;
  patterns: WeeklyReviewPattern[];
  one_off_notes: string[];
}

/**
 * Map a Claude-suggested target_file string to the actual repo path of the file
 * that gets edited. Returns null if the target is unsupported (eg "client file"
 * which would need a workspace slug).
 */
function resolveTargetPath(target: string): string | null {
  const t = target.trim().toLowerCase();
  if (t.includes("context_replies")) return "1. Departments/reply-management/CONTEXT_Replies.md";
  if (t.includes("context_followups")) return "1. Departments/follow-up-management/CONTEXT_FollowUps.md";
  if (t.includes("skill_followups")) return "1. Departments/follow-up-management/SKILL_FollowUps.md";
  if (t.includes("skill_reply")) return "1. Departments/reply-management/SKILL_Reply-Management.md";
  return null;
}

/**
 * Auto-apply a weekly review's approved patterns to the markdown rules in the repo.
 * Steps:
 * 1. Look up the weekly review summary by Slack timestamp.
 * 2. Read any thread comments to filter which patterns to apply (eg "apply 1 and 3").
 * 3. For each approved pattern, ask Claude to write the exact insertion (full new file content).
 * 4. Commit each file via the GitHub Contents API. Coolify auto-deploys on the new commits.
 * 5. Post a thread reply summarising what was applied + commit links.
 */
async function applyWeeklyReview(reviewTs: string, channel: string, reviewerName: string): Promise<void> {
  const reviewResult = await pool.query<{
    id: string;
    summary: WeeklyReviewSummary;
    status: string;
  }>(
    `SELECT id, summary, status FROM weekly_reviews WHERE slack_ts = $1 LIMIT 1`,
    [reviewTs]
  );
  if (reviewResult.rows.length === 0) {
    await postToSlack({
      channel,
      threadTs: reviewTs,
      text: "No persisted summary found for this review. Cannot auto-apply. Tell Lukas in chat to apply manually.",
    });
    return;
  }
  const review = reviewResult.rows[0];
  if (review.status === "applied") {
    await postToSlack({
      channel,
      threadTs: reviewTs,
      text: "This review has already been applied to the markdown rules. Skipping.",
    });
    return;
  }

  // Pull thread feedback to detect filtering instructions like "apply 1 and 3 only".
  const threadResult = await pool.query<{ message_text: string; slack_user_name: string | null }>(
    `SELECT message_text, slack_user_name FROM draft_feedback
     WHERE parent_slack_ts = $1 AND draft_type = 'weekly_review' AND action = 'feedback'
     ORDER BY created_at ASC`,
    [reviewTs]
  );
  const threadComments = threadResult.rows.map(r => r.message_text).filter(Boolean).join("\n");

  const patterns = review.summary.patterns ?? [];
  if (patterns.length === 0) {
    await postToSlack({
      channel,
      threadTs: reviewTs,
      text: "No patterns to apply this week. Marking review as applied.",
    });
    await pool.query(
      `UPDATE weekly_reviews SET status = 'applied', applied_at = NOW(), applied_by = $1 WHERE slack_ts = $2`,
      [reviewerName, reviewTs]
    );
    await addReaction(channel, reviewTs, "outbox_tray");
    return;
  }

  // Group patterns by target file and compute the set to apply.
  const patternsByFile = new Map<string, WeeklyReviewPattern[]>();
  const skippedTargets: string[] = [];

  for (const p of patterns) {
    const path = resolveTargetPath(p.target_file);
    if (!path) {
      skippedTargets.push(`${p.title} (target ${p.target_file} not auto-applicable)`);
      continue;
    }
    if (!patternsByFile.has(path)) patternsByFile.set(path, []);
    patternsByFile.get(path)!.push(p);
  }

  const applied: { file: string; commitUrl: string; titles: string[] }[] = [];
  const failed: string[] = [];

  for (const [filePath, filePatterns] of patternsByFile.entries()) {
    const file = await readFileFromGitHub(filePath);
    if (!file) {
      failed.push(`${filePath}: could not read from GitHub`);
      continue;
    }

    // Ask Claude to merge the new patterns into the existing file content.
    const newContent = await applyPatternsToFile(file.content, filePatterns, threadComments);
    if (!newContent) {
      failed.push(`${filePath}: Claude could not generate the merged file`);
      continue;
    }
    if (newContent === file.content) {
      console.log(`[slack-events] No changes generated for ${filePath}, skipping`);
      continue;
    }

    const commitMessage = `Apply weekly review patterns by ${reviewerName}\n\n${filePatterns.map(p => `- ${p.title}`).join("\n")}\n\nReviewed via #feedback-review weekly review.`;
    const commitUrl = await commitFileToGitHub(filePath, newContent, commitMessage, file.sha);
    if (!commitUrl) {
      failed.push(`${filePath}: commit failed`);
      continue;
    }
    applied.push({ file: filePath, commitUrl, titles: filePatterns.map(p => p.title) });
  }

  // Only mark as applied if at least one file actually committed. Otherwise leave
  // status='pending' so the user can fix the underlying issue and retry.
  if (applied.length > 0) {
    await pool.query(
      `UPDATE weekly_reviews SET status = 'applied', applied_at = NOW(), applied_by = $1, commit_url = $2 WHERE slack_ts = $3`,
      [reviewerName, applied[0].commitUrl, reviewTs]
    );
  }

  const lines: string[] = [];
  if (applied.length > 0) {
    lines.push(`*Applied ${applied.reduce((n, a) => n + a.titles.length, 0)} pattern(s) across ${applied.length} file(s):*`);
    for (const a of applied) {
      lines.push(`• \`${a.file}\` — ${a.titles.join(", ")} (<${a.commitUrl}|commit>)`);
    }
    lines.push("");
    lines.push("Coolify will pick up the changes on the next deploy webhook.");
  }
  if (skippedTargets.length > 0) {
    lines.push("");
    lines.push("*Skipped (not auto-applicable):*");
    for (const s of skippedTargets) lines.push(`• ${s}`);
  }
  if (failed.length > 0) {
    lines.push("");
    lines.push("*Failed:*");
    for (const f of failed) lines.push(`• ${f}`);
  }

  await postToSlack({
    channel,
    threadTs: reviewTs,
    text: lines.join("\n"),
  });
  await addReaction(channel, reviewTs, applied.length > 0 ? "outbox_tray" : "warning");
}

/**
 * Use Claude to merge proposed patterns into an existing markdown file.
 * Returns the full new file content, or null on error.
 */
async function applyPatternsToFile(
  existingContent: string,
  patterns: WeeklyReviewPattern[],
  threadComments: string
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You are editing a markdown documentation file. You will receive the current full file contents and one or more proposed rule changes. Apply each proposed change to the file by inserting or modifying text in the right section. Preserve all existing content exactly. Add the new content under the most appropriate existing heading, or create a new subsection if needed.

OUTPUT: the complete new file content, nothing else. No preamble, no fences, no commentary. Just the full file as it should look after your edits.`;

  const patternsBlock = patterns.map((p, i) =>
    `Pattern ${i + 1}: ${p.title}\nTarget: ${p.target_file}\nConfidence: ${p.confidence}\nProposed rule change:\n${p.proposed_rule_change}`
  ).join("\n\n---\n\n");

  const userMessage = `EXISTING FILE CONTENT:
${existingContent}

PROPOSED PATTERN(S) TO APPLY:
${patternsBlock}

${threadComments ? `HUMAN INSTRUCTIONS FROM THE REVIEW THREAD (apply these as filters or refinements):\n${threadComments}\n\n` : ""}Output the full revised file content now.`;

  const applyController = new AbortController();
  const applyTimeout = setTimeout(() => applyController.abort(), 120_000);

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
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: applyController.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[apply-patterns] Claude timed out after 120s");
    else console.error("[apply-patterns] Claude fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(applyTimeout);
  }
  if (!response.ok) {
    console.error("[apply-patterns] Claude error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const text = (data.content?.[0]?.text ?? "").trim();
  // If the model wrapped the file in fences, strip them.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : text;
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
    if (err?.name === "AbortError") console.error("[slack-events] Claude regenerate timed out after 90s");
    else console.error("[slack-events] Claude regenerate fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.error("[slack-events] Claude regenerate error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();

  // Tolerant parser: try strict JSON first, fall back to extracting the outermost {...}.
  try {
    return JSON.parse(raw) as RegenResult;
  } catch {
    // Find the first { and the matching closing } using a brace counter so we
    // ignore preamble like "Looking at the feedback:" or trailing prose.
    const firstBrace = raw.indexOf("{");
    if (firstBrace === -1) {
      console.error("[slack-events] regenerate: no JSON object found in response:", raw.slice(0, 300));
      return null;
    }
    let depth = 0;
    let lastBrace = -1;
    for (let i = firstBrace; i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}") {
        depth--;
        if (depth === 0) { lastBrace = i; break; }
      }
    }
    if (lastBrace === -1) {
      console.error("[slack-events] regenerate: unbalanced JSON braces:", raw.slice(0, 300));
      return null;
    }
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as RegenResult;
    } catch (err: any) {
      console.error("[slack-events] regenerate: JSON parse still failed after extraction:", err?.message, raw.slice(0, 300));
      return null;
    }
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

  const CLIENT_FILE_ALIASES: Record<string, string> = { "internal-campaigns": "agency-evolution" };
  const fileSlug = CLIENT_FILE_ALIASES[draft.workspace_slug] ?? draft.workspace_slug;
  const clientFile = readContextFile(`clients/${fileSlug}.md`);
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);
  const skillFile = readContextFile(`1. Departments/reply-management/SKILL_Reply-Management.md`);

  // Extract lead intelligence from their original message to help Claude write a specific, non-generic revision.
  const domain = (reply.lead_email ?? "").split("@")[1] ?? "";
  const leadDomain = domain && !["gmail","yahoo","hotmail","outlook"].some(d => domain.includes(d)) ? `Company domain: ${domain}` : "";
  const selfDesc = (reply.message ?? "").split("\n").find((l: string) =>
    /^(we (are|work|help|focus)|our (company|firm|fund)|i (am|work|run))/i.test(l.trim()) && l.length > 20 && l.length < 300
  ) ?? "";
  const leadIntelNote = [leadDomain, selfDesc ? `Lead described: ${selfDesc}` : ""].filter(Boolean).join("\n");

  const systemPrompt = `You are revising a drafted first-response email for Maxen Partners based on human feedback. Apply the feedback to produce a new draft.

OUTPUT FORMAT (CRITICAL): The very first character of your response MUST be "{" and the very last character MUST be "}". No preamble, no "Looking at...", no markdown fences, no analysis, no commentary, no thinking out loud. Just the JSON. Shape:
{
  "subject": "short subject line, no Re: prefix (or keep the existing one if not changed)",
  "body": "full revised email body, plain text, greeting on its own line, blank lines between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line. Plain text only."
}

Apply the human feedback as the priority. Keep what is already good in the original draft. Honour every rule in CONTEXT_Replies.md — especially the "Hard Rules — Learned From Live Incidents" section.

HARD RULES (always apply, even during revision):
- Write in first person always — never refer to the sender by name as the subject of a sentence
- Never confirm availability or suggest specific time slots
- Reference something specific from the lead's message — not generic
- No AI filler phrases ("Sounds great", "I'd love to", "Excited to show you")
- End with {SENDER_EMAIL_SIGNATURE} on its own line, nothing before it

If the human feedback contradicts a rule in CONTEXT_Replies.md, follow the feedback (humans are training the system).

=== CONTEXT_Replies.md ===
${replyContext}

=== SKILL_Reply-Management.md ===
${skillFile}`;

  const userMessage = `CLIENT WORKSPACE: ${draft.workspace_slug}

CLIENT FILE:
${clientFile}

LEAD:
Name: ${reply.lead_name}
Company: ${reply.lead_company ?? "unknown"}
Title: ${reply.lead_title ?? "unknown"}
${leadIntelNote ? `\nLEAD INTELLIGENCE:\n${leadIntelNote}\n` : ""}
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

  // Guard: reject a regenerated body that is too short — same truncation risk as the main processor.
  const bodyWithoutSignature = newBody.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
  if (bodyWithoutSignature.length < 80) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Regenerated body was too short (possible truncation). Not saved. Add more specific feedback and try again.",
    });
    return;
  }

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

  // Mirror the same query as the main FU processor: outbound (follow_up + auto_reply + reply)
  // plus inbound replies from the lead. Regen must see the same thread Claude originally saw.
  const [sentResult, inboundResult] = await Promise.all([
    pool.query(
      `SELECT 'outbound' AS direction, email_type, body, sent_at
       FROM sent_emails
       WHERE reply_id = $1 AND email_type IN ('follow_up', 'auto_reply', 'reply')
       ORDER BY sent_at ASC`,
      [draft.reply_id]
    ),
    pool.query(
      `SELECT 'inbound' AS direction, 'lead_reply' AS email_type, message AS body, received_at AS sent_at
       FROM replies
       WHERE workspace_slug = $1 AND lead_email = $2 AND id != $3
       ORDER BY received_at ASC`,
      [draft.workspace_slug, draft.lead_email, draft.reply_id]
    ),
  ]);
  const allMessages = [...sentResult.rows, ...inboundResult.rows].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  const prevBodies = allMessages.map(r => {
    const label = r.direction === "inbound" ? "[LEAD REPLIED]" : `[US — ${r.email_type}]`;
    return `${label}\n${r.body}`;
  }).filter(Boolean);

  const FU_CLIENT_FILE_ALIASES: Record<string, string> = { "internal-campaigns": "agency-evolution" };
  const fuFileSlug = FU_CLIENT_FILE_ALIASES[draft.workspace_slug] ?? draft.workspace_slug;
  const clientFile = readContextFile(`clients/${fuFileSlug}.md`);
  const fuContext = readContextFile(`1. Departments/follow-up-management/CONTEXT_FollowUps.md`);
  const replyContext = readContextFile(`1. Departments/reply-management/CONTEXT_Replies.md`);

  const systemPrompt = `You are revising a drafted follow-up email for Maxen Partners based on human feedback. Apply the feedback to produce a new draft.

OUTPUT FORMAT (CRITICAL): The very first character of your response MUST be "{" and the very last character MUST be "}". No preamble, no "Looking at...", no markdown fences, no analysis, no commentary, no thinking out loud. Just the JSON. Shape:
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

  // Guard: reject a regenerated body that is too short.
  const bodyWithoutSignature = newBody.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
  if (bodyWithoutSignature.length < 80) {
    await postToSlack({
      channel,
      threadTs: ts,
      text: "Regenerated body was too short (possible truncation). Not saved. Add more specific feedback and try again.",
    });
    return;
  }

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

  // No draft? Check if this thread is in #feedback-review (the weekly review channel).
  // If yes, capture as weekly_review feedback so the next chat session can read it.
  if (!draftType || !draftId) {
    const channelName = await getChannelName(channel);
    if (channelName === bareChannelName(FEEDBACK_REVIEW_CHANNEL)) {
      const userName = await getSlackUserName(userId);
      const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO draft_feedback
           (id, draft_type, draft_id, workspace_slug, slack_user_id, slack_user_name, message_text, action, slack_ts, parent_slack_ts)
         VALUES ($1,'weekly_review',$2,NULL,$3,$4,$5,'feedback',$6,$7)`,
        [feedbackId, parentTs, userId, userName, text, ts, parentTs]
      );
      await addReaction(channel, ts, "eyes");
      console.log(`[slack-events] Captured weekly_review feedback ${feedbackId}`);
    }
    return;
  }

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

  // Slack retries any event that does not get 200 within 3 seconds.
  // Our regenerate flow calls Claude which takes 5-15 seconds, so we MUST
  // respond fast and process in the background.
  const retryNum = req.headers.get("x-slack-retry-num");
  if (retryNum) {
    // This is a retry from Slack. Original handler is still running. Ignore.
    console.log(`[slack-events] ignoring retry attempt ${retryNum}`);
    return NextResponse.json({ ok: true, ignored: "retry" });
  }

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  if (!event) return NextResponse.json({ ok: true });

  // Fire and forget: don't await the handler, respond to Slack immediately.
  // Errors are logged inside the handler.
  setImmediate(() => {
    if (event.type === "reaction_added") {
      handleReactionAdded(event).catch(err =>
        console.error("[slack-events] reaction handler error:", err)
      );
    } else if (event.type === "message") {
      handleThreadMessage(event).catch(err =>
        console.error("[slack-events] message handler error:", err)
      );
    }
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk Slack events" });
}
