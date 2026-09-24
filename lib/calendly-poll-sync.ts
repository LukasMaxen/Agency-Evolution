// Fallback meeting sync for Calendly clients whose account can't run a webhook
// subscription. Calendly's `scheduled_events` / `invitees` endpoints are read-only and
// work on every plan tier (confirmed 2026-09-24) — only POST /webhook_subscriptions
// requires a paid (Standard+) plan, which is what blocked MP Consulting (Maddie Poteat's
// account is on Calendly's free tier, POST /webhook_subscriptions returned 403 "Please
// upgrade your Calendly account to Standard"). This polls those endpoints instead and
// runs the same booking/cancellation handling the real webhook (app/api/webhook/calendly)
// does, just on a delay instead of instantly.
//
// Remove an entry from POLL_TARGETS once that client's Calendly account is upgraded and
// a real webhook is registered — leaving both running would double-process the same
// booking (the webhook fires status='scheduled' with a fresh calendly_event_uri, then
// this poll would see a duplicate for the same event only if the uri already exists in
// `calls`, which the dedup check below prevents — so it is technically safe to run both,
// but redundant and slower to react to cancellations, so still swap it out).
import pool from "@/lib/db";
import { trackMeeting, trackCancellation } from "@/lib/meetings-tracker";
import { isInternalContact } from "@/lib/internal-blocklist";
import { closeManualCardsForLead } from "@/lib/manual-card";

interface PollTarget {
  workspaceSlug: string;
  userUri: string;
  tokenEnv: string;
}

const POLL_TARGETS: PollTarget[] = [
  // MP Consulting (2026-09-24). See clients/mp-consulting.md and
  // lib/meetings-tracker.ts MEETING_CONFIG["mp-consulting"] for the rest of the wiring.
  {
    workspaceSlug: "mp-consulting",
    userUri: "https://api.calendly.com/users/b58c74f0-f259-459b-939f-9e9bd89e525e",
    tokenEnv: "MP_CONSULTING_CALENDLY_TOKEN",
  },
];

async function fetchScheduledEvents(userUri: string, token: string, minStartTime: string): Promise<any[]> {
  const params = new URLSearchParams({ user: userUri, count: "100", sort: "start_time:desc", min_start_time: minStartTime });
  const res = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`scheduled_events -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.collection ?? [];
}

async function fetchFirstInvitee(eventUri: string, token: string): Promise<any | null> {
  const res = await fetch(`${eventUri}/invitees?count=1`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.collection?.[0] ?? null;
}

/** Runs the poll for every client in POLL_TARGETS. Never throws. */
export async function pollCalendlyBookings(): Promise<void> {
  for (const target of POLL_TARGETS) {
    const token = process.env[target.tokenEnv];
    if (!token) {
      console.warn(`[calendly-poll-sync] missing ${target.tokenEnv} for ${target.workspaceSlug} — skipping`);
      continue;
    }
    try {
      // 30-day lookback: wide enough to catch a booking placed just before this sync
      // started running, without re-scanning the account's entire history every cycle.
      const minStartTime = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const events = await fetchScheduledEvents(target.userUri, token, minStartTime);

      for (const event of events) {
        const eventUri: string = event.uri;
        const scheduledAt = new Date(event.start_time);
        if (!eventUri || isNaN(scheduledAt.getTime())) continue;

        if (event.status === "canceled") {
          const updated = await pool.query(
            `UPDATE calls SET status = 'cancelled', updated_at = NOW()
              WHERE calendly_event_uri = $1 AND status != 'cancelled'
            RETURNING lead_email, lead_name`,
            [eventUri]
          );
          const row = updated.rows[0];
          if (row) {
            void trackCancellation({
              workspaceSlug: target.workspaceSlug,
              leadEmail: row.lead_email,
              leadName: row.lead_name,
              meetingStartISO: scheduledAt.toISOString(),
              eventTypeName: event.name ?? undefined,
            }).catch((err: any) => console.error(`[calendly-poll-sync] trackCancellation failed (${target.workspaceSlug}):`, err?.message ?? err));
            console.log(`[calendly-poll-sync] detected cancellation (${target.workspaceSlug}) ${row.lead_email}`);
          }
          continue;
        }

        // Already tracked (either a previous poll, or a real webhook if one gets
        // registered later) — skip.
        const existing = await pool.query(`SELECT id FROM calls WHERE calendly_event_uri = $1 LIMIT 1`, [eventUri]);
        if (existing.rows.length > 0) continue;

        const invitee = await fetchFirstInvitee(eventUri, token);
        const leadEmail: string = invitee?.email ?? "";
        const leadName: string = invitee?.name ?? "";
        if (!leadEmail) continue;

        if (isInternalContact(target.workspaceSlug, leadEmail, leadName)) continue;

        const replyResult = await pool.query(
          `SELECT id FROM replies WHERE lead_email = $1 OR preferred_recipient_email = $1 ORDER BY received_at DESC LIMIT 1`,
          [leadEmail]
        );
        const replyId = replyResult.rows[0]?.id ?? null;

        const callId = `call-cal-${eventUri.split("/").pop() ?? Date.now()}`;
        await pool.query(
          `INSERT INTO calls (
            id, reply_id, workspace_slug, lead_email, lead_name,
            source, calendly_event_uri, scheduled_at, status, is_reschedule,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,'calendly',$6,$7,'scheduled',false,NOW(),NOW())
          ON CONFLICT (id) DO NOTHING`,
          [callId, replyId, target.workspaceSlug, leadEmail, leadName, eventUri, scheduledAt]
        );

        if (replyId) {
          await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
        }
        void closeManualCardsForLead(leadEmail);
        await pool.query(
          `UPDATE follow_ups
              SET meeting_booked = TRUE, next_fu_due = NULL, outcome = 'booked', converted_at_step = fu_step
            WHERE lead_email = $1 AND meeting_booked = FALSE`,
          [leadEmail]
        );

        void trackMeeting({
          workspaceSlug: target.workspaceSlug,
          leadEmail,
          leadName,
          meetingStartISO: scheduledAt.toISOString(),
          bookedAtISO: event.created_at ?? new Date().toISOString(),
          eventTypeName: event.name ?? undefined,
        }).catch((err: any) => console.error(`[calendly-poll-sync] trackMeeting failed (${target.workspaceSlug}):`, err?.message ?? err));

        console.log(`[calendly-poll-sync] tracked new booking (${target.workspaceSlug}) ${leadEmail}`);
      }
    } catch (err: any) {
      console.error(`[calendly-poll-sync] failed for ${target.workspaceSlug}:`, err?.message ?? err);
    }
  }
}
