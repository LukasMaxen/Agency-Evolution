import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizeSignature } from "@/lib/slack-approval";

// Resolve EmailBison merge tags with real lead data
function resolveMergeTags(body: string, leadName: string, leadEmail: string, leadCompany: string | null, leadTitle: string | null): string {
  const firstName = leadName.split(" ")[0] ?? leadName;
  const lastName  = leadName.split(" ").slice(1).join(" ") ?? "";

  return body
    .replace(/\{FIRST_NAME\}/gi,   firstName)
    .replace(/\{LAST_NAME\}/gi,    lastName)
    .replace(/\{FULL_NAME\}/gi,    leadName)
    .replace(/\{EMAIL\}/gi,        leadEmail)
    .replace(/\{COMPANY\}/gi,      leadCompany ?? "")
    .replace(/\{TITLE\}/gi,        leadTitle ?? "")
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi,  lastName)
    .replace(/\{\{company\}\}/gi,    leadCompany ?? "")
    .replace(/\{\{title\}\}/gi,      leadTitle ?? "");
}

export async function POST(req: NextRequest) {
  try {
    const { replyId, message, emailType, toEmailOverride, toNameOverride } = await req.json();

    if (!replyId || !message) {
      return NextResponse.json(
        { error: "replyId and message are required" },
        { status: 400 }
      );
    }

    // Get reply + workspace details
    const result = await pool.query(
      `SELECT r.*, w.email_bison_api_key, w.email_bison_instance_url
       FROM replies r
       JOIN workspaces w ON w.slug = r.workspace_slug
       WHERE r.id = $1`,
      [replyId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const reply    = result.rows[0];
    const apiKey   = reply.email_bison_api_key;
    const instanceUrl = reply.email_bison_instance_url;
    const emailBisonReplyId = reply.email_bison_reply_id;
    const senderEmailId     = reply.sender_email_id;

    if (!apiKey) {
      return NextResponse.json({ error: "Workspace API key not configured" }, { status: 400 });
    }

    if (!emailBisonReplyId) {
      return NextResponse.json({ error: "EmailBison reply ID missing — this may be a test reply" }, { status: 400 });
    }

    if (!senderEmailId) {
      return NextResponse.json({ error: "Sender email ID missing from reply" }, { status: 400 });
    }

    // Strip any hand-written sign-off so only {SENDER_EMAIL_SIGNATURE} is sent,
    // never a duplicated signature. Applies to manual composer sends too.
    const cleanMessage = normalizeSignature(message);

    // Resolve merge tags in the message
    const resolvedMessage = resolveMergeTags(
      cleanMessage,
      reply.lead_name,
      reply.lead_email,
      reply.lead_company,
      reply.lead_title
    );

    // Convert URLs to clickable links
    const linkify = (text: string) =>
      text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

    // Convert plain text to HTML paragraphs with explicit spacing and clickable links
    const htmlMessage = resolvedMessage
      .split("\n\n")
      .map(para => `<p style="margin:0 0 16px 0;">${linkify(para.replace(/\n/g, "<br>"))}</p>`)
      .join("");

    // Build to_emails — use override if provided (e.g. redirected contact)
    const toEmails = [{
      name: toNameOverride ?? reply.lead_name ?? null,
      email_address: toEmailOverride ?? reply.lead_email,
    }];

    // Send via EmailBison API
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
          message: htmlMessage,
          sender_email_id: senderEmailId,
          to_emails: toEmails,
          inject_previous_email_body: true,
          content_type: "html",
        }),
      }
    );

    if (!ebResponse.ok) {
      const errText = await ebResponse.text();
      console.error("[send-reply] EmailBison error:", errText);
      return NextResponse.json(
        { error: `EmailBison API error ${ebResponse.status}: ${errText}` },
        { status: ebResponse.status }
      );
    }

    // Save to sent_emails table
    const sentId = `sent-${replyId}-${Date.now()}`;
    await pool.query(
      `INSERT INTO sent_emails (
        id, reply_id, workspace_slug, lead_email, lead_name,
        email_type, subject, body, sent_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        sentId, replyId,
        reply.workspace_slug,
        reply.lead_email,
        reply.lead_name,
        emailType ?? "reply",
        reply.subject ?? "",
        resolvedMessage,
      ]
    );

    // Update reply status
    await pool.query(
      "UPDATE replies SET status = 'replied' WHERE id = $1",
      [replyId]
    );

    // Update follow_up tracking if this is a follow-up
    if (emailType && emailType.startsWith("fu_")) {
      const fuStep = parseInt(emailType.replace("fu_", "")) || 1;
      await pool.query(
        `UPDATE follow_ups SET
          fu_step = $1,
          last_fu_sent_at = NOW(),
          total_emails = total_emails + 1,
          next_fu_due = NOW() + INTERVAL '7 days'
        WHERE reply_id = $2`,
        [fuStep, replyId]
      );
    }

    return NextResponse.json({ ok: true, sentId });

  } catch (err: any) {
    console.error("[send-reply] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}