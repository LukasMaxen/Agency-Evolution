import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspace = searchParams.get("workspace") ?? "all";

  try {
    // ── Workspaces (from DB, always — so UI stays in sync with EB) ────────
    const workspacesResult = await pool.query(`
      SELECT
        id::text                  AS id,
        slug,
        name,
        email_bison_instance_url  AS "instanceUrl"
      FROM workspaces
      ORDER BY name ASC
    `);

    // Assign stable colours and initials so the UI renders correctly for any
    // workspace added to EB and the DB without touching mock-data.ts.
    const PALETTE = [
      "#185FA5", "#0F6E56", "#7C3AED", "#B45309", "#DC2626",
      "#533AB7", "#0369A1", "#0F6E56", "#185FA5", "#9D174D",
      "#065F46", "#1E3A5F", "#6D28D9", "#92400E", "#0F766E",
      "#374151", "#7C2D12", "#1D4ED8", "#065F46", "#78350F",
    ];
    const dbWorkspaces = workspacesResult.rows.map((row, i) => {
      const words = row.name.split(/[\s\-]+/).filter(Boolean);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : row.name.slice(0, 2).toUpperCase();
      return {
        id:          row.id,
        slug:        row.slug,
        name:        row.name,
        instanceUrl: row.instanceUrl ?? "",
        color:       PALETTE[i % PALETTE.length],
        initials,
      };
    });

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

    // ── Calls (from both Calendly + manual bookings) ─────────────────────
    const callsQuery = `
      SELECT
        c.id,
        c.lead_name        AS name,
        c.lead_email       AS email,
        c.workspace_slug   AS "workspaceId",
        c.scheduled_at     AS "meetingDate",
        c.status,
        c.outcome,
        c.is_reschedule    AS "isReschedule",
        c.source,
        c.original_call_id AS "originalCallId"
      FROM calls c
      WHERE c.status NOT IN ('rescheduled', 'cancelled')
      ${workspace !== "all" ? "AND c.workspace_slug = $1" : ""}
      ORDER BY c.scheduled_at DESC
    `;
    const meetingsResult = await pool.query(
      callsQuery,
      workspace !== "all" ? [workspace] : []
    );

    // ── Emails sent — totals + per workspace breakdown ────────────────────
    const emailsWhere = workspace !== "all" ? "WHERE workspace_slug = $1" : "";
    const emailsArgs  = workspace !== "all" ? [workspace] : [];

    const emailsSentResult = await pool.query(`
      SELECT
        workspace_slug AS "workspaceId",
        COUNT(*)::int  AS total,
        COUNT(*) FILTER (WHERE (sent_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date - 1)::int   AS yesterday,
        COUNT(*) FILTER (WHERE (sent_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date)::int        AS today,
        COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '7 days')::int          AS last7,
        COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '30 days')::int         AS last30
      FROM emails_sent
      ${emailsWhere}
      GROUP BY workspace_slug
      ORDER BY total DESC
    `, emailsArgs);

    // Replies and interested counts per workspace (all time)
    const replyStatsResult = await pool.query(`
      SELECT
        workspace_slug AS "workspaceId",
        COUNT(*)::int                                        AS replies,
        COUNT(*) FILTER (WHERE interested = TRUE)::int       AS interested
      FROM replies
      ${emailsWhere}
      GROUP BY workspace_slug
    `, emailsArgs);

    const replyStatsMap: Record<string, any> = {};
    for (const r of replyStatsResult.rows) {
      replyStatsMap[r.workspaceId] = r;
    }

    const emailStats = emailsSentResult.rows.map(r => ({
      ...r,
      replies:    replyStatsMap[r.workspaceId]?.replies    ?? 0,
      interested: replyStatsMap[r.workspaceId]?.interested ?? 0,
    }));

    // Grand totals
    const emailTotals = {
      total:      emailStats.reduce((s, r) => s + r.total,     0),
      yesterday:  emailStats.reduce((s, r) => s + r.yesterday, 0),
      today:      emailStats.reduce((s, r) => s + r.today,     0),
      last7:      emailStats.reduce((s, r) => s + r.last7,     0),
      last30:     emailStats.reduce((s, r) => s + r.last30,    0),
      replies:    emailStats.reduce((s, r) => s + r.replies,   0),
      interested: emailStats.reduce((s, r) => s + r.interested,0),
    };

    return NextResponse.json({
      workspaces:  dbWorkspaces,
      replies:     repliesResult.rows,
      followUps:   fuResult.rows,
      meetings:    meetingsResult.rows,
      emailStats,
      emailTotals,
    });

  } catch (err: any) {
    console.error("[dashboard] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}