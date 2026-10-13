// Meeting sync for clients who book through GoHighLevel (LeadConnector) instead of
// Calendly/iClosed/Fillout. A GoHighLevel private integration token cannot register a
// webhook (those need a Marketplace app or a workflow built inside the client's account),
// so this polls GET /calendars/events for the one booking calendar we care about and runs
// the same booking/reschedule/cancellation handling as lib/calendly-poll-sync.ts.
//
// The booker's email comes from appointmentMeta.defaultFormDetails, which GoHighLevel
// only fills in for bookings made through the public booking widget (the link we send in
// outreach). An appointment a rep creates by hand inside GoHighLevel has only a contactId,
// and reading that needs the "View Contacts" scope on the token. We try the contact
// lookup anyway, so those bookings start tracking on their own once the scope is added.
import pool from "@/lib/db";
import { trackMeeting, trackCancellation, MEETING_CONFIG } from "@/lib/meetings-tracker";
import { isInternalContact } from "@/lib/internal-blocklist";
import { closeManualCardsForLead } from "@/lib/manual-card";

const GHL_BASE = "https://services.leadconnectorhq.com";

interface GhlPollTarget {
  workspaceSlug: string;
  locationId: string;
  /** Only this calendar is tracked. GoHighLevel accounts host many internal calendars. */
  calendarId: string;
  tokenEnv: string;
  /** No-backfill cutoff: appointments created before this are never tracked. */
  trackFromISO: string;
}

const POLL_TARGETS: GhlPollTarget[] = [
  // Opkie (2026-10-13). Calendar "(Qualified) Strategy Call", the one behind
  // link.opkie.com/widget/bookings/opkie-strategy-call. The location has 24 calendars,
  // most of them internal (1:1s, onboarding calls, a podcast), so never widen this.
  {
    workspaceSlug: "opkie",
    locationId: "vmzEamyXqsd9g2bEFYGu",
    calendarId: "BRL34eYzQ16BNOIiLz3F",
    tokenEnv: "OPKIE_GHL_TOKEN",
    trackFromISO: "2026-10-13T00:00:00Z",
  },
];

async function ghlGet(path: string, token: string, version: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchCalendarEvents(target: GhlPollTarget, token: string): Promise<any[]> {
  // 30 days back catches late cancellations and reschedules of recent calls, 90 days
  // forward covers how far out the booking widget lets a lead book.
  const day = 24 * 3600 * 1000;
  const params = new URLSearchParams({
    locationId: target.locationId,
    calendarId: target.calendarId,
    startTime: String(Date.now() - 30 * day),
    endTime: String(Date.now() + 90 * day),
  });
  const data = await ghlGet(`/calendars/events?${params.toString()}`, token, "2021-04-15");
  return data.events ?? [];
}

async function resolveBooker(event: any, token: string): Promise<{ email: string; name: string; phone?: string }> {
  const form = event.appointmentMeta?.defaultFormDetails;
  // Appointment titles follow the calendar's "{{contact.name}} - Strategy Call" template.
  const titleName = String(event.title ?? "").split(" - ")[0].trim();
  if (form?.email) {
    return {
      email: String(form.email).trim(),
      name: [form.firstName, form.lastName].filter(Boolean).join(" ") || titleName,
      phone: form.phone || undefined,
    };
  }
  if (event.contactId) {
    try {
      const data = await ghlGet(`/contacts/${event.contactId}`, token, "2021-07-28");
      const c = data.contact ?? data;
      return {
        email: String(c.email ?? "").trim(),
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || titleName,
        phone: c.phone || undefined,
      };
    } catch {
      // Token has no contacts scope. Caller logs and skips.
    }
  }
  return { email: "", name: titleName };
}

/** Runs the poll for every client in POLL_TARGETS. Never throws. */
export async function pollGhlBookings(): Promise<void> {
  for (const target of POLL_TARGETS) {
    const token = process.env[target.tokenEnv];
    if (!token) {
      console.warn(`[ghl-poll-sync] missing ${target.tokenEnv} for ${target.workspaceSlug}, skipping`);
      continue;
    }
    // Hold everything until the client's Airtable/Slack config exists. Writing the calls
    // row now would mark the booking as handled and it would never reach Airtable later.
    if (!MEETING_CONFIG[target.workspaceSlug]) {
      console.warn(`[ghl-poll-sync] no MEETING_CONFIG for ${target.workspaceSlug} yet, skipping`);
      continue;
    }
    try {
      const events = await fetchCalendarEvents(target, token);

      for (const event of events) {
        const eventKey = event.id ? `ghl:${event.id}` : "";
        const scheduledAt = new Date(event.startTime);
        if (!eventKey || isNaN(scheduledAt.getTime())) continue;

        if (event.appointmentStatus === "cancelled" || event.deleted === true) {
          const updated = await pool.query(
            `UPDATE calls SET status = 'cancelled', updated_at = NOW()
              WHERE calendly_event_uri = $1 AND status != 'cancelled'
            RETURNING lead_email, lead_name`,
            [eventKey]
          );
          const row = updated.rows[0];
          if (row) {
            void trackCancellation({
              workspaceSlug: target.workspaceSlug,
              leadEmail: row.lead_email,
              leadName: row.lead_name,
              meetingStartISO: scheduledAt.toISOString(),
              eventTypeName: "Strategy Call",
            }).catch((err: any) => console.error(`[ghl-poll-sync] trackCancellation failed (${target.workspaceSlug}):`, err?.message ?? err));
            console.log(`[ghl-poll-sync] detected cancellation (${target.workspaceSlug}) ${row.lead_email}`);
          }
          continue;
        }

        const existing = await pool.query(
          `SELECT id, lead_email, lead_name, scheduled_at, status, original_call_id FROM calls WHERE calendly_event_uri = $1 LIMIT 1`,
          [eventKey]
        );
        const prev = existing.rows[0];
        if (prev) {
          // GoHighLevel keeps the same appointment id on a reschedule, only startTime moves.
          if (prev.status === "scheduled" && new Date(prev.scheduled_at).getTime() !== scheduledAt.getTime()) {
            await pool.query(
              `UPDATE calls SET scheduled_at = $1, is_reschedule = TRUE,
                                original_call_id = COALESCE($2, id), updated_at = NOW()
                WHERE id = $3`,
              [scheduledAt, prev.original_call_id, prev.id]
            );
            void trackMeeting({
              workspaceSlug: target.workspaceSlug,
              leadEmail: prev.lead_email,
              leadName: prev.lead_name,
              meetingStartISO: scheduledAt.toISOString(),
              bookedAtISO: event.dateAdded ?? new Date().toISOString(),
              eventTypeName: "Strategy Call",
            }).catch((err: any) => console.error(`[ghl-poll-sync] trackMeeting (reschedule) failed (${target.workspaceSlug}):`, err?.message ?? err));
            console.log(`[ghl-poll-sync] detected reschedule (${target.workspaceSlug}) ${prev.lead_email}`);
          }
          continue;
        }

        // No backfill: only appointments created from the cutoff onward are tracked.
        if (!event.dateAdded || new Date(event.dateAdded) < new Date(target.trackFromISO)) continue;

        const { email: leadEmail, name: leadName, phone } = await resolveBooker(event, token);
        if (!leadEmail) {
          console.warn(`[ghl-poll-sync] no email on appointment ${event.id} (${target.workspaceSlug}, source ${event.createdBy?.source ?? "unknown"}), token cannot read contacts. Skipping until it can.`);
          continue;
        }

        if (isInternalContact(target.workspaceSlug, leadEmail, leadName)) continue;

        const replyResult = await pool.query(
          `SELECT id FROM replies
            WHERE workspace_slug = $2 AND (LOWER(lead_email) = LOWER($1) OR LOWER(preferred_recipient_email) = LOWER($1))
            ORDER BY received_at DESC LIMIT 1`,
          [leadEmail, target.workspaceSlug]
        );
        const replyId = replyResult.rows[0]?.id ?? null;

        await pool.query(
          `INSERT INTO calls (
            id, reply_id, workspace_slug, lead_email, lead_name,
            source, calendly_event_uri, scheduled_at, status, is_reschedule,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,'ghl',$6,$7,'scheduled',false,NOW(),NOW())
          ON CONFLICT (id) DO NOTHING`,
          [`call-ghl-${event.id}`, replyId, target.workspaceSlug, leadEmail, leadName, eventKey, scheduledAt]
        );

        if (replyId) {
          await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
        }
        void closeManualCardsForLead(leadEmail);
        await pool.query(
          `UPDATE follow_ups
              SET meeting_booked = TRUE, next_fu_due = NULL, outcome = 'booked', converted_at_step = fu_step
            WHERE lead_email = $1 AND workspace_slug = $2 AND meeting_booked = FALSE`,
          [leadEmail, target.workspaceSlug]
        );

        void trackMeeting({
          workspaceSlug: target.workspaceSlug,
          leadEmail,
          leadName,
          meetingStartISO: scheduledAt.toISOString(),
          bookedAtISO: event.dateAdded,
          eventTypeName: "Strategy Call",
          phone,
        }).catch((err: any) => console.error(`[ghl-poll-sync] trackMeeting failed (${target.workspaceSlug}):`, err?.message ?? err));

        console.log(`[ghl-poll-sync] tracked new booking (${target.workspaceSlug}) ${leadEmail}`);
      }
    } catch (err: any) {
      console.error(`[ghl-poll-sync] failed for ${target.workspaceSlug}:`, err?.message ?? err);
    }
  }
}
