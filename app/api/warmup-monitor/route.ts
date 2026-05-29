import { NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/warmup-monitor
//
// Flat list of every Google sender across active workspaces, surfaced for
// the Warmup Monitor tab. "Active workspace" = at least one send in the
// last 7 days (matches the same churn rule used by /api/account-monitor).
//
// Each row carries:
//   - warmup_enabled  (boolean from EB sync)
//   - conn_status     ("Connected" / "Not connected")
//   - warming_since   timestamp when remove_and_warmup last fired
//   - attached_campaigns_count  how many active campaigns the sender is in
//
// The UI uses these to highlight:
//   - "Not warming"          warmup_enabled = false
//   - "Disconnected"         conn_status = 'Not connected'
//   - "Ready to rejoin"      warming_since older than ~14 days
//   - "Idle / detached"      attached_campaigns_count = 0
//
// Microsoft mailboxes are excluded at the sender_accounts level (they were
// purged in migration / sync changes), so this endpoint only returns
// Google senders by construction.

export async function GET() {
  try {
    const CHURN_WINDOW_DAYS = 7;
    const READY_DAYS        = 14;

    // Active workspaces (any send in the last 7 days). Anything else is
    // treated as churned and hidden, same rule as /api/account-monitor.
    const activeWss = await pool.query(
      `SELECT DISTINCT workspace_slug
         FROM emails_sent
        WHERE sent_at >= NOW() - ($1 || ' days')::interval`,
      [CHURN_WINDOW_DAYS]
    );
    const activeSlugs = activeWss.rows.map(r => r.workspace_slug);
    if (activeSlugs.length === 0) {
      return NextResponse.json({ senders: [], summary: emptySummary(), workspaces: [] });
    }

    const sendersRes = await pool.query(
      `SELECT
         workspace_slug,
         email                    AS sender_email,
         eb_sender_id,
         status                   AS conn_status,
         warmup_enabled,
         warming_since,
         attached_campaigns_count,
         provider_type
       FROM sender_accounts
      WHERE workspace_slug = ANY($1::text[])
        AND (provider_type IS NULL OR provider_type !~* '(microsoft|office365|outlook)')
      ORDER BY workspace_slug, email`,
      [activeSlugs]
    );

    interface SenderRow {
      workspace_slug:           string;
      sender_email:             string;
      eb_sender_id:             number | null;
      conn_status:              string;
      warmup_enabled:           boolean;
      warming_since:            string | null;
      warming_days:             number | null;
      ready_to_rejoin:          boolean;
      attached_campaigns_count: number | null;
    }

    const senders: SenderRow[] = sendersRes.rows.map(r => {
      const warmingSince = r.warming_since ? new Date(r.warming_since) : null;
      const warmingDays  = warmingSince
        ? Math.floor((Date.now() - warmingSince.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      return {
        workspace_slug:           r.workspace_slug,
        sender_email:             r.sender_email,
        eb_sender_id:             r.eb_sender_id,
        conn_status:              r.conn_status ?? "Connected",
        warmup_enabled:           r.warmup_enabled === true,
        warming_since:            r.warming_since ?? null,
        warming_days:             warmingDays,
        ready_to_rejoin:          warmingDays !== null && warmingDays >= READY_DAYS,
        attached_campaigns_count: r.attached_campaigns_count,
      };
    });

    // Per-spec simplified summary. Warmup health % is intentionally not
    // computed yet — EB exposes only warmup_enabled boolean, no health
    // score. The card and column carry through as null/'—' until a source
    // is wired in. lowWarmupHealth count placeholder = 0 for now.
    const summary = {
      totalSenders:     senders.length,
      notWarming:       senders.filter(s => !s.warmup_enabled).length,
      readyToRejoin:    senders.filter(s => s.ready_to_rejoin).length,
      lowWarmupHealth:  0,            // placeholder until source plumbed
      warmupHealthAvg:  null as number | null, // average % across all senders
    };

    type WsAgg = {
      slug:             string;
      total:            number;
      notWarming:       number;
      readyToRejoin:    number;
      lowWarmupHealth:  number;
      warmupHealthAvg:  number | null;
    };
    const wsMap: Record<string, WsAgg> = {};
    for (const s of senders) {
      const w = wsMap[s.workspace_slug] ?? (wsMap[s.workspace_slug] = {
        slug: s.workspace_slug, total: 0, notWarming: 0, readyToRejoin: 0,
        lowWarmupHealth: 0, warmupHealthAvg: null,
      });
      w.total++;
      if (!s.warmup_enabled)  w.notWarming++;
      if (s.ready_to_rejoin)  w.readyToRejoin++;
    }
    const workspaces = Object.values(wsMap).sort((a, b) =>
      (b.notWarming - a.notWarming) ||
      (b.readyToRejoin - a.readyToRejoin) ||
      (b.total - a.total)
    );

    return NextResponse.json({
      senders,
      summary,
      workspaces,
      thresholds: { readyDays: READY_DAYS, churnWindowDays: CHURN_WINDOW_DAYS },
    });
  } catch (err: any) {
    console.error("[warmup-monitor] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function emptySummary() {
  return { totalSenders: 0, notWarming: 0, readyToRejoin: 0, lowWarmupHealth: 0, warmupHealthAvg: null };
}
