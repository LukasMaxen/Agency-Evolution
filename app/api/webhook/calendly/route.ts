// app/api/webhook/calendly/route.ts
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.event ?? "";

    console.log(`[calendly webhook] event: ${eventType}`);

    // ── Meeting booked ────────────────────────────────────────────────────────
    if (eventType === "invitee.created") {
      const payload    = body.payload;
      // Direct Calendly v2 sends the invitee AS the payload with `scheduled_event`
      // nested. Support both that and the legacy Make-forwarded { invitee, event } shape.
      const invitee    = payload.invitee ?? payload;
      const event      = payload.event ?? payload.scheduled_event ?? {};

      const leadName   = invitee.name ?? [invitee.first_name, invitee.last_name].filter(Boolean).join(" ") ?? "";
      const leadEmail  = invitee.email ?? "";
      const scheduledAt = new Date(event.start_time);
      const bookedAt   = event.created_at ?? invitee.created_at ?? new Date().toISOString();
      const eventName  = event.name ?? "";
      const eventUri   = event.uri ?? "";
      const inviteeUri = invitee.uri ?? "";
      // Phone + website come from the booking (reminder number, or a Q&A answer).
      const qa: Array<{ question?: string; answer?: string }> = invitee.questions_and_answers ?? [];
      const phone   = invitee.text_reminder_number ?? qa.find(q => /phone|mobile|number/i.test(q.question ?? ""))?.answer ?? undefined;
      const website = qa.find(q => /website|url|site/i.test(q.question ?? ""))?.answer ?? undefined;

      // Match to existing reply by email
      const replyResult = await pool.query(
        "SELECT id, workspace_slug FROM replies WHERE lead_email = $1 ORDER BY received_at DESC LIMIT 1",
        [leadEmail]
      );
      const replyId      = replyResult.rows[0]?.id ?? null;
      const workspaceSlug = replyResult.rows[0]?.workspace_slug ?? "unknown";

      // ── Dedup: check for existing Calendly event (exact URI match) ─────────
      const exactDup = await pool.query(
        "SELECT id FROM calls WHERE calendly_event_uri = $1 LIMIT 1",
        [eventUri]
      );
      if (exactDup.rows.length > 0) {
        return NextResponse.json({ ok: true, event: "invitee.created", note: "duplicate" });
      }

      // ── Check 60-day window for reschedule detection ───────────────────────
      const recentCall = await pool.query(
        `SELECT id, scheduled_at, status, is_reschedule, original_call_id
         FROM calls
         WHERE lead_email = $1
           AND scheduled_at >= NOW() - INTERVAL '60 days'
           AND source = 'calendly'
         ORDER BY scheduled_at DESC
         LIMIT 1`,
        [leadEmail]
      );

      // Also check manual calls within 2-hour window (dedup manual + calendly)
      const manualDup = await pool.query(
        `SELECT id FROM calls
         WHERE lead_email = $1
           AND source = 'manual'
           AND ABS(EXTRACT(EPOCH FROM (scheduled_at - $2))) < 7200`,
        [leadEmail, scheduledAt]
      );

      if (manualDup.rows.length > 0) {
        // Merge: update the manual entry with Calendly URI
        await pool.query(
          `UPDATE calls SET calendly_event_uri = $1, source = 'calendly', updated_at = NOW()
           WHERE id = $2`,
          [eventUri, manualDup.rows[0].id]
        );
        return NextResponse.json({ ok: true, event: "invitee.created", note: "merged_with_manual" });
      }

      let isReschedule = false;
      let originalCallId: string | null = null;

      if (recentCall.rows.length > 0) {
        const prev = recentCall.rows[0];
        isReschedule = true;
        originalCallId = prev.original_call_id ?? prev.id;
        await pool.query(
          `UPDATE calls SET status = 'rescheduled', updated_at = NOW() WHERE id = $1`,
          [prev.id]
        );
      }

      const callId = `call-cal-${inviteeUri.split("/").pop() ?? Date.now()}`;

      await pool.query(
        `INSERT INTO calls (
          id, reply_id, workspace_slug, lead_email, lead_name,
          source, calendly_event_uri, scheduled_at,
          status, is_reschedule, original_call_id,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'calendly',$6,$7,'scheduled',$8,$9,NOW(),NOW())`,
        [callId, replyId, workspaceSlug, leadEmail, leadName,
         eventUri, scheduledAt, isReschedule, originalCallId]
      );

      // Mark reply as meeting booked
      if (replyId) {
        await pool.query(
          `UPDATE replies SET meeting_booked = TRUE WHERE id = $1`,
          [replyId]
        );
      }

      // Stop any active FU sequence for this lead and record the outcome
      await pool.query(
        `UPDATE follow_ups
           SET meeting_booked = TRUE,
               next_fu_due = NULL,
               outcome = 'booked',
               converted_at_step = fu_step
         WHERE lead_email = $1 AND meeting_booked = FALSE`,
        [leadEmail]
      );

      return NextResponse.json({ ok: true, event: "invitee.created", callId, isReschedule });
    }

    // ── Meeting canceled ──────────────────────────────────────────────────────
    if (eventType === "invitee.canceled") {
      const eventUri = body.payload?.event?.uri ?? "";
      if (eventUri) {
        await pool.query(
          `UPDATE calls SET status = 'cancelled', updated_at = NOW()
           WHERE calendly_event_uri = $1`,
          [eventUri]
        );
      }
      return NextResponse.json({ ok: true, event: "invitee.canceled" });
    }

    return NextResponse.json({ ok: true, event: eventType, note: "unhandled" });

  } catch (err: any) {
    console.error("[calendly webhook] error:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — Calendly webhook" });
}