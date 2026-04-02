import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.event ?? "";

    console.log(`[calendly webhook] event: ${eventType}`);

    // ── Meeting booked ────────────────────────────────────────────────────────
    if (eventType === "invitee.created") {
      const payload   = body.payload;
      const invitee   = payload.invitee;
      const event     = payload.event;

      const leadName  = invitee.name ?? "";
      const leadEmail = invitee.email ?? "";
      const meetingDate = new Date(event.start_time);
      const eventUri  = event.uri ?? "";
      const inviteeUri = invitee.uri ?? "";

      // Try to match to an existing reply by email
      const replyResult = await pool.query(
        "SELECT id, workspace_slug FROM replies WHERE lead_email = $1 ORDER BY received_at DESC LIMIT 1",
        [leadEmail]
      );

      const replyId = replyResult.rows[0]?.id ?? null;
      const workspaceSlug = replyResult.rows[0]?.workspace_slug ?? "unknown";

      const meetingId = `mtg-${inviteeUri.split("/").pop() ?? Date.now()}`;

      await pool.query(
        `INSERT INTO meetings (
          id, workspace_slug, reply_id, lead_name, lead_email,
          calendly_event_uri, calendly_invitee_uri,
          meeting_date, duration_minutes, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,30,'scheduled')
        ON CONFLICT (id) DO NOTHING`,
        [
          meetingId, workspaceSlug, replyId,
          leadName, leadEmail,
          eventUri, inviteeUri,
          meetingDate,
        ]
      );

      // Update follow_up row — mark meeting booked
      if (replyId) {
        await pool.query(
          `UPDATE follow_ups SET
            meeting_booked = TRUE,
            meeting_date = $1
          WHERE reply_id = $2`,
          [meetingDate, replyId]
        );
      }

      return NextResponse.json({ ok: true, event: "invitee.created" });
    }

    // ── Meeting canceled ──────────────────────────────────────────────────────
    if (eventType === "invitee.canceled") {
      const inviteeUri = body.payload?.invitee?.uri ?? "";
      const meetingId = `mtg-${inviteeUri.split("/").pop() ?? ""}`;

      await pool.query(
        "UPDATE meetings SET status = 'canceled' WHERE id = $1",
        [meetingId]
      );

      return NextResponse.json({ ok: true, event: "invitee.canceled" });
    }

    return NextResponse.json({ ok: true, event: eventType, note: "unhandled" });

  } catch (err: any) {
    console.error("[calendly webhook] error:", err);
    return NextResponse.json(
      { error: err.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — Calendly webhook" });
}