import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const replyId = searchParams.get("replyId");

    if (!replyId) {
      return NextResponse.json({ error: "replyId is required" }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT id, reply_id, workspace_slug, lead_email, lead_name,
              email_type, subject, body, sent_at, sent_by
       FROM sent_emails
       WHERE reply_id = $1
       ORDER BY sent_at ASC`,
      [replyId]
    );

    const sentEmails = result.rows.map((r) => ({
      id:            r.id,
      replyId:       r.reply_id,
      workspaceSlug: r.workspace_slug,
      leadEmail:     r.lead_email,
      leadName:      r.lead_name,
      emailType:     r.email_type,
      subject:       r.subject,
      body:          r.body,
      sentAt:        r.sent_at,
      sentBy:        r.sent_by ?? null,
    }));

    return NextResponse.json({ sentEmails });
  } catch (err: any) {
    console.error("[sent-replies] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}