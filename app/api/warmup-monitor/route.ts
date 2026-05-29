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
         warmup_score,
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
      warmup_score:             number | null;
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
      // EB returns warmup_score as a numeric string sometimes; coerce.
      const scoreNum = r.warmup_score === null || r.warmup_score === undefined
        ? null
        : Number(r.warmup_score);
      return {
        workspace_slug:           r.workspace_slug,
        sender_email:             r.sender_email,
        eb_sender_id:             r.eb_sender_id,
        conn_status:              r.conn_status ?? "Connected",
        warmup_enabled:           r.warmup_enabled === true,
        warmup_score:             scoreNum,
        warming_since:            r.warming_since ?? null,
        warming_days:             warmingDays,
        ready_to_rejoin:          warmingDays !== null && warmingDays >= READY_DAYS,
        attached_campaigns_count: r.attached_campaigns_count,
      };
    });

    // Warmup health threshold. Health is judged at the DOMAIN level, not the
    // individual mailbox level: if the domain average drops below 98% we
    // treat the whole domain as unhealthy and push every reachable sender
    // on it back to warmup. Individual outliers inside a healthy domain are
    // left alone — they recover passively while peers carry the volume.
    // 98 is intentional: EB scores are tightly distributed in the high 90s
    // for healthy mailboxes, so anything below 98 stands out.
    const LOW_HEALTH_THRESHOLD = 98;

    // warmup_score = 0 means "no warmup activity yet" in EB — the sender
    // was added but no warmup emails have been sent to or from it. Treat
    // that as no-data so it does not drag down domain or workspace
    // averages and falsely flag a healthy domain as low-health.
    const hasScore = (s: SenderRow) => typeof s.warmup_score === "number" && (s.warmup_score as number) > 0;
    const sendersWithScore = senders.filter(hasScore);
    const avgScore = sendersWithScore.length > 0
      ? Math.round(sendersWithScore.reduce((sum, s) => sum + (s.warmup_score as number), 0) / sendersWithScore.length * 10) / 10
      : null;

    // Domain-level aggregation. A domain is "low-health" only when:
    //   1) at least one sender on the domain is currently active (in an
    //      outbound campaign — attached_campaigns_count > 0), AND
    //   2) the avg of its connected, scored senders is below threshold.
    // A domain that has been fully moved to warming-only is being
    // remediated already, so we do not double-flag it.
    const sendersByDomain: Record<string, SenderRow[]> = {};
    for (const s of senders) {
      const dom = s.sender_email.split("@")[1] ?? "unknown";
      (sendersByDomain[dom] ??= []).push(s);
    }
    type DomainAgg = { workspace_slug: string; domain: string; avgScore: number | null; lowHealth: boolean; hasActive: boolean; senders: number };
    const domainAggs: DomainAgg[] = Object.entries(sendersByDomain).map(([dom, list]) => {
      const reachableScored = list.filter(s => s.conn_status !== "Not connected" && hasScore(s));
      const avg = reachableScored.length > 0
        ? Math.round(reachableScored.reduce((a, s) => a + (s.warmup_score as number), 0) / reachableScored.length * 10) / 10
        : null;
      const hasActive = list.some(s => (s.attached_campaigns_count ?? 0) > 0);
      return {
        workspace_slug: list[0].workspace_slug,
        domain:         dom,
        avgScore:       avg,
        lowHealth:      hasActive && avg !== null && avg < LOW_HEALTH_THRESHOLD,
        hasActive,
        senders:        list.length,
      };
    });
    const lowHealthDomainSet = new Set(domainAggs.filter(d => d.lowHealth).map(d => `${d.workspace_slug}::${d.domain}`));
    const sendersInLowHealthDomain = (s: SenderRow) =>
      lowHealthDomainSet.has(`${s.workspace_slug}::${s.sender_email.split("@")[1] ?? "unknown"}`);

    // "Warming only" = sender is not attached to any active outbound
    // campaign (attached_campaigns_count = 0). This is the inverse of "in
    // outbound campaigns" and is what the per-workspace Warming-only tab
    // filters on. ready_to_rejoin is the stricter subset: 14+ days since
    // warming_since was set by Remove + warmup.
    const isWarmingOnly = (s: SenderRow) => (s.attached_campaigns_count ?? 0) === 0;
    const summary = {
      totalSenders:      senders.length,
      notWarming:        senders.filter(s => !s.warmup_enabled).length,
      warmingOnly:       senders.filter(isWarmingOnly).length,
      readyToRejoin:     senders.filter(s => s.ready_to_rejoin).length,
      lowHealthDomains:  lowHealthDomainSet.size,
      warmupHealthAvg:   avgScore,
    };

    type WsAgg = {
      slug:              string;
      total:             number;
      active:            number;
      notWarming:        number;
      warmingOnly:       number;
      readyToRejoin:     number;
      lowHealthDomains:  number;
      warmupHealthAvg:   number | null;
    };
    const wsMap: Record<string, WsAgg> = {};
    const wsScoreSums: Record<string, { sum: number; count: number }> = {};
    for (const s of senders) {
      const w = wsMap[s.workspace_slug] ?? (wsMap[s.workspace_slug] = {
        slug: s.workspace_slug, total: 0, active: 0, notWarming: 0, warmingOnly: 0,
        readyToRejoin: 0, lowHealthDomains: 0, warmupHealthAvg: null,
      });
      w.total++;
      if ((s.attached_campaigns_count ?? 0) > 0) w.active++;
      if (!s.warmup_enabled)         w.notWarming++;
      if (isWarmingOnly(s))          w.warmingOnly++;
      if (s.ready_to_rejoin)         w.readyToRejoin++;
      if (hasScore(s)) {
        const slot = wsScoreSums[s.workspace_slug] ?? (wsScoreSums[s.workspace_slug] = { sum: 0, count: 0 });
        slot.sum += s.warmup_score as number;
        slot.count++;
      }
    }
    for (const d of domainAggs) {
      if (d.lowHealth) wsMap[d.workspace_slug].lowHealthDomains++;
    }
    for (const slug of Object.keys(wsMap)) {
      const slot = wsScoreSums[slug];
      if (slot && slot.count > 0) {
        wsMap[slug].warmupHealthAvg = Math.round(slot.sum / slot.count * 10) / 10;
      }
    }
    // Priority sort: workspaces with not-warming senders first (most urgent),
    // then workspaces with at least one low-health domain (domain avg below
    // 98% — the planned Pause-outbound trigger), then everything else by
    // average warmup health ascending so the workspaces closest to the
    // threshold show before the fully healthy ones. Null avg (no senders
    // scored yet) goes to the bottom.
    const workspaces = Object.values(wsMap).sort((a, b) => {
      if (b.notWarming !== a.notWarming) return b.notWarming - a.notWarming;
      if (b.lowHealthDomains !== a.lowHealthDomains) return b.lowHealthDomains - a.lowHealthDomains;
      const avgA = a.warmupHealthAvg ?? 101;
      const avgB = b.warmupHealthAvg ?? 101;
      if (avgA !== avgB) return avgA - avgB;
      return b.total - a.total;
    });

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
  return { totalSenders: 0, notWarming: 0, warmingOnly: 0, readyToRejoin: 0, lowHealthDomains: 0, warmupHealthAvg: null };
}
