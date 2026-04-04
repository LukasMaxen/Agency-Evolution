import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspace = searchParams.get("workspace") ?? "all";

  try {
    // ── Replies (last 30 days) ─────────────────────────────────────────────
    const repliesQuery = `
      SELECT
        id,
        lead_name   AS name,
        lead_email  AS email,
        workspace_slug AS "workspaceId",
        message,
        received_at AS date,
        CASE
          WHEN interested = TRUE  THEN 'interested'
          WHEN interested = FALSE THEN 'not_interested'
          ELSE 'neutral'
        END AS type
      FROM replies
      WHERE received_at >= NOW() - INTERVAL '30 days'
      ${workspace !== "all" ? "AND workspace_slug = $1" : ""}
      ORDER BY received_at DESC
    `;
    const repliesResult = await pool.query(
      repliesQuery,
      workspace !== "all" ? [workspace] : []
    );

    // ── Follow-ups ─────────────────────────────────────────────────────────
    const fuQuery = `
      SELECT
        f.id,
        f.lead_name       AS name,
        f.lead_email      AS email,
        f.workspace_slug  AS "workspaceId",
        f.first_replied_at AS "firstReplied",
        f.last_fu_sent_at  AS "lastFUSent",
        f.fu_step          AS "fuStep",
        f.total_emails     AS "totalEmails",
        f.next_fu_due      AS "nextFUDue",
        f.meeting_booked   AS "meetingBooked"
      FROM follow_ups f
      JOIN replies r ON r.id = f.reply_id
      WHERE f.meeting_booked = FALSE
        AND r.interested = TRUE
        ${workspace !== "all" ? "AND f.workspace_slug = $1" : ""}
      ORDER BY f.next_fu_due ASC
    `;
    const fuResult = await pool.query(
      fuQuery,
      workspace !== "all" ? [workspace] : []
    );

    // ── Meetings ───────────────────────────────────────────────────────────
    const meetingsQuery = `
      SELECT
        id,
        lead_name        AS name,
        lead_email       AS email,
        workspace_slug   AS "workspaceId",
        meeting_date     AS "meetingDate",
        duration_minutes AS "durationMinutes",
        status
      FROM meetings
      WHERE status IN ('scheduled', 'completed')
      ${workspace !== "all" ? "AND workspace_slug = $1" : ""}
      ORDER BY meeting_date ASC
    `;
    const meetingsResult = await pool.query(
      meetingsQuery,
      workspace !== "all" ? [workspace] : []
    );

    return NextResponse.json({
      replies:  repliesResult.rows,
      followUps: fuResult.rows,
      meetings: meetingsResult.rows,
    });

  } catch (err: any) {
    console.error("[dashboard] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}