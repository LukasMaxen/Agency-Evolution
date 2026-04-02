import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { replyId, message, emailType } = await req.json();

    if (!replyId || !message) {
      return NextResponse.json(
        { error: "replyId and message are required" },
        { status: 400 }
      );
    }

    // Get reply + workspace API key
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

    const reply = result.rows[0];
    const apiKey = reply.email_bison_api_key;
    const instanceUrl = reply.email_bison_instance_url;
    const emailBisonReplyId = reply.email_bison_reply_id;

    if (!apiKey || !emailBisonReplyId) {
      return NextResponse.json(
        { error: "Workspace not configured or reply ID missing" },
        { status: 400 }
      );
    }

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
          reply_all: true,
          message: message,
        }),
      }
    );

    if (!ebResponse.ok) {
      const errText = await ebResponse.text();
      console.error("[send-reply] EmailBison error:", errText);
      return NextResponse.json(
        { error: `EmailBison API error: ${ebResponse.status}` },
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
        message,
      ]
    );

    // Update reply status to replied
    await pool.query(
      "UPDATE replies SET status = 'replied' WHERE id = $1",
      [replyId]
    );

    // If follow-up, update fu tracking
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