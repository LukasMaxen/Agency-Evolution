// One-off backfill: Lara Morgan's Larsen operating-partner booking was mis-attributed to
// workspace_slug='hahnbeck' by the cross-client email-match bug (see
// project_meeting_tracker_inapp.md memory, fixed in app/api/webhook/calendly/route.ts
// 2026-09-06). This repoints the DB rows to larsen-digital, then replays the same
// trackMeeting() call the webhook would have made, so it lands in Larsen's Airtable +
// #larsen-digital-meetings exactly like a normal booking.
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const CALL_ID = "call-cal-5ce04e14-d4aa-450f-b539-6308ec15ee81";
const LARSEN_REPLY_ID = "a2a73cd1-f291-4b21-9d4a-4b761ecb8ef2"; // the interested "Re: Relevant?" thread
const LEAD_EMAIL = "lara@kitbrix.com";
const LEAD_NAME = "Lara Morgan";
const PHONE = "+44 7710 422469";
const EVENT_NAME = "Intro Call | Operating Partner";
const MEETING_START_ISO = "2026-09-10T12:30:00.000Z";
const BOOKED_AT_ISO = "2026-09-06T16:37:26.497Z";

async function main() {
  const upd = await pool.query(
    `UPDATE calls SET workspace_slug = 'larsen-digital', reply_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, workspace_slug, reply_id`,
    [LARSEN_REPLY_ID, CALL_ID]
  );
  console.log("calls updated:", JSON.stringify(upd.rows));

  const updReply = await pool.query(
    `UPDATE replies SET meeting_booked = TRUE WHERE id = $1 RETURNING id, workspace_slug, meeting_booked`,
    [LARSEN_REPLY_ID]
  );
  console.log("reply updated:", JSON.stringify(updReply.rows));

  const { trackMeeting } = await import("../lib/meetings-tracker");
  const ok = await trackMeeting({
    workspaceSlug: "larsen-digital",
    leadEmail: LEAD_EMAIL,
    leadName: LEAD_NAME,
    meetingStartISO: MEETING_START_ISO,
    bookedAtISO: BOOKED_AT_ISO,
    prettyTime: new Date(MEETING_START_ISO).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }) + " CET",
    eventTypeName: EVENT_NAME,
    phone: PHONE,
  });
  console.log("trackMeeting result:", ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
