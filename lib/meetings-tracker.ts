// Meeting tracker — in-app replacement for the Make "Calendly/iClosed -> Slack -> AirTable"
// scenarios. On every booking it mirrors the Make logic exactly:
//   1. Search the client's Airtable table for a record with the lead's email.
//   2. No match  -> create a record + post "New meeting booked ..." to the client's
//      Slack -meetings channel.
//   3. Match     -> update the meeting date (a reschedule) + post "Meeting rescheduled ...".
//
// Two Airtable schemas exist across clients:
//   - "simple"  Meetings table:  Email, Date Of Meeting, Meeting Booked Date  (GN Motion).
//   - "crm"     Deals/Meetings table (XL8 / Agency Evolution CRM): also stamps
//               Deal Source, Status = "Intro Call Booked", Next Step = "Update Lead Info",
//               Next Step Date, and reads DTC Revenue / Website for the Slack message.
//
// Best-effort: never throws — logs and returns false on failure so the booking flow and
// the Postgres `calls` record (written by the webhooks) are unaffected.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";

export interface MeetingConfig {
  /** Booking tool whose webhook fires for this client. */
  source: "calendly" | "iclosed";
  airtableBaseId: string;
  airtableTableId: string;
  /** Slack channel id for this client's "-meetings" channel. */
  slackChannel: string;
  /** Field NAMES on the meetings table. */
  fields: {
    email: string;
    /** The meeting date column (e.g. "Date Of Meeting" or "Date Of Exploratory Call"). */
    meetingDate: string;
    /** The booked-at date column (e.g. "Meeting Booked Date" / "Meeting booked date"). */
    bookedDate: string;
  };
  /**
   * CRM template only. When set, a NEW record is also stamped with these. Reschedules
   * only touch meetingDate (matching Make), never these.
   */
  crm?: {
    dealSourceField: string;
    dealSource: string;
    statusField: string;
    statusValue: string;      // "Intro Call Booked"
    nextStepField: string;
    nextStepValue: string;    // "Update Lead Info"
    nextStepDateField: string;
  };
  /** Optional record field names to surface in the Slack message (from the found record). */
  slackExtra?: { website?: string; revenue?: string };
  /**
   * Optional. Only track bookings whose event-type name contains this (case-insensitive).
   * Used when the client's Calendly org hosts other event types we should ignore.
   */
  eventNameContains?: string;
}

// Keyed by our workspace slug (replies.workspace_slug). Channel ids verified live via
// Slack; base/table/fields/dealSource verified from the Make scenarios.
export const MEETING_CONFIG: Record<string, MeetingConfig> = {
  "larsen-digital": {
    source: "calendly",
    airtableBaseId: "appV8wpBdqTgCi4Ws",       // XL8 CRM (shared with Acceler8rs)
    airtableTableId: "tblCATnaPTV9fb2Ab",       // Deals / Meetings
    slackChannel: "C03LPQ4G3HR",                // larsen-digital-meetings
    fields: { email: "Email", meetingDate: "Date Of Exploratory Call", bookedDate: "Meeting booked date" },
    crm: {
      dealSourceField: "Deal Source", dealSource: "Cold email (LD)",
      statusField: "Status", statusValue: "Intro Call Booked",
      nextStepField: "Next Step", nextStepValue: "Update Lead Info",
      nextStepDateField: "Next Step Date",
    },
    slackExtra: { revenue: "DTC Revenue (Monthly)" },
  },
  "acceler8rs": {
    source: "calendly",
    airtableBaseId: "appV8wpBdqTgCi4Ws",
    airtableTableId: "tblCATnaPTV9fb2Ab",
    slackChannel: "C07CNPN71PS",                // acceler8rs-meetings
    fields: { email: "Email", meetingDate: "Date Of Exploratory Call", bookedDate: "Meeting booked date" },
    crm: {
      dealSourceField: "Deal Source", dealSource: "Cold email (Acceler8rs)",
      statusField: "Status", statusValue: "Intro Call Booked",
      nextStepField: "Next Step", nextStepValue: "Update Lead Info",
      nextStepDateField: "Next Step Date",
    },
    slackExtra: { revenue: "DTC Revenue (Monthly)" },
  },
  // Simple template. Own Calendly org (dominik@sonaro.ai); leads not in the reply desk,
  // so its webhook is registered with ?ws=sonaro-ai. Only the engagement call is tracked.
  "sonaro-ai": {
    source: "calendly",
    airtableBaseId: "appNMGCTwXVOLLzmA",
    airtableTableId: "tblTnxArHDVMNOxSI",
    slackChannel: "C0A2W868NE5",                // sonaro-ai-meetings
    fields: { email: "Email", meetingDate: "Date Of Meeting", bookedDate: "Meeting Booked Date" },
    eventNameContains: "Smart Engagement",
  },
  // Simple template (verified from Make scenario 3802053). iClosed trigger.
  "gn-motion": {
    source: "iclosed",
    airtableBaseId: "appL5fZEyULdqpyx5",
    airtableTableId: "tblTnxArHDVMNOxSI",
    slackChannel: "C09JHNBTTQD",                // gn-motion-meetings
    fields: { email: "Email", meetingDate: "Date Of Meeting", bookedDate: "Meeting Booked Date" },
    slackExtra: { website: "Website" },
  },
};

export interface BookingInput {
  workspaceSlug: string;
  leadEmail: string;
  leadName: string;
  meetingStartISO: string;   // event start
  bookedAtISO: string;       // when booked (created_at)
  prettyTime?: string;       // formatted time for the Slack message
  eventTypeName?: string;    // Calendly/iClosed event type label
  phone?: string;            // from the booking, if present
  website?: string;          // from the booking, if present (falls back to the record)
}

async function airtable(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`airtable ${method} ${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
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

const isoDate = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

function slackMessage(verb: "New meeting booked" | "Meeting rescheduled", i: BookingInput, rec: Record<string, any> | undefined, cfg: MeetingConfig): string {
  const lines = [`${verb} with ${i.leadName || i.leadEmail}`, "", `Email: ${i.leadEmail}`];
  if (i.phone) lines.push(`Phone: ${i.phone}`);
  const website = i.website || (cfg.slackExtra?.website ? rec?.[cfg.slackExtra.website] : undefined);
  if (website) lines.push(`Website: ${website}`);
  const revenue = cfg.slackExtra?.revenue ? rec?.[cfg.slackExtra.revenue] : undefined;
  if (revenue !== undefined && revenue !== null && revenue !== "") lines.push(`Revenue: ${revenue}`);
  if (i.eventTypeName) lines.push(`Event type: ${i.eventTypeName}`);
  lines.push(`Time: ${i.prettyTime ?? new Date(i.meetingStartISO).toUTCString()}`);
  return lines.join("\n");
}

/**
 * Upsert the booking into the client's Airtable table and post to their Slack meetings
 * channel — the in-app version of the Make scenario. Returns false (no-op) if the client
 * has no config yet. Never throws.
 */
export async function trackMeeting(input: BookingInput): Promise<boolean> {
  const cfg = MEETING_CONFIG[input.workspaceSlug];
  if (!cfg) { console.log(`[meetings-tracker] no config for ${input.workspaceSlug} — skipping`); return false; }
  if (!AIRTABLE_API_KEY || !SLACK_BOT_TOKEN) { console.warn("[meetings-tracker] missing AIRTABLE_API_KEY / SLACK_BOT_TOKEN"); return false; }
  const email = (input.leadEmail || "").trim();
  if (!email) return false;
  if (cfg.eventNameContains && !(input.eventTypeName ?? "").toLowerCase().includes(cfg.eventNameContains.toLowerCase())) {
    console.log(`[meetings-tracker] event "${input.eventTypeName}" not "${cfg.eventNameContains}" for ${input.workspaceSlug} — skipping`);
    return false;
  }

  const tbl = `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}`;
  try {
    // 1. Search by email (case-insensitive), pulling the fields we surface in Slack.
    const surfaced = [cfg.fields.email, cfg.slackExtra?.website, cfg.slackExtra?.revenue].filter(Boolean) as string[];
    const fieldsQ = surfaced.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
    const formula = `LOWER({${cfg.fields.email}}) = LOWER("${email.replace(/"/g, '\\"')}")`;
    const found = await airtable("GET", `${tbl}?maxRecords=1&${fieldsQ}&filterByFormula=${encodeURIComponent(formula)}`);
    const existing = found?.records?.[0];

    if (!existing) {
      // 2a. New meeting -> create + "New meeting booked".
      const rec: Record<string, unknown> = {
        [cfg.fields.email]: email,
        [cfg.fields.meetingDate]: isoDate(input.meetingStartISO),
        [cfg.fields.bookedDate]: isoDate(input.bookedAtISO),
      };
      if (cfg.crm) {
        rec[cfg.crm.dealSourceField] = cfg.crm.dealSource;
        rec[cfg.crm.statusField] = cfg.crm.statusValue;
        rec[cfg.crm.nextStepField] = cfg.crm.nextStepValue;
        rec[cfg.crm.nextStepDateField] = isoDate(input.bookedAtISO);
      }
      const created = await airtable("POST", tbl, { records: [{ fields: rec }], typecast: true });
      await postSlack(cfg.slackChannel, slackMessage("New meeting booked", input, created?.records?.[0]?.fields, cfg));
      console.log(`[meetings-tracker] created + notified (${input.workspaceSlug}) ${email}`);
    } else {
      // 2b. Reschedule -> update meeting date only + "Meeting rescheduled".
      await airtable("PATCH", tbl, { records: [{ id: existing.id, fields: { [cfg.fields.meetingDate]: isoDate(input.meetingStartISO) } }], typecast: true });
      await postSlack(cfg.slackChannel, slackMessage("Meeting rescheduled", input, existing.fields, cfg));
      console.log(`[meetings-tracker] updated + notified reschedule (${input.workspaceSlug}) ${email}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[meetings-tracker] failed ${input.workspaceSlug}/${email}:`, err?.message ?? err);
    return false;
  }
}
