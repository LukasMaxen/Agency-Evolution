import { NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/mailbox-monitor/daily-sends
//
// Per-workspace "scheduled today" count, aggregated by summing the
// emails_being_sent value from EmailBison's campaign sending-schedule
// endpoint across every active outbound campaign in the workspace.
//
//   /api/campaigns/{id}/sending-schedule?day=today
//     -> { data: { emails_being_sent: N, campaign_id, campaign: {...} } }
//
// We surface this on the Account Monitor workspace cards next to
// "Daily capacity" so the operator can see today's actual scheduled
// volume vs the theoretical ceiling (active senders * 20). When the
// scheduled number is well under capacity the operator knows there's
// room to launch another campaign; when it's at-or-over the cap the
// senders will start carrying more than 20/day and warmup health is
// at risk.
//
// Only campaigns in active sending states count. Completed/archived
// have schedule rows but no future sends.

const SENDING_STATES = new Set(["active", "running", "live", "launching"]);

export async function GET() {
  try {
    const wsRes = await pool.query(
      `SELECT slug, email_bison_api_key, email_bison_instance_url
         FROM workspaces
        WHERE email_bison_api_key IS NOT NULL
          AND email_bison_instance_url IS NOT NULL`
    );

    type Row = { slug: string; scheduled_today: number; campaigns: number; error?: string };
    const results: Row[] = await Promise.all(wsRes.rows.map(async (ws): Promise<Row> => {
      const { slug, email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = ws;
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      try {
        const campsRes = await fetch(`${instanceUrl}/api/campaigns?per_page=250`, { headers });
        if (!campsRes.ok) return { slug, scheduled_today: 0, campaigns: 0, error: `list ${campsRes.status}` };
        const campsJson = await campsRes.json();
        const active = (campsJson.data ?? []).filter((c: any) =>
          SENDING_STATES.has(String(c.status ?? "").toLowerCase())
        );
        if (active.length === 0) return { slug, scheduled_today: 0, campaigns: 0 };

        // Walk every active campaign in parallel. EB returns
        // emails_being_sent inside data.emails_being_sent.
        const perCamp = await Promise.all(active.map(async (c: any) => {
          try {
            const r = await fetch(`${instanceUrl}/api/campaigns/${c.id}/sending-schedule?day=today`, { headers });
            if (!r.ok) return 0;
            const j = await r.json();
            const n = Number(j?.data?.emails_being_sent ?? 0);
            return Number.isFinite(n) ? n : 0;
          } catch { return 0; }
        }));
        const scheduled_today = perCamp.reduce((a, b) => a + b, 0);
        return { slug, scheduled_today, campaigns: active.length };
      } catch (err: any) {
        return { slug, scheduled_today: 0, campaigns: 0, error: err?.message ?? "unknown" };
      }
    }));

    return NextResponse.json({
      ok: true,
      day: new Date().toISOString().slice(0, 10),
      workspaces: results,
      total_scheduled: results.reduce((a, r) => a + r.scheduled_today, 0),
    });
  } catch (err: any) {
    console.error("[mailbox-monitor/daily-sends] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
