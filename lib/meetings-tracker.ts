// Meeting tracker — replaces the Make "Calendly/iClosed -> Slack -> AirTable" scenarios.
//
// One scenario per client in Make did exactly this on every booking:
//   1. Search the client's Airtable "Meetings" table for a record with the lead's email.
//   2. If none  -> create a record (Email, Date Of Meeting = start, Meeting Booked Date =
//      booked-at) and post "New meeting booked with {name}..." to the client's Slack
//      -meetings channel.
//   3. If found -> update Date Of Meeting (a reschedule) and post "Meeting rescheduled...".
//
// This module is the client-agnostic version. The per-client Airtable base/table/field and
// Slack channel live in MEETING_CONFIG below. It is called from the Calendly webhook and
// the iClosed webhook. Best-effort: any failure is logged and swallowed so it never breaks
// the booking flow (the Postgres `calls` record is written independently by the webhooks).

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";

export interface MeetingAirtableFields {
  /** Field NAME (not id) for the lead email column, e.g. "Email". */
  email: string;
  /** Field NAME for the meeting date/time column, e.g. "Date Of Meeting". */
  dateOfMeeting: string;
  /** Field NAME for the booked-at date column, e.g. "Meeting Booked Date". */
  meetingBookedDate: string;
}

export interface MeetingConfig {
  /** Booking tool that fires the webhook for this client. */
  source: "calendly" | "iclosed";
  airtableBaseId: string;
  airtableTableId: string;
  fields: MeetingAirtableFields;
  /** Slack channel id for this client's "-meetings" channel. */
  slackChannel: string;
  /** Optional extra fields to stamp on a newly created record (e.g. Deal Source). */
  extraCreateFields?: Record<string, unknown>;
}

// Keyed by our workspace slug (workspaces.slug / replies.workspace_slug).
// Values mirror the exact Make scenario mappings pulled from the
// "Calendly -> Slack -> AirTable" folder. Fill remaining clients as verified.
export const MEETING_CONFIG: Record<string, MeetingConfig> = {
  // Verified from Make scenario 3802053 "GN Motion: Calendly Automation" (iClosed trigger).
  "gn-motion": {
    source: "iclosed",
    airtableBaseId: "appL5fZEyULdqpyx5",
    airtableTableId: "tblTnxArHDVMNOxSI",
    fields: { email: "Email", dateOfMeeting: "Date Of Meeting", meetingBookedDate: "Meeting Booked Date" },
    slackChannel: "C09JHNBTTQD", // gn-motion-meetings (private)
  },
};

export interface BookingInput {
  workspaceSlug: string;
  leadEmail: string;
  leadName: string;
  /** Meeting start time (ISO). */
  meetingStartISO: string;
  /** When the booking was made (ISO). */
  bookedAtISO: string;
  /** Human-readable meeting time for the Slack message. */
  prettyTime?: string;
  /** Event type label for the Slack message. */
  eventTypeName?: string;
}

async function airtable(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`airtable ${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function postSlack(channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, mrkdwn: true }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`slack chat.postMessage -> ${data.error}`);
}

function isoDate(iso: string): string {
  // Airtable date columns store YYYY-MM-DD; keep it a plain date like the Make scenario.
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Upsert the booking into the client's Airtable Meetings table and post to their Slack
 * meetings channel, exactly like the Make scenario. No-op (returns false) if the client
 * has no MEETING_CONFIG yet. Never throws — logs and returns on failure.
 */
export async function trackMeeting(input: BookingInput): Promise<boolean> {
  const cfg = MEETING_CONFIG[input.workspaceSlug];
  if (!cfg) {
    console.log(`[meetings-tracker] no config for workspace ${input.workspaceSlug} — skipping Airtable/Slack`);
    return false;
  }
  if (!AIRTABLE_API_KEY || !SLACK_BOT_TOKEN) {
    console.warn("[meetings-tracker] missing AIRTABLE_API_KEY or SLACK_BOT_TOKEN");
    return false;
  }
  const email = (input.leadEmail || "").trim();
  if (!email) return false;

  try {
    // 1. Search by email (case-insensitive), max 1 — mirrors the Make Airtable search.
    const formula = `LOWER({${cfg.fields.email}}) = LOWER("${email.replace(/"/g, '\\"')}")`;
    const found = await airtable(
      "GET",
      `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`,
    );
    const existing = found?.records?.[0];

    const timeLine = input.prettyTime ?? new Date(input.meetingStartISO).toUTCString();
    const evLine = input.eventTypeName ? `Event type: ${input.eventTypeName}\n` : "";

    if (!existing) {
      // 2a. New meeting -> create record + "New meeting booked" Slack post.
      await airtable("POST", `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}`, {
        records: [{
          fields: {
            [cfg.fields.email]: email,
            [cfg.fields.dateOfMeeting]: isoDate(input.meetingStartISO),
            [cfg.fields.meetingBookedDate]: isoDate(input.bookedAtISO),
            ...(cfg.extraCreateFields ?? {}),
          },
        }],
        typecast: true,
      });
      await postSlack(cfg.slackChannel,
        `New meeting booked with ${input.leadName || email}\n\nEmail: ${email}\n${evLine}Time: ${timeLine}`);
      console.log(`[meetings-tracker] created + notified (${input.workspaceSlug}) ${email}`);
    } else {
      // 2b. Reschedule -> update the meeting date + "Meeting rescheduled" Slack post.
      await airtable("PATCH", `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}`, {
        records: [{ id: existing.id, fields: { [cfg.fields.dateOfMeeting]: isoDate(input.meetingStartISO) } }],
        typecast: true,
      });
      await postSlack(cfg.slackChannel,
        `Meeting rescheduled with ${input.leadName || email}\n\nEmail: ${email}\n${evLine}Time: ${timeLine}`);
      console.log(`[meetings-tracker] updated + notified reschedule (${input.workspaceSlug}) ${email}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[meetings-tracker] failed for ${input.workspaceSlug}/${email}:`, err?.message ?? err);
    return false;
  }
}
