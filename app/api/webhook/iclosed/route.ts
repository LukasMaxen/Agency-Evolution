// app/api/webhook/iclosed/route.ts
//
// iClosed webhook receiver — the "invitee.created" equivalent for GN Motion, which books
// through iClosed instead of Calendly. Mirrors app/api/webhook/calendly/route.ts field for
// field (calls table, follow_ups close-out, trackMeeting, manual-card close-out), adapted
// to iClosed's payload shape.
//
// iClosed webhooks fire ACCOUNT-WIDE (no per-event scoping at registration, confirmed
// against the developer docs and OpenAPI spec 2026-08-27) — so every event this workspace
// has ever configured shows up here, not just the two we care about. Filtering happens via
// MEETING_CONFIG[workspaceSlug].iclosedEventIds against event_type.uuid before anything is
// written.
//
// Register the webhook URL in the iClosed dashboard as:
//   POST https://<app-host>/api/webhook/iclosed?ws=gn-motion
// with triggers: newCallScheduled, callRescheduled, callCancelled.
//
// Discriminator field is `hookType` (a human string, not an enum): "Call booked",
// "Call rescheduled", "Call cancelled", "Call outcome added" — there is no top-level
// "event" field like Calendly's.
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { trackMeeting, MEETING_CONFIG } from "@/lib/meetings-tracker";
import { isInternalContact } from "@/lib/internal-blocklist";
import { closeManualCardsForLead } from "@/lib/manual-card";

interface IclosedQA {
  question?: string;
  answer?: string | number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const hookType = body.hookType ?? "";
    const eventType = body.event_type ?? {};
    const event = body.event ?? {};
    const invitee = body.invitee ?? {};

    console.log(`[iclosed webhook] hookType: ${hookType}`);

    // ?ws= HARD override — GN Motion is the only iClosed client today and its leads may
    // not always match an existing reply row (e.g. inbound booking from a fresh contact),
    // same reasoning as sonaro-ai's Calendly registration.
    const workspaceSlug = req.nextUrl.searchParams.get("ws") ?? "unknown";

    const eventTypeId: number | undefined = eventType.uuid;
    const cfg = MEETING_CONFIG[workspaceSlug];
    const leadName = invitee.name ?? [invitee.first_name, invitee.last_name].filter(Boolean).join(" ") ?? "";
    const leadEmail = invitee.email ?? "";
    // callPreviewId is stable across booked -> rescheduled -> cancelled for the same call,
    // so it doubles as our dedup/lookup key. Reused from the Calendly column on purpose —
    // both are just "this source's unique id for the call", no schema change needed.
    const callPreviewId: string = event.callPreviewId ?? "";

    if (cfg?.iclosedEventIds && (eventTypeId === undefined || !cfg.iclosedEventIds.includes(eventTypeId))) {
      console.log(`[iclosed webhook] event id ${eventTypeId} not tracked for ${workspaceSlug} — skipping Airtable/Slack`);
      // Intentionally no Airtable/Slack post here — most GN Motion historical bookings land
      // on the excluded default event and alerting on every one would flood the channel
      // (see project_gn_motion_iclosed_gap memory). But a booking against an untracked event
      // still happened and was previously left with zero trace anywhere, which is how the
      // Cordaroys/Daryl Drown booking (2026-09-03) went undetected for days. Log a bare
      // discoverable row so a later "did X actually book?" check can find it directly instead
      // of manually cross-referencing EmailBison threads and Slack history.
      if ((hookType === "Call booked" || hookType === "Call rescheduled") && leadEmail) {
        const scheduledAt = new Date(event.utc_start_time);
        if (!isNaN(scheduledAt.getTime())) {
          try {
            await pool.query(
              `INSERT INTO calls (
                id, reply_id, workspace_slug, lead_email, lead_name,
                source, calendly_event_uri, scheduled_at,
                status, is_reschedule, original_call_id,
                created_at, updated_at
              ) VALUES ($1,NULL,$2,$3,$4,'iclosed',$5,$6,'untracked_event',FALSE,NULL,NOW(),NOW())
              ON CONFLICT (id) DO NOTHING`,
              [
                `call-icl-untracked-${callPreviewId || Date.now()}`,
                workspaceSlug,
                leadEmail,
                leadName,
                callPreviewId || null,
                scheduledAt,
              ]
            );
          } catch (e: any) {
            console.error("[iclosed webhook] failed to log untracked-event booking:", e?.message ?? e);
          }
        }
      }
      return NextResponse.json({ ok: true, hookType, note: "event_not_tracked" });
    }

    if (isInternalContact(workspaceSlug, leadEmail, leadName)) {
      console.log(`[iclosed webhook] internal contact ${leadEmail} in ${workspaceSlug} — blocklisted, skipping`);
      return NextResponse.json({ ok: true, hookType, note: "internal_blocklisted" });
    }

    // ── Call cancelled ────────────────────────────────────────────────────────
    if (hookType === "Call cancelled") {
      if (callPreviewId) {
        await pool.query(
          `UPDATE calls SET status = 'cancelled', updated_at = NOW() WHERE calendly_event_uri = $1`,
          [callPreviewId]
        );
      }
      return NextResponse.json({ ok: true, hookType });
    }

    // ── Call outcome added — informational only, nothing to track here ─────────
    if (hookType === "Call outcome added") {
      return NextResponse.json({ ok: true, hookType, note: "unhandled" });
    }

    // ── Call booked / Call rescheduled ──────────────────────────────────────────
    if (hookType === "Call booked" || hookType === "Call rescheduled") {
      const scheduledAt = new Date(event.utc_start_time);
      if (isNaN(scheduledAt.getTime())) {
        console.error("[iclosed webhook] no valid utc_start_time in payload — skipping", JSON.stringify(event).slice(0, 200));
        return NextResponse.json({ ok: true, hookType, note: "no_start_time" });
      }
      if (!leadEmail || !callPreviewId) {
        console.error("[iclosed webhook] missing invitee email or callPreviewId — skipping");
        return NextResponse.json({ ok: true, hookType, note: "missing_required_fields" });
      }
      const bookedAt = event.created_at ?? invitee.created_at ?? new Date().toISOString();
      const eventName = eventType.name ?? "";
      const phone = invitee.text_reminder_number ?? undefined;

      const qa: IclosedQA[] = body.questions_and_answers ?? [];
      const website = qa.find(q => /website|url|site/i.test(q.question ?? ""))?.answer;
      const otherQA = qa
        .filter(q => {
          const question = (q.question ?? "").trim();
          if (!question || q.answer === undefined || q.answer === null || q.answer === "") return false;
          // Drop fields already surfaced elsewhere in the Slack message (name/email/phone).
          if (/^(email address|full name|first name|last name)$/i.test(question)) return false;
          if (/phone|mobile|number/i.test(question)) return false;
          if (/website|url|site/i.test(question)) return false;
          return true;
        })
        .map(q => ({ question: q.question!.trim(), answer: String(q.answer) }));

      const replyResult = await pool.query(
        "SELECT id FROM replies WHERE lead_email = $1 OR preferred_recipient_email = $1 ORDER BY received_at DESC LIMIT 1",
        [leadEmail]
      );
      const replyId = replyResult.rows[0]?.id ?? null;

      const existing = await pool.query(
        "SELECT id, is_reschedule, original_call_id FROM calls WHERE calendly_event_uri = $1 LIMIT 1",
        [callPreviewId]
      );

      if (existing.rows.length > 0) {
        // Reschedule of a call we already have (or a duplicate "Call booked" retry) —
        // update in place rather than inserting a second row.
        const prev = existing.rows[0];
        await pool.query(
          `UPDATE calls SET scheduled_at = $1, status = 'scheduled', is_reschedule = TRUE,
                            original_call_id = COALESCE($2, id), updated_at = NOW()
           WHERE id = $3`,
          [scheduledAt, prev.original_call_id, prev.id]
        );
      } else {
        const callId = `call-icl-${callPreviewId.replace(/^call_/, "") || Date.now()}`;
        await pool.query(
          `INSERT INTO calls (
            id, reply_id, workspace_slug, lead_email, lead_name,
            source, calendly_event_uri, scheduled_at,
            status, is_reschedule, original_call_id,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,'iclosed',$6,$7,'scheduled',FALSE,NULL,NOW(),NOW())`,
          [callId, replyId, workspaceSlug, leadEmail, leadName, callPreviewId, scheduledAt]
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
        bookedAtISO: new Date(bookedAt).toISOString(),
        prettyTime,
        eventTypeName: eventName,
        phone,
        website: website !== undefined ? String(website) : undefined,
        qa: otherQA,
      }).catch((err: any) => console.error("[iclosed webhook] trackMeeting failed:", err?.message ?? err));

      return NextResponse.json({ ok: true, hookType });
    }

    return NextResponse.json({ ok: true, hookType, note: "unhandled" });

  } catch (err: any) {
    // NEVER return non-2xx — same reasoning as the Calendly receiver: repeated failures
    // can get the webhook subscription disabled on iClosed's side.
    console.error("[iclosed webhook] error (returning 200 to avoid disable):", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? "handled" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — iClosed webhook" });
}
