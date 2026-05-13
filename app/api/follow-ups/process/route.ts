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
  renderTemplate as renderReplyTemplate,
  varsFromReply,
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

  // Read client file + workflow context. Both define ALL rules.
  const clientFile = readFile(path.join(process.cwd(), "clients", `${fileSlug}.md`));
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

  const systemPrompt = `You are the follow-up email drafter for Maxen Partners. You draft follow-up emails that are indistinguishable from what a sharp, experienced human operator would write after carefully reading the full thread.

The standard is not "good enough to send." The standard is: would a senior person at Maxen Partners look at this and be proud to put their name on it?

---

BEFORE DRAFTING — read in this order:
1. The CLIENT FILE in full. Know the offer, the sender identity, the Calendly link, the GTM brief, and the FU scaffolding.
2. CONTEXT_Replies.md — especially the "Hard Rules — Learned From Live Incidents" section. These apply to FUs too.
3. CONTEXT_FollowUps.md — step purposes, sequence structure, and FU-specific rules.
4. The FULL THREAD — every email sent and every reply received. Do not repeat any angle, link, case study, or objection reframe already used.
5. The ORIGINAL REPLY — what the lead said that started this sequence. Their intent and language should inform every FU.

---

HARD RULES (same as first replies — no exceptions):

SENDER IDENTITY: Write in first person always. Never refer to the sender in third person.
WRONG: "Stephen's buyers are ready to move" / "Nicklas works with brands like yours"
RIGHT: "The buyers I work with are ready to move" / "I work with brands like yours"

NEVER CONFIRM AVAILABILITY: No calendar access. Never write "Tuesday works" or suggest specific slots. Only use the Calendly link.

NEVER REPEAT: Check the thread. If a case study, stat, link, or angle was already used — do not use it again. Every FU must bring something new.

MATCH TONE: Read how the lead wrote their original reply. Match their register — formal stays formal, casual stays casual.

NO AI PHRASES: Never use "Sounds great", "I'd love to", "Excited to show you", "Straightforward", "Genuinely", "Thrilled." Write like a real person.

NO DASHES: No em dashes, en dashes, or hyphens as punctuation.

SIGNATURE: Always end with {SENDER_EMAIL_SIGNATURE} on its own line. Never write "Best," or any name before it.

---

WHICH STEP TO DRAFT:
Sequence type: ${fu.fu_sequence_type}
Step to draft: FU${nextStep} of ${fu.total_emails}

Apply the step purpose from CONTEXT_FollowUps.md for this sequence type and step number. The step purpose defines the angle — use it as the frame, then write fresh content specific to this lead.

OUTPUT FORMAT:
Return a single JSON object and nothing else. Start with "{" and end with "}".
{
  "subject": "short subject line, no Re: prefix",
  "body": "full email body, plain text, greeting on its own line, blank line between paragraphs, ends with {SENDER_EMAIL_SIGNATURE} on its own line."
}

=== CONTEXT_FollowUps.md ===
${followUpContext}

=== CONTEXT_Replies.md ===
${replyContext}`;

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

  // ── Template vs Sonnet routing ──────────────────────────────────────────────
  // Full sequence (6 steps): odd steps (1, 3, 5) are templates, even steps (2, 4, 6) are Sonnet.
  // Abbreviated sequence (2 steps): step 1 is Sonnet (reframe), step 2 is the fu-breakup template.
  // Template names live in the templates folder. Renaming or editing them does
  // not require a code change.
  let templateName: string | null = null;
  if (fu.fu_sequence_type === "full") {
    if (nextStep === 1) templateName = "fu-nudge";
    else if (nextStep === 3) templateName = "fu-move-forward";
    else if (nextStep === 5) templateName = "fu-check-in";
  } else if (fu.fu_sequence_type === "abbreviated" && nextStep === fu.total_emails) {
    templateName = "fu-breakup";
  }

  let draft: DraftResult | null;
  if (templateName) {
    const vars = varsFromReply(reply, fu.workspace_slug);
    const body = renderReplyTemplate(templateName, vars);
    if (!body) {
      console.error(`[fu-process] template ${templateName} missing, falling back to Sonnet for step ${nextStep}`);
      draft = await callClaude(systemPrompt, userMessage);
    } else {
      draft = {
        subject: reply.subject ?? "",
        body,
      };
      console.log(`[fu-process] using template ${templateName} for ${fu.workspace_slug} step ${nextStep}`);
    }
  } else {
    draft = await callClaude(systemPrompt, userMessage);
  }

  if (!draft) {
    return { status: "failed", reason: "claude error" };
  }

  // Strip any em/en dashes Claude leaked through despite the prompt.
  draft.body = sanitizeDashes(draft.body);
  draft.subject = sanitizeDashes(draft.subject);

  // Two-pass quality check: Haiku critiques, if issues found discard and re-draft with Sonnet.
  // Only runs on Sonnet-drafted steps — templates are pre-approved text.
  if (!templateName) {
    const critique = await critiqueFuDraft(draft.body, reply.message ?? "", fu.workspace_slug);
    if (critique) {
      console.log(`[fu-process] Haiku critique for ${fu.id} step ${nextStep}: ${critique}`);
      const revised = await callClaude(
        systemPrompt,
        `${userMessage}\n\nA quality check found issues with your previous draft:\n${critique}\n\nRevise the draft to fix these issues. Return the full JSON object.`
      );
      if (revised?.body) {
        const revisedClean = sanitizeDashes(revised.body);
        const revisedWithoutSig = revisedClean.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
        if (revisedWithoutSig.length >= 80) {
          draft.body = revisedClean;
          if (revised.subject) draft.subject = sanitizeDashes(revised.subject);
          console.log(`[fu-process] FU draft revised based on critique for ${fu.id} step ${nextStep}`);
        }
      }
    }
  }

  // Guard: reject a Sonnet-drafted body that is too short (truncation risk).
  // Templates are pre-approved content and exempt from this check — they can
  // legitimately be short (e.g. fu-nudge is a single sentence).
  if (!templateName) {
    const bodyWithoutSignature = draft.body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    if (bodyWithoutSignature.length < 80) {
      console.warn(`[fu-process] FU body too short (${bodyWithoutSignature.length} chars) for ${fu.workspace_slug} / ${fu.lead_name} step ${nextStep} — skipping`);
      return { status: "failed", reason: "generated body too short, possible truncation" };
    }
  }

  // Approval mode → stage in follow_up_drafts + post to Slack
  if (reply.fu_approval_mode) {
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
