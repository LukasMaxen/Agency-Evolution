// app/api/webhook/fillout/route.ts
//
// Fillout webhook receiver — WithPebble books via a native FILLOUT scheduling block
// ("Strategy Call", form id pvazF8omZwus, scheduling block id "fD34"), not Calendly or
// iClosed. Mirrors app/api/webhook/calendly/route.ts and app/api/webhook/iclosed/route.ts
// (calls table, follow_ups close-out, trackMeeting), adapted to Fillout's submission shape.
//
// Confirmed live via GET https://api.fillout.com/v1/api/forms/pvazF8omZwus/submissions
// (2026-09-01) — a submission looks like:
//   { submissionId, submissionTime, questions: [{id,name,type,value}, ...],
//     scheduling: [{ id: "fD34", name: "Strategy Call", value: {
//       fullName, email, phone, timezone, eventStartTime, eventEndTime, eventId,
//       eventUrl, rescheduleOrCancelUrl, scheduledUserEmail, scheduledUserName } }] }
// Fillout's webhook-creation doc does not document the exact POST body, so this is written
// defensively: accepts either the submission object directly, or wrapped under
// body.submission (some form-tool webhooks add a formId/formName wrapper).
//
// Fillout has no documented distinct "rescheduled"/"cancelled" webhook event — a reschedule
// may or may not re-fire this webhook for the same eventId. Handled by upserting on eventId
// (reused via the calendly_event_uri column, same convention as iClosed's callPreviewId):
// existing row -> update scheduled_at in place; new eventId -> insert. No cancellation
// handling yet (Fillout gives no signal for it that we've found) — a known gap, not a bug.
//
// Register the webhook (after this route is deployed and live) with:
//   POST https://api.fillout.com/v1/api/webhook/create
//   Authorization: Bearer <WITHPEBBLE_FILLOUT_API_KEY>
//   { "formId": "pvazF8omZwus", "url": "https://<app-host>/api/webhook/fillout?ws=with-pebble" }
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { trackMeeting } from "@/lib/meetings-tracker";
import { isInternalContact } from "@/lib/internal-blocklist";
import { closeManualCardsForLead } from "@/lib/manual-card";

interface FilloutQuestion {
  id?: string;
  name?: string;
  type?: string;
  value?: string | number | string[] | null;
}

interface FilloutSchedulingValue {
  fullName?: string;
  email?: string;
  phone?: string;
  eventStartTime?: string;
  eventEndTime?: string;
  eventId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const submission = (body.submission && typeof body.submission === "object") ? body.submission : body;

    // ?ws= HARD override — same convention as sonaro-ai/gn-motion's dedicated webhooks.
    // WithPebble's Fillout account is single-tenant, so this always resolves to with-pebble
    // in practice, but the param keeps the route reusable if another client adopts Fillout.
    const workspaceSlug = req.nextUrl.searchParams.get("ws") ?? "with-pebble";

    const questions: FilloutQuestion[] = submission.questions ?? [];
    const scheduling = (submission.scheduling ?? [])[0];
    const sv: FilloutSchedulingValue = scheduling?.value ?? {};

    console.log(`[fillout webhook] submission ${submission.submissionId ?? "?"} for ${workspaceSlug}`);

    if (!sv.email || !sv.eventStartTime || !sv.eventId) {
      console.error("[fillout webhook] missing email/eventStartTime/eventId — skipping", JSON.stringify(submission).slice(0, 300));
      return NextResponse.json({ ok: true, note: "missing_required_fields" });
    }

    const leadEmail = sv.email;
    const leadName = sv.fullName ?? "";
    const phone = sv.phone || undefined;
    const scheduledAt = new Date(sv.eventStartTime);
    if (isNaN(scheduledAt.getTime())) {
      console.error("[fillout webhook] invalid eventStartTime — skipping", sv.eventStartTime);
      return NextResponse.json({ ok: true, note: "no_start_time" });
    }
    const eventId = sv.eventId;
    const eventTypeName = scheduling?.name ?? "Strategy Call";

    if (isInternalContact(workspaceSlug, leadEmail, leadName)) {
      console.log(`[fillout webhook] internal contact ${leadEmail} in ${workspaceSlug} — blocklisted, skipping`);
      return NextResponse.json({ ok: true, note: "internal_blocklisted" });
    }

    // Every custom form question (e.g. "What is your product/company?", spend range),
    // passed through verbatim as a numbered list, same as Calendly/iClosed Q&A.
    const otherQA = questions
      .filter(q => q.name?.trim() && q.value !== undefined && q.value !== null && q.value !== "" && !(Array.isArray(q.value) && q.value.length === 0))
      .map(q => ({ question: q.name!.trim(), answer: Array.isArray(q.value) ? q.value.join(", ") : String(q.value) }));

    const replyResult = await pool.query(
      "SELECT id FROM replies WHERE lead_email = $1 OR preferred_recipient_email = $1 ORDER BY received_at DESC LIMIT 1",
      [leadEmail]
    );
    const replyId = replyResult.rows[0]?.id ?? null;

    const existing = await pool.query(
      "SELECT id, is_reschedule, original_call_id FROM calls WHERE calendly_event_uri = $1 LIMIT 1",
      [eventId]
    );

    let isReschedule = false;
    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      isReschedule = true;
      await pool.query(
        `UPDATE calls SET scheduled_at = $1, status = 'scheduled', is_reschedule = TRUE,
                          original_call_id = COALESCE($2, id), updated_at = NOW()
         WHERE id = $3`,
        [scheduledAt, prev.original_call_id, prev.id]
      );
    } else {
      const callId = `call-fil-${eventId}`;
      await pool.query(
        `INSERT INTO calls (
          id, reply_id, workspace_slug, lead_email, lead_name,
          source, calendly_event_uri, scheduled_at,
          status, is_reschedule, original_call_id,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'fillout',$6,$7,'scheduled',FALSE,NULL,NOW(),NOW())`,
        [callId, replyId, workspaceSlug, leadEmail, leadName, eventId, scheduledAt]
      );
    }

    if (replyId) {
      await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
    }

    void closeManualCardsForLead(leadEmail);

    await pool.query(
      `UPDATE follow_ups
         SET meeting_booked = TRUE,
             next_fu_due = NULL,
             outcome = 'booked',
             converted_at_step = fu_step
       WHERE lead_email = $1 AND meeting_booked = FALSE`,
      [leadEmail]
    );

    const prettyTime = scheduledAt.toLocaleString("en-US", {
      month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
    }) + " CET";

    void trackMeeting({
      workspaceSlug,
      leadEmail,
      leadName,
      meetingStartISO: scheduledAt.toISOString(),
      bookedAtISO: new Date(submission.submissionTime ?? Date.now()).toISOString(),
      prettyTime,
      eventTypeName,
      phone,
      qa: otherQA,
    }).catch((err: any) => console.error("[fillout webhook] trackMeeting failed:", err?.message ?? err));

    return NextResponse.json({ ok: true, isReschedule });

  } catch (err: any) {
    // NEVER return non-2xx — same reasoning as the Calendly/iClosed receivers: repeated
    // failures risk the webhook subscription getting disabled on Fillout's side.
    console.error("[fillout webhook] error (returning 200 to avoid disable):", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? "handled" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — Fillout webhook" });
}
