// app/api/calls/route.ts
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// ── GET — fetch calls for a reply ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const replyId = searchParams.get("replyId");
    const workspace = searchParams.get("workspace") ?? "all";

    let query = `
      SELECT * FROM calls
      WHERE 1=1
    `;
    const values: any[] = [];
    let idx = 1;

    if (replyId) {
      query += ` AND reply_id = $${idx++}`;
      values.push(replyId);
    }
    if (workspace !== "all") {
      query += ` AND workspace_slug = $${idx++}`;
      values.push(workspace);
    }

    query += ` ORDER BY scheduled_at DESC`;

    const result = await pool.query(query, values);
    return NextResponse.json({ calls: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST — book a call manually ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { replyId, workspaceSlug, leadEmail, leadName, scheduledAt } = await req.json();

    if (!replyId || !scheduledAt || !leadEmail) {
      return NextResponse.json({ error: "replyId, leadEmail, scheduledAt required" }, { status: 400 });
    }

    const scheduledDate = new Date(scheduledAt);

    // ── Dedup: check if a call already exists for this lead within 60 days ──
    const existing = await pool.query(
      `SELECT id, scheduled_at, status, is_reschedule, original_call_id
       FROM calls
       WHERE lead_email = $1
         AND scheduled_at >= NOW() - INTERVAL '60 days'
       ORDER BY scheduled_at DESC
       LIMIT 1`,
      [leadEmail]
    );

    let isReschedule = false;
    let originalCallId: string | null = null;

    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      isReschedule = true;
      // Point to the root original call (not a chain of reschedules)
      originalCallId = prev.original_call_id ?? prev.id;

      // Mark previous call as rescheduled
      await pool.query(
        `UPDATE calls SET status = 'rescheduled', updated_at = NOW() WHERE id = $1`,
        [prev.id]
      );
    }

    const callId = `call-${replyId}-${Date.now()}`;

    await pool.query(
      `INSERT INTO calls (
        id, reply_id, workspace_slug, lead_email, lead_name,
        source, scheduled_at, status, is_reschedule, original_call_id,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,'manual',$6,'scheduled',$7,$8,NOW(),NOW())`,
      [callId, replyId, workspaceSlug, leadEmail, leadName,
       scheduledDate, isReschedule, originalCallId]
    );

    // Mark reply as meeting booked
    await pool.query(
      `UPDATE replies SET meeting_booked = TRUE WHERE id = $1`,
      [replyId]
    );

    return NextResponse.json({ ok: true, callId, isReschedule });
  } catch (err: any) {
    console.error("[calls POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PATCH — update call status / outcome ──────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const { id, status, outcome, notes } = await req.json();

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const updates: string[] = ["updated_at = NOW()"];
    const values: any[] = [];
    let idx = 1;

    if (status !== undefined)  { updates.push(`status = $${idx++}`);  values.push(status); }
    if (outcome !== undefined) { updates.push(`outcome = $${idx++}`); values.push(outcome); }
    if (notes !== undefined)   { updates.push(`notes = $${idx++}`);   values.push(notes); }

    values.push(id);
    await pool.query(
      `UPDATE calls SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}