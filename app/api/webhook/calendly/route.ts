// app/api/webhook/calendly/route.ts
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { trackMeeting } from "@/lib/meetings-tracker";
import { isInternalContact } from "@/lib/internal-blocklist";
import { crossBlacklistLarsen } from "@/lib/larsen-cross-blacklist";
import { closeManualCardsForLead } from "@/lib/manual-card";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.event ?? "";
    // Workspace resolution knobs on the registered webhook URL:
    //   ?ws=<slug>        HARD override — always this workspace. Use for dedicated Calendly
    //                     orgs whose leads are not in the reply desk (e.g. Sonaro).
    //   ?wsDefault=<slug> FALLBACK — used only when the booker's email matches no reply row.
    //                     Use for shared orgs (Larsen) so a test booking, or a lead who books
    //                     from a different address than we emailed, still lands somewhere
    //                     instead of resolving to "unknown" and being dropped.
    const wsOverride = req.nextUrl.searchParams.get("ws");
    const wsDefault  = req.nextUrl.searchParams.get("wsDefault");

    console.log(`[calendly webhook] event: ${eventType}`);

    // ── Meeting booked ────────────────────────────────────────────────────────
    if (eventType === "invitee.created") {
      const payload    = body.payload ?? {};
      // Direct Calendly v2 sends the invitee AS the payload. The invitee resource has BOTH
      // an `event` field (a URI STRING) and a `scheduled_event` OBJECT — so we must prefer
      // the object and never treat the URI string as the event (that gave Invalid Date ->
      // 500 -> Calendly disabled the webhook, 2026-07-31). Legacy Make shape used {invitee,
      // event:{...}}, so we also accept payload.event when it is an object.
      const invitee    = (payload.invitee && typeof payload.invitee === "object") ? payload.invitee : payload;
      const event      = (payload.scheduled_event && typeof payload.scheduled_event === "object") ? payload.scheduled_event
                       : (payload.event && typeof payload.event === "object") ? payload.event
                       : (invitee.scheduled_event && typeof invitee.scheduled_event === "object") ? invitee.scheduled_event
                       : {};

      const leadName   = invitee.name ?? [invitee.first_name, invitee.last_name].filter(Boolean).join(" ") ?? "";
      const leadEmail  = invitee.email ?? "";
      const scheduledAt = new Date(event.start_time);
      if (isNaN(scheduledAt.getTime())) {
        console.error("[calendly webhook] no valid start_time in payload — skipping", JSON.stringify(event).slice(0, 200));
        return NextResponse.json({ ok: true, event: "invitee.created", note: "no_start_time" });
      }
      const bookedAt   = event.created_at ?? invitee.created_at ?? new Date().toISOString();
      const eventName  = event.name ?? "";
      const eventUri   = event.uri ?? "";
      const inviteeUri = invitee.uri ?? "";
      // Phone + website come from the booking (reminder number, or a Q&A answer). Every other
      // question the lead answered (revenue, sales channel, timeline to exit, etc.) is passed
      // through verbatim to the Slack message as a numbered list, in the order Calendly asked
      // them — previously these were silently discarded since only phone/website were picked out.
      const qa: Array<{ question?: string; answer?: string; position?: number }> = invitee.questions_and_answers ?? [];
      const phone   = invitee.text_reminder_number ?? qa.find(q => /phone|mobile|number/i.test(q.question ?? ""))?.answer ?? undefined;
      const website = qa.find(q => /website|url|site/i.test(q.question ?? ""))?.answer ?? undefined;
      const otherQA = qa
        .filter(q => q.question?.trim() && q.answer?.trim() && !/website|url|site/i.test(q.question ?? ""))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(q => ({ question: q.question!.trim(), answer: q.answer!.trim() }));

      // Match to existing reply by email — also match preferred_recipient_email so a
      // redirected/referred contact who books (a different address than the original lead)
      // still resolves to the right workspace.
      const replyResult = await pool.query(
        "SELECT id, workspace_slug FROM replies WHERE lead_email = $1 OR preferred_recipient_email = $1 ORDER BY received_at DESC LIMIT 1",
        [leadEmail]
      );
      const replyId      = replyResult.rows[0]?.id ?? null;
      // Precedence: hard ?ws override, then the email->reply match, then the ?wsDefault
      // fallback, then "unknown". Email match must beat wsDefault so that on a shared org
      // (Larsen + Acceler8rs) a matched Acceler8rs lead is not mis-filed under the default.
      const workspaceSlug = wsOverride ?? replyResult.rows[0]?.workspace_slug ?? wsDefault ?? "unknown";

      // ── Blocklist: never track our own people (Nicklas/Lukas) as booked meetings
      //    in the Larsen workspaces. Skip the whole booking.
      if (isInternalContact(workspaceSlug, leadEmail, leadName)) {
        console.log(`[calendly webhook] internal contact ${leadEmail} in ${workspaceSlug} — blocklisted, skipping`);
        return NextResponse.json({ ok: true, event: "invitee.created", note: "internal_blocklisted" });
      }

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

      // ── Airtable + Slack (replaces the Make "Calendly -> Slack -> AirTable" scenario).
      //    Fire-and-forget: the enrichment (company summary, EBITDA web lookup, ICP fit) can
      //    take several seconds, so we do NOT block the 200 back to Calendly on it — a slow
      //    response risks Calendly marking delivery failed and retrying. The calls row above
      //    is already committed, so the Slack post / Airtable record just lands a moment later.
      void trackMeeting({
        workspaceSlug,
        leadEmail,
        leadName,
        meetingStartISO: scheduledAt.toISOString(),
        bookedAtISO: new Date(bookedAt).toISOString(),
        prettyTime: scheduledAt.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }) + " CET",
        eventTypeName: eventName,
        phone,
        website,
        qa: otherQA,
      }).catch((err: any) => console.error("[calendly webhook] trackMeeting failed:", err?.message ?? err));

      // ── Cross-blacklist between the two Larsen workspaces (larsen-digital <-> acceler8rs):
      //    a lead booked in one must stop receiving cold outreach from the other. No-op for
      //    every other workspace. Fire-and-forget, same reasoning as trackMeeting above.
      void crossBlacklistLarsen(workspaceSlug, leadEmail).catch((err: any) =>
        console.error("[calendly webhook] crossBlacklistLarsen failed:", err?.message ?? err)
      );

      return NextResponse.json({ ok: true, event: "invitee.created", callId, isReschedule });
    }

    // ── Meeting canceled ──────────────────────────────────────────────────────
    if (eventType === "invitee.canceled") {
      const p = body.payload ?? {};
      const eventUri = p.scheduled_event?.uri ?? (typeof p.event === "string" ? p.event : p.event?.uri) ?? "";
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
    // NEVER return non-2xx to Calendly: repeated failures make Calendly disable the
    // webhook subscription (which is exactly what happened 2026-07-31). Log and 200.
    console.error("[calendly webhook] error (returning 200 to avoid disable):", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? "handled" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — Calendly webhook" });
}