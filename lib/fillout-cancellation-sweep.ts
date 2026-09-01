// Fillout has no documented cancellation/reschedule webhook event (confirmed against
// their REST API + webhook docs 2026-09-01) — a lead cancelling via the
// `rescheduleOrCancelUrl` Fillout gives them fires nothing back to us. This is the
// detect-after-the-fact substitute: poll GET /forms/{formId}/submissions for every
// Fillout-sourced workspace in MEETING_CONFIG, and any `calls` row still
// `status='scheduled'` whose eventId (stored in `calendly_event_uri`, same generic
// booking-id column iClosed/Calendly use) no longer appears in that list is treated as
// cancelled — mirrors trackCancellation's Slack message, no Airtable write (same as the
// Calendly cancellation path).
//
// Best-effort throughout: a Fillout API failure aborts that workspace's sweep (never
// treats "empty/failed response" as "everything cancelled") and is logged, not thrown.
import pool from "@/lib/db";
import { MEETING_CONFIG, trackCancellation } from "@/lib/meetings-tracker";

interface FilloutSubmission {
  scheduling?: Array<{ value?: { eventId?: string } }>;
}

async function fetchAllEventIds(formId: string, apiKey: string): Promise<Set<string> | null> {
  const ids = new Set<string>();
  let offset = 0;
  const limit = 150;
  for (;;) {
    const res = await fetch(
      `https://api.fillout.com/v1/api/forms/${formId}/submissions?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      console.error(`[fillout-cancellation-sweep] GET submissions -> ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const responses: FilloutSubmission[] = data.responses ?? [];
    for (const r of responses) {
      const eventId = r.scheduling?.[0]?.value?.eventId;
      if (eventId) ids.add(eventId);
    }
    offset += limit;
    if (responses.length < limit) break;
  }
  return ids;
}

/** Runs the poll for every Fillout-sourced workspace. Never throws. */
export async function sweepFilloutCancellations(): Promise<void> {
  for (const [workspaceSlug, cfg] of Object.entries(MEETING_CONFIG)) {
    if (cfg.source !== "fillout" || !cfg.fillout) continue;
    const apiKey = process.env[cfg.fillout.apiKeyEnvVar];
    if (!apiKey) {
      console.warn(`[fillout-cancellation-sweep] missing ${cfg.fillout.apiKeyEnvVar} for ${workspaceSlug} — skipping`);
      continue;
    }
    try {
      const activeEventIds = await fetchAllEventIds(cfg.fillout.formId, apiKey);
      if (!activeEventIds) continue; // API call failed — already logged, don't act on nothing

      const scheduled = await pool.query(
        `SELECT id, calendly_event_uri, lead_email, lead_name, scheduled_at
           FROM calls
          WHERE workspace_slug = $1 AND source = 'fillout' AND status = 'scheduled'`,
        [workspaceSlug]
      );

      for (const row of scheduled.rows) {
        const eventId: string | null = row.calendly_event_uri;
        if (!eventId || activeEventIds.has(eventId)) continue;

        await pool.query(`UPDATE calls SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [row.id]);
        await trackCancellation({
          workspaceSlug,
          leadEmail: row.lead_email,
          leadName: row.lead_name,
          meetingStartISO: new Date(row.scheduled_at).toISOString(),
        }).catch((err: any) => console.error(`[fillout-cancellation-sweep] trackCancellation failed ${workspaceSlug}/${row.lead_email}:`, err?.message ?? err));

        console.log(`[fillout-cancellation-sweep] detected cancellation (${workspaceSlug}) ${row.lead_email}`);
      }
    } catch (err: any) {
      console.error(`[fillout-cancellation-sweep] failed for ${workspaceSlug}:`, err?.message ?? err);
    }
  }
}
