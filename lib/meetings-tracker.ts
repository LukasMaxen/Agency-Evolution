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

import pool from "@/lib/db";
import { buildEmailBisonUrl } from "@/lib/utils";
import { buildMeetingContext } from "@/lib/meeting-context";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
// Where a booking goes when we cannot attribute it to a configured workspace, so nothing is
// ever silently dropped. Defaults to #internal-meetings.
const FALLBACK_SLACK_CHANNEL = process.env.MEETINGS_FALLBACK_CHANNEL ?? "C05SEP3D57T";

export interface MeetingConfig {
  /** Booking tool whose webhook fires for this client. */
  source: "calendly" | "iclosed" | "fillout";
  airtableBaseId: string;
  airtableTableId: string;
  /** Slack channel id for this client's "-meetings" channel. */
  slackChannel: string;
  /**
   * Human label for the "Workspace:" line in the Slack message — the owner who takes the
   * call (e.g. "Nicklas Larsen" for Larsen, "Lukas Maxen" for Acceler8rs). Lets both workspaces share
   * one Slack channel while staying distinguishable. Omit to drop the line.
   */
  workspaceLabel?: string;
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
  /**
   * iClosed only. iClosed webhooks fire account-wide (no per-event scoping at
   * registration), so when set, only bookings whose event_type.uuid is in this list are
   * tracked — everything else is skipped. iClosed event names are inconsistent/duplicated
   * (e.g. "Creative Campaign Strategy Call" vs "Creative campaign strategy call" vs
   * "Creative campaign"), so filtering by numeric id is the only reliable match.
   */
  iclosedEventIds?: number[];
  /** Concise ICP definition — drives the one-line ICP-fit judgment in the Slack message. */
  icpDescription?: string;
}

// Keyed by our workspace slug (replies.workspace_slug). Channel ids verified live via
// Slack; base/table/fields/dealSource verified from the Make scenarios.
export const MEETING_CONFIG: Record<string, MeetingConfig> = {
  "larsen-digital": {
    source: "calendly",
    // Larsen (Nicklas) and Acceler8rs (Lukas, retired brand, same "Larsen Digital" offer)
    // SHARE this Airtable base on purpose — the "Deal Source" field ("Nicklas" vs
    // "Lukas") is what marks which sender each meeting belongs to.
    // Slack posts, however, go to SEPARATE channels per sender (split 2026-08-05, see the
    // acceler8rs entry below) — each workspace tracked individually per Kasper.
    // 2026-08-31: moved to base appp8h0kv9DEHYpXR in the "Larsen Digital 2" workspace —
    // the old base (appV8wpBdqTgCi4Ws, "Larsen Nicklas/Lukas") lived in a workspace whose
    // Airtable plan hit its monthly API + records cap. See project_airtable_billing_limit_2026_08_31.
    airtableBaseId: "appp8h0kv9DEHYpXR",        // "Larsen Nicklas/Lukas" in "Larsen Digital 2" workspace
    airtableTableId: "tblkoizZek5r5wi45",       // Deals / Meetings
    slackChannel: "C03LPQ4G3HR",                // "Larsen - Nicklas" meetings channel
    workspaceLabel: "Nicklas Larsen",
    fields: { email: "Email", meetingDate: "Date Of Exploratory Call", bookedDate: "Meeting booked date" },
    crm: {
      dealSourceField: "Deal Source", dealSource: "Nicklas",
      statusField: "Status", statusValue: "Intro Call Booked",
      nextStepField: "Next Step", nextStepValue: "Update Lead Info",
      nextStepDateField: "Next Step Date",
    },
    slackExtra: { revenue: "DTC Revenue" },
    icpDescription: "Established consumer / CPG brands (beauty, personal care, food, supplements, household) doing roughly $5M+ in revenue with repeat-purchase products — the buyer's acquisition target. Also relevant: 7-figure+ DTC brands open to growth and a future exit. NOT a fit: pure services/agencies, B2B SaaS, pre-revenue, or clearly under $5M with no path.",
  },
  "acceler8rs": {
    source: "calendly",
    airtableBaseId: "appp8h0kv9DEHYpXR",        // "Larsen Nicklas/Lukas" in "Larsen Digital 2" workspace
    airtableTableId: "tblkoizZek5r5wi45",       // Deals / Meetings
    // 2026-08-10: the "Larsen - Lukas" channel (was C07CNPN71PS) went dead — the bot
    // could not reach it (channel_not_found), so every acceler8rs/Lukas meeting was
    // silently black-holed (fire-and-forget Slack post). Per Kasper, both Larsen sides
    // now post to the one live #larsen-digital-meetings (C03LPQ4G3HR). They stay
    // distinguishable via the "Sender:" line (workspaceLabel below vs "Nicklas Larsen").
    slackChannel: "C03LPQ4G3HR",               // #larsen-digital-meetings (shared with Nicklas)
    workspaceLabel: "Lukas Maxen",
    fields: { email: "Email", meetingDate: "Date Of Exploratory Call", bookedDate: "Meeting booked date" },
    crm: {
      dealSourceField: "Deal Source", dealSource: "Lukas",
      statusField: "Status", statusValue: "Intro Call Booked",
      nextStepField: "Next Step", nextStepValue: "Update Lead Info",
      nextStepDateField: "Next Step Date",
    },
    slackExtra: { revenue: "DTC Revenue" },
    icpDescription: "Established consumer / CPG brands (beauty, personal care, food, supplements, household) doing roughly $5M+ in revenue with repeat-purchase products — the buyer's acquisition target. Also relevant: 7-figure+ DTC brands open to growth and a future exit. NOT a fit: pure services/agencies, B2B SaaS, pre-revenue, or clearly under $5M with no path.",
  },
  "internal-campaigns": {
    source: "calendly",
    // Maxen Group's own buy-side + sell-side outbound (EmailBison workspace "Internal
    // Campaigns"). Separate Airtable base from client workspaces, but the same
    // "Meetings / Deals" schema as Larsen/Acceler8rs. Was missing here entirely until
    // 2026-08-06, so bookings fell through to the fallback alert instead of Airtable.
    airtableBaseId: "app9rWZ2iE4eWECEN",         // Agency Evolution CRM
    airtableTableId: "tblCATnaPTV9fb2Ab",        // Meetings / Deals
    slackChannel: FALLBACK_SLACK_CHANNEL,        // #internal-meetings — Maxen's own deals stay internal
    fields: { email: "Email", meetingDate: "Date Of Exploratory Call", bookedDate: "Meeting booked date" },
    crm: {
      dealSourceField: "Deal Source", dealSource: "Cold email",
      statusField: "Status", statusValue: "Intro Call Booked",
      nextStepField: "Next Step", nextStepValue: "Update Lead Info",
      nextStepDateField: "Next Step Date",
    },
    slackExtra: { website: "Website" },
    icpDescription: "Buy-side: PE firms, family offices, and strategic acquirers active in consumer/ecom or generalist lower-middle-market, sourcing $1M-$10M EBITDA targets. Sell-side: founders/owners of e-commerce and consumer brands, $1M+ EBITDA, exit-curious. NOT a fit: pre-revenue businesses, non-decision-makers, or industries with no plausible M&A angle.",
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
    // Only these two events, confirmed live via GET /v1/events on 2026-08-27 (Kasper):
    // 43175 "Creative campaign" (GNMOTION/creative-campaign) and 21997 "Creative Campaign
    // Discovery call" (GNMOTION/creative-campaign-discovery-call). GN Motion has 9 iClosed
    // events total (incl. the id-20262 "Creative Campaign Strategy Call" that's actually
    // advertised in clients/gn-motion.md) — everything else is intentionally excluded.
    iclosedEventIds: [43175, 21997],
  },
  // Simple template. Onboarded 2026-08-27, still pre-kickoff (client file is a skeleton
  // beyond ICP, no campaign/reply content filled in yet). Airtable base/table confirmed
  // live via API. WithPebble books via a native FILLOUT scheduling block (form
  // pvazF8omZwus, "Strategy Call"), not Calendly — the booking_link in clients/with-pebble.md
  // is a Fillout form, and its Calendly link is "TBD"/unused. See app/api/webhook/fillout/route.ts.
  "with-pebble": {
    source: "fillout",
    airtableBaseId: "appjEe12UdVsRX10y",         // "WithPebble"
    airtableTableId: "tblTnxArHDVMNOxSI",        // "Meetings"
    slackChannel: "C0BT77Z29BN",                 // withpebble meetings channel (private)
    fields: { email: "Email", meetingDate: "Date Of Meeting", bookedDate: "Meeting booked date" },
    icpDescription: "Beauty/health/wellness brands selling physical goods (not medspas or services) doing $1M+ annual revenue, 5-100 employees, selling to US customers. Retail presence is fine. TikTok Shop presence is a plus but not required. Also relevant: consumer apps with $50K+ MRR. NOT a fit: services/medspas, non-physical-goods brands outside consumer apps, sub-$1M revenue, or not selling to the US.",
  },
  // Simple template. Onboarded 2026-08-27, still pre-kickoff (client file is a skeleton,
  // no ICP filled in yet). Airtable base/table confirmed live via API. Calendly org
  // webhook registered 2026-08-28 (org 931cbd2e-9542-4a05-8adb-cf92a1fb7822, scope
  // organization, sub uri 4fb5c77d-2472-49ea-a006-dbe871acc3a2), callback
  // .../api/webhook/calendly?wsDefault=ah-consulting.
  "ah-consulting": {
    source: "calendly",
    airtableBaseId: "appZhEsVN52VXPZ66",         // "Austin Heaton"
    airtableTableId: "tblTnxArHDVMNOxSI",        // "Meetings"
    slackChannel: "C0BSZGJPFTP",                 // austin heaton / AEO Consulting meetings channel (private)
    fields: { email: "Email", meetingDate: "Date Of Meeting", bookedDate: "Meeting booked date" },
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
  /** Every other Calendly questionnaire answer (revenue, sales channel, timeline to exit,
   *  phone, etc.), in the order Calendly asked them. Shown verbatim, never summarized. */
  qa?: Array<{ question: string; answer: string }>;
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
// Meeting times are always shown in CET (Europe/Copenhagen), never UTC.
const cet = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }) + " CET";

// Freemail domains never identify a company, so they never make a usable "Website:" fallback.
const FREEMAIL = new Set(["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "live.com", "msn.com", "me.com", "mail.com"]);
function emailDomain(email: string): string | undefined {
  const d = (email.split("@")[1] || "").toLowerCase().trim();
  return d && !FREEMAIL.has(d) ? d : undefined;
}

// The EmailBison "View in inbox" link for this lead's thread in this workspace, so the
// reader can jump straight to the conversation instead of searching for it. Best-effort:
// requires both the workspace's instance URL (workspaces table) and a matched reply row
// (email_bison_reply_id) — returns null (line omitted) if either is missing.
async function getThreadUrl(workspaceSlug: string, leadEmail: string): Promise<string | null> {
  try {
    const email = leadEmail.toLowerCase();
    const [ws, rep] = await Promise.all([
      pool.query(`SELECT email_bison_instance_url FROM workspaces WHERE slug = $1 LIMIT 1`, [workspaceSlug]),
      pool.query(
        `SELECT email_bison_reply_id FROM replies
          WHERE workspace_slug = $1 AND (LOWER(lead_email) = $2 OR LOWER(preferred_recipient_email) = $2)
          ORDER BY received_at DESC LIMIT 1`,
        [workspaceSlug, email],
      ),
    ]);
    const instanceUrl = ws.rows[0]?.email_bison_instance_url;
    const replyId = rep.rows[0]?.email_bison_reply_id;
    return instanceUrl && replyId ? buildEmailBisonUrl(instanceUrl, replyId) : null;
  } catch {
    return null;
  }
}

function slackMessage(verb: "New meeting booked" | "Meeting rescheduled", i: BookingInput, rec: Record<string, any> | undefined, cfg: MeetingConfig, extra: string[] = [], threadUrl?: string | null): string {
  const firstName = cfg.workspaceLabel?.split(" ")[0];
  const title = firstName ? `${firstName} - ${verb} with ${i.leadName || i.leadEmail}` : `${verb} with ${i.leadName || i.leadEmail}`;
  const lines = [title, ""];
  lines.push(`Email: ${i.leadEmail}`);
  if (threadUrl) lines.push(`Thread: ${threadUrl}`);
  // Phone gets its own line only when it did NOT come from a Q&A answer already shown below
  // (e.g. an SMS reminder number with no matching custom question), otherwise it would
  // print twice, once here and once as a numbered item.
  if (i.phone && !(i.qa ?? []).some(q => q.answer === i.phone)) lines.push(`Phone: ${i.phone}`);
  // Website: prefer what the lead actually typed (Calendly Q&A), then the Airtable record,
  // then fall back to their email domain so this line is almost always there to self-assess
  // the company from, without us editorializing on fit.
  const website = i.website || (cfg.slackExtra?.website ? rec?.[cfg.slackExtra.website] : undefined) || emailDomain(i.leadEmail);
  if (website) lines.push(`Website: ${website}`);
  if (i.eventTypeName) lines.push(`Event type: ${i.eventTypeName}`);
  lines.push(`Time: ${i.prettyTime ?? cet(i.meetingStartISO)}`);
  // Raw Calendly questionnaire answers (revenue, sales channel, timeline to exit, phone,
  // etc.), in the order Calendly asked them.
  if (i.qa && i.qa.length) {
    lines.push("");
    i.qa.forEach((q, idx) => lines.push(`${idx + 1}. ${q.question}: ${q.answer}`));
  }
  // Context block (Company / EBITDA / Context / ICP fit) comes from buildMeetingContext.
  if (extra.length) { lines.push(""); lines.push(...extra); }
  return lines.join("\n");
}

export interface CancellationInput {
  workspaceSlug: string;
  leadEmail: string;
  leadName: string;
  meetingStartISO: string;
  prettyTime?: string;
  eventTypeName?: string;
  website?: string;
}

function cancellationMessage(i: CancellationInput, threadUrl?: string | null): string {
  const lines = [`Cancelled meeting: ${i.leadName || i.leadEmail}`, ""];
  lines.push(`Email: ${i.leadEmail}`);
  if (threadUrl) lines.push(`Thread: ${threadUrl}`);
  const website = i.website || emailDomain(i.leadEmail);
  if (website) lines.push(`Website: ${website}`);
  if (i.eventTypeName) lines.push(`Event type: ${i.eventTypeName}`);
  lines.push(`Time: ${i.prettyTime ?? cet(i.meetingStartISO)}`);
  return lines.join("\n");
}

/**
 * Post a "Cancelled meeting" notice to the client's Slack meetings channel — same channel
 * `trackMeeting` posts bookings to, so cancellations show up alongside them. No Airtable
 * write (Airtable status is left to whatever the client already does with it). Falls back
 * to the internal channel when the workspace has no meetings config, same as trackMeeting.
 * Never throws.
 */
export async function trackCancellation(input: CancellationInput): Promise<boolean> {
  if (!SLACK_BOT_TOKEN || !input.leadEmail) return false;
  const cfg = MEETING_CONFIG[input.workspaceSlug];
  const channel = cfg?.slackChannel ?? FALLBACK_SLACK_CHANNEL;
  try {
    const threadUrl = await getThreadUrl(input.workspaceSlug, input.leadEmail);
    await postSlack(channel, cancellationMessage(input, threadUrl));
    console.log(`[meetings-tracker] posted cancellation (${input.workspaceSlug}) ${input.leadEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[meetings-tracker] trackCancellation failed ${input.workspaceSlug}/${input.leadEmail}:`, err?.message ?? err);
    return false;
  }
}

/**
 * Upsert the booking into the client's Airtable table and post to their Slack meetings
 * channel — the in-app version of the Make scenario. Returns false (no-op) if the client
 * has no config yet. Never throws.
 */
export async function trackMeeting(input: BookingInput): Promise<boolean> {
  const cfg = MEETING_CONFIG[input.workspaceSlug];
  if (!cfg) {
    // Never silently drop a booking — surface it so a human can attribute it manually.
    console.log(`[meetings-tracker] no config for ${input.workspaceSlug} — posting fallback alert`);
    if (SLACK_BOT_TOKEN && input.leadEmail) {
      try {
        await postSlack(FALLBACK_SLACK_CHANNEL, [
          `:warning: Meeting booked with no workspace match (resolved: ${input.workspaceSlug})`,
          "",
          `Name: ${input.leadName || "-"}`,
          `Email: ${input.leadEmail}`,
          input.phone ? `Phone: ${input.phone}` : "",
          input.eventTypeName ? `Event type: ${input.eventTypeName}` : "",
          `Time: ${input.prettyTime ?? cet(input.meetingStartISO)}`,
          "",
          "Not written to any Airtable — please attribute this booking manually.",
        ].filter(Boolean).join("\n"));
      } catch (e: any) {
        console.error("[meetings-tracker] fallback alert failed:", e?.message ?? e);
      }
    }
    return false;
  }
  if (!AIRTABLE_API_KEY || !SLACK_BOT_TOKEN) { console.warn("[meetings-tracker] missing AIRTABLE_API_KEY / SLACK_BOT_TOKEN"); return false; }
  const email = (input.leadEmail || "").trim();
  if (!email) return false;
  if (cfg.eventNameContains && !(input.eventTypeName ?? "").toLowerCase().includes(cfg.eventNameContains.toLowerCase())) {
    console.log(`[meetings-tracker] event "${input.eventTypeName}" not "${cfg.eventNameContains}" for ${input.workspaceSlug} — skipping`);
    return false;
  }

  const i = input;

  const tbl = `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}`;
  try {
    // 1. Search by email (case-insensitive), pulling the fields we surface in Slack.
    const surfaced = [cfg.fields.email, cfg.slackExtra?.website, cfg.slackExtra?.revenue].filter(Boolean) as string[];
    const fieldsQ = surfaced.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
    const formula = `LOWER({${cfg.fields.email}}) = LOWER("${email.replace(/"/g, '\\"')}")`;
    const found = await airtable("GET", `${tbl}?maxRecords=1&${fieldsQ}&filterByFormula=${encodeURIComponent(formula)}`);
    const existing = found?.records?.[0];
    const threadUrl = await getThreadUrl(input.workspaceSlug, email);

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
      const cf = created?.records?.[0]?.fields;
      const extra = await buildMeetingContext({ workspaceSlug: input.workspaceSlug, leadEmail: email, icpDescription: cfg.icpDescription, revenue: cfg.slackExtra?.revenue ? cf?.[cfg.slackExtra.revenue] : undefined, phone: i.phone });
      await postSlack(cfg.slackChannel, slackMessage("New meeting booked", i, cf, cfg, extra, threadUrl));
      console.log(`[meetings-tracker] created + notified (${input.workspaceSlug}) ${email}`);
    } else {
      // 2b. Reschedule -> update meeting date only + "Meeting rescheduled".
      await airtable("PATCH", tbl, { records: [{ id: existing.id, fields: { [cfg.fields.meetingDate]: isoDate(input.meetingStartISO) } }], typecast: true });
      const extra = await buildMeetingContext({ workspaceSlug: input.workspaceSlug, leadEmail: email, icpDescription: cfg.icpDescription, revenue: cfg.slackExtra?.revenue ? existing.fields?.[cfg.slackExtra.revenue] : undefined, phone: i.phone });
      await postSlack(cfg.slackChannel, slackMessage("Meeting rescheduled", i, existing.fields, cfg, extra, threadUrl));
      console.log(`[meetings-tracker] updated + notified reschedule (${input.workspaceSlug}) ${email}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[meetings-tracker] failed ${input.workspaceSlug}/${email}:`, err?.message ?? err);
    // Never let an Airtable/enrichment/Slack hiccup silently drop the notification — the
    // Postgres `calls` row is already committed regardless, but the team still needs to see
    // this in Slack. Post a plain fallback (no enrichment) to the client channel; if even
    // that fails, escalate to the internal fallback channel so it's never just gone.
    try {
      const firstName = cfg.workspaceLabel?.split(" ")[0];
      const title = firstName ? `${firstName} - ` : "";
      await postSlack(cfg.slackChannel, [
        `:warning: ${title}New meeting booked with ${i.leadName || email} (notification pipeline failed, this is a plain backfill)`,
        "",
        `Email: ${email}`,
        i.eventTypeName ? `Event type: ${i.eventTypeName}` : "",
        `Time: ${i.prettyTime ?? cet(i.meetingStartISO)}`,
      ].filter(Boolean).join("\n"));
    } catch (fallbackErr: any) {
      console.error(`[meetings-tracker] fallback notify also failed ${input.workspaceSlug}/${email}:`, fallbackErr?.message ?? fallbackErr);
      try {
        await postSlack(FALLBACK_SLACK_CHANNEL,
          `:warning: Meeting booked with ${i.leadName || email} (${email}) in ${input.workspaceSlug} — notification pipeline failed twice, check Airtable/Slack manually.`);
      } catch { /* both channels failed — already logged above, nothing more we can do */ }
    }
    return false;
  }
}
