import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspace = searchParams.get("workspace") ?? "all";
    const status    = searchParams.get("status") ?? "all";
    const limit     = parseInt(searchParams.get("limit") ?? "100");

    let query = "SELECT * FROM replies WHERE 1=1";
    const values: any[] = [];
    let idx = 1;

    if (workspace !== "all") {
      query += ` AND workspace_slug = $${idx++}`;
      values.push(workspace);
    }
    if (status !== "all") {
      query += ` AND status = $${idx++}`;
      values.push(status);
    }

    query += ` ORDER BY received_at DESC LIMIT $${idx}`;
    values.push(limit);

    const result = await pool.query(query, values);

    // Map DB rows to app Reply type
    const replies = result.rows.map((r) => ({
      id:            r.id,
      workspaceId:   r.workspace_id,
      workspaceSlug: r.workspace_slug,
      emailBisonId:  r.email_bison_id,
      leadEmail:     r.lead_email,
      leadName:      r.lead_name,
      leadCompany:   r.lead_company,
      leadTitle:     r.lead_title,
      senderEmail:   r.sender_email,
      campaign:      r.campaign,
      subject:       r.subject,
      message:       r.message,
      receivedAt:    r.received_at,
      status:        r.status,
      interested:    r.interested,
    }));

    return NextResponse.json({ replies });
  } catch (err: any) {
    console.error("[replies] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Mark reply status or interested
export async function PATCH(req: NextRequest) {
  try {
    const { id, status, interested } = await req.json();

    if (status !== undefined) {
      await pool.query("UPDATE replies SET status = $1 WHERE id = $2", [status, id]);
    }
    if (interested !== undefined) {
      await pool.query("UPDATE replies SET interested = $1 WHERE id = $2", [interested, id]);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}