import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  aggregateWorkspaceSuccess,
  getWorkspaceSuccess,
  getSuccessMetricConfig,
} from "@/lib/airtable-meetings";
import { fetchAggregateEBStats, fetchWorkspaceEBStats } from "@/lib/emailbison-stats";

// Main dashboard data, mirrors EmailBison's snapshot view but tailored for
// AI Reply Desk, no opens or unsubscribes tracked.
//
// Query params:
//   workspace = "all" | <workspace_slug>   default "all"
//   range     = "today" | "yesterday" | "7d" | "30d" | "all"   default "7d"
//
// Returns:
//   workspaces:   [{id, slug, name, color, initials}]   for the dropdown
//   totals:       { sent, contacted, replies, interested, bounced, meetings }
//   rates:        { reply_rate, interested_rate, bounce_rate, conv_rate,
//                   emails_per_lead, emails_per_meeting }
//   series:       [{ date: "YYYY-MM-DD", sent, replies, interested, bounced }]
//                 (Meetings deliberately not in series — Airtable does not
//                 expose per-day cheaply enough for live charts. Total only.)
//   range, workspace: echo back for the client.

interface RangeBounds { start: Date; end: Date; }

function resolveRange(range: string): RangeBounds {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  switch (range) {
    case "today": {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "yesterday": {
      start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);     end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "30d": {
      start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "all": {
      // Wide window. Anything older than ~3 years is rare in this system.
      const allStart = new Date("2024-01-01T00:00:00Z");
      return { start: allStart, end };
    }
    case "7d":
    default: {
      start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      return { start, end };
    }
  }
}

/**
 * Previous-period bounds for a given current range. Equal length to the
 * current range, immediately preceding it. Returns null for "all" since
 * there is no meaningful "before all-time".
 */
function resolvePreviousRange(range: string, current: RangeBounds): RangeBounds | null {
  if (range === "all") return null;
  const lengthMs = current.end.getTime() - current.start.getTime();
  const prevEnd   = new Date(current.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  return { start: prevStart, end: prevEnd };
}

function safeRate(num: number, den: number): number {
  if (den <= 0) return 0;
  return num / den;
}

function safeRatio(num: number, den: number): number {
  if (den <= 0) return 0;
  return num / den;
}

const PALETTE = [
  "#185FA5", "#0F6E56", "#7C3AED", "#B45309", "#DC2626",
  "#533AB7", "#0369A1", "#0F6E56", "#185FA5", "#9D174D",
  "#065F46", "#1E3A5F", "#6D28D9", "#92400E", "#0F766E",
  "#374151", "#7C2D12", "#1D4ED8", "#065F46", "#78350F",
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceParam = searchParams.get("workspace") ?? "all";
  const rangeParam     = searchParams.get("range")     ?? "7d";

  const { start, end } = resolveRange(rangeParam);

  try {
    // ── Workspaces list (always returned, drives the dropdown) ──────────────
    const wsResult = await pool.query<{
      id: string; slug: string; name: string; instanceUrl: string | null;
    }>(`
      SELECT id::text AS id, slug, name, email_bison_instance_url AS "instanceUrl"
      FROM workspaces
      WHERE slug NOT IN ('sro-consulting')
      ORDER BY name ASC
    `);
    const workspaces = wsResult.rows.map((row, i) => {
      const words = row.name.split(/[\s\-]+/).filter(Boolean);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : row.name.slice(0, 2).toUpperCase();
      return {
        id: row.id, slug: row.slug, name: row.name,
        instanceUrl: row.instanceUrl ?? "",
        color: PALETTE[i % PALETTE.length],
        initials,
      };
    });

    const isAll = workspaceParam === "all";
    const wsFilterSql = isAll ? "" : "AND workspace_slug = $3";
    const baseArgs: any[] = [start, end];
    const wsArgs:   any[] = isAll ? baseArgs : [...baseArgs, workspaceParam];

    // ── Totals (from EmailBison /api/workspaces/v1.1/stats) ─────────────────
    // Switched from internal DB queries to EB's stats endpoint so the
    // numbers reconcile with the CSM update and the EmailBison UI exactly.
    // Internal DB still drives the time-series chart below (visual only).
    const targetSlugs = isAll ? workspaces.map(w => w.slug) : [workspaceParam];
    const ebStats = await fetchAggregateEBStats(targetSlugs, start, end);

    // EB returns one stats blob per workspace; sum for the aggregate.
    // For the workspace=single case the aggregate IS that single workspace.
    const ebTotals = ebStats.total;
    const intMap: Record<string, number> = {};
    for (const slug of targetSlugs) {
      intMap[slug] = ebStats.byWorkspace[slug]?.interested ?? 0;
    }

    // "contacted" is not exposed by EB stats endpoint, so we still pull it
    // from our DB. This is the only KPI card derived from internal data;
    // it represents unique lead emails we have on file as sent-to in the
    // window. Acceptable divergence: it is for context, not reconciliation.
    const contactedRes = await pool.query<{ contacted: number }>(`
      SELECT COUNT(DISTINCT lead_email)::int AS contacted
      FROM emails_sent
      WHERE sent_at BETWEEN $1 AND $2
      ${wsFilterSql}
    `, wsArgs);

    // ── Conversions ─────────────────────────────────────────────────────────
    // For each workspace, "success" is either (a) the count from its
    // configured Airtable date field, or (b) its positive-reply count
    // (interested_proxy). The aggregate "Conversions" sums each workspace's
    // success according to its own definition.
    let conversions = 0;
    let conversionsBreakdown: Record<string, { count: number; label: string; type: string }> = {};
    let meetingsDebug: { key_present: boolean; error: string | null; window: { start: string; end: string } } = {
      key_present: false,
      error: null,
      window: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    };
    const airtableKey = process.env.AIRTABLE_API_KEY;
    meetingsDebug.key_present = Boolean(airtableKey);
    try {
      if (isAll) {
        const r = await aggregateWorkspaceSuccess(workspaces.map(w => w.slug), start, end, intMap, airtableKey);
        conversions = r.total;
        conversionsBreakdown = r.byWorkspace as Record<string, { count: number; label: string; type: string }>;
      } else {
        const intCount = intMap[workspaceParam] ?? 0;
        conversions = await getWorkspaceSuccess(workspaceParam, start, end, intCount, airtableKey);
        const cfg = getSuccessMetricConfig(workspaceParam);
        const basis = cfg.successType === "interested_proxy"
          ? { interested: intCount, multiplier: cfg.proxyConversionRate ?? 0.40 }
          : undefined;
        conversionsBreakdown = { [workspaceParam]: { count: conversions, label: cfg.successLabel, type: cfg.successType, basis } as any };
      }
    } catch (err: any) {
      meetingsDebug.error = err?.message ?? String(err);
      console.error("[dashboard] conversions fetch failed:", err?.message ?? err);
    }
    if (!airtableKey) {
      console.error("[dashboard] AIRTABLE_API_KEY missing in env — airtable-tracked conversions will be 0");
    }

    const t = {
      sent:        ebTotals.emails_sent,
      contacted:   contactedRes.rows[0]?.contacted ?? 0,
      replies:     ebTotals.unique_replies_per_contact,
      interested:  ebTotals.interested,
      bounced:     ebTotals.bounced,
      // "meetings" kept as the legacy field name in the response for
      // backwards compat with anything that might still read it. The new
      // semantically-correct name is `conversions`.
      meetings:    conversions,
      conversions,
    };

    const rates = {
      reply_rate:           safeRate(t.replies,     t.sent),
      interested_rate:      safeRate(t.interested,  t.replies),
      bounce_rate:          safeRate(t.bounced,     t.sent),
      conv_rate:            safeRate(t.conversions, t.interested),
      emails_per_lead:      safeRatio(t.sent,       t.interested),
      emails_per_meeting:   safeRatio(t.sent,       t.conversions),
      emails_per_conversion:safeRatio(t.sent,       t.conversions),
    };

    // Per-workspace success label (used by the UI for the card label).
    const successLabel = isAll
      ? "Conversions"
      : getSuccessMetricConfig(workspaceParam).successLabel;

    // ── Previous-period totals (for Shopify-style change indicators) ────────
    // Equal-length window immediately preceding the current one. Skipped
    // for range=all since there is no meaningful prior period.
    let previousPayload: null | {
      window: { start: string; end: string };
      totals: typeof t;
      rates: typeof rates;
    } = null;
    const prevBounds = resolvePreviousRange(rangeParam, { start, end });
    if (prevBounds) {
      const prevWsArgs = isAll ? [prevBounds.start, prevBounds.end] : [prevBounds.start, prevBounds.end, workspaceParam];

      // Previous-period EB stats + contacted (DB).
      const [prevEbStats, prevContactedRes] = await Promise.all([
        fetchAggregateEBStats(targetSlugs, prevBounds.start, prevBounds.end),
        pool.query<{ contacted: number }>(`
          SELECT COUNT(DISTINCT lead_email)::int AS contacted
          FROM emails_sent WHERE sent_at BETWEEN $1 AND $2 ${wsFilterSql}
        `, prevWsArgs),
      ]);
      const prevIntMap: Record<string, number> = {};
      for (const slug of targetSlugs) {
        prevIntMap[slug] = prevEbStats.byWorkspace[slug]?.interested ?? 0;
      }

      let prevConversions = 0;
      try {
        if (isAll) {
          const r = await aggregateWorkspaceSuccess(workspaces.map(w => w.slug), prevBounds.start, prevBounds.end, prevIntMap, airtableKey);
          prevConversions = r.total;
        } else {
          prevConversions = await getWorkspaceSuccess(workspaceParam, prevBounds.start, prevBounds.end, prevIntMap[workspaceParam] ?? 0, airtableKey);
        }
      } catch (err: any) {
        console.error("[dashboard] previous-period conversions failed:", err?.message ?? err);
      }

      const pt = {
        sent:        prevEbStats.total.emails_sent,
        contacted:   prevContactedRes.rows[0]?.contacted ?? 0,
        replies:     prevEbStats.total.unique_replies_per_contact,
        interested:  prevEbStats.total.interested,
        bounced:     prevEbStats.total.bounced,
        meetings:    prevConversions,
        conversions: prevConversions,
      };
      const pr = {
        reply_rate:           safeRate(pt.replies,     pt.sent),
        interested_rate:      safeRate(pt.interested,  pt.replies),
        bounce_rate:          safeRate(pt.bounced,     pt.sent),
        conv_rate:            safeRate(pt.conversions, pt.interested),
        emails_per_lead:      safeRatio(pt.sent,       pt.interested),
        emails_per_meeting:   safeRatio(pt.sent,       pt.conversions),
        emails_per_conversion:safeRatio(pt.sent,       pt.conversions),
      };
      previousPayload = {
        window: { start: prevBounds.start.toISOString().slice(0, 10), end: prevBounds.end.toISOString().slice(0, 10) },
        totals: pt,
        rates: pr,
      };
    }

    // ── Time-series (daily buckets) ─────────────────────────────────────────
    // Generate a UTC date series so empty days appear as zeros in the chart.
    const dayCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const cap = Math.min(dayCount, 365); // safety, "all" range otherwise

    const sentSeries = await pool.query<{ d: string; n: number }>(`
      SELECT to_char(sent_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
      FROM emails_sent
      WHERE sent_at BETWEEN $1 AND $2
      ${wsFilterSql}
      GROUP BY d
    `, wsArgs);

    const replySeries = await pool.query<{ d: string; n: number; i: number }>(`
      SELECT
        to_char(received_at::date, 'YYYY-MM-DD') AS d,
        COUNT(*)::int                            AS n,
        COUNT(*) FILTER (WHERE interested = TRUE)::int AS i
      FROM replies
      WHERE received_at BETWEEN $1 AND $2
        AND tracked_reply IS NOT FALSE
      ${wsFilterSql}
      GROUP BY d
    `, wsArgs);

    const bounceSeries = await pool.query<{ d: string; n: number }>(`
      SELECT to_char(bounced_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
      FROM email_bounces
      WHERE bounced_at BETWEEN $1 AND $2
      ${wsFilterSql}
      GROUP BY d
    `, wsArgs);

    const sentByDay   = new Map(sentSeries.rows.map(r => [r.d, r.n]));
    const replyByDay  = new Map(replySeries.rows.map(r => [r.d, r.n]));
    const intByDay    = new Map(replySeries.rows.map(r => [r.d, r.i]));
    const bounceByDay = new Map(bounceSeries.rows.map(r => [r.d, r.n]));

    const series: Array<{ date: string; sent: number; replies: number; interested: number; bounced: number }> = [];
    for (let i = 0; i < cap; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const ds = d.toISOString().slice(0, 10);
      if (d > end) break;
      series.push({
        date: ds,
        sent:       sentByDay.get(ds)   ?? 0,
        replies:    replyByDay.get(ds)  ?? 0,
        interested: intByDay.get(ds)    ?? 0,
        bounced:    bounceByDay.get(ds) ?? 0,
      });
    }

    // Previous-period chart series, aligned by offset day-of-period so the
    // overlay sits under the current series at matching x positions.
    let previousSeries: Array<{ date: string; sent: number; replies: number; interested: number; bounced: number }> = [];
    if (prevBounds) {
      const prevWsArgs2 = isAll ? [prevBounds.start, prevBounds.end] : [prevBounds.start, prevBounds.end, workspaceParam];
      const [prevSentSeries, prevReplySeries, prevBounceSeries] = await Promise.all([
        pool.query<{ d: string; n: number }>(`
          SELECT to_char(sent_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
          FROM emails_sent WHERE sent_at BETWEEN $1 AND $2 ${wsFilterSql} GROUP BY d
        `, prevWsArgs2),
        pool.query<{ d: string; n: number; i: number }>(`
          SELECT to_char(received_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE interested = TRUE)::int AS i
          FROM replies WHERE received_at BETWEEN $1 AND $2 AND tracked_reply IS NOT FALSE ${wsFilterSql} GROUP BY d
        `, prevWsArgs2),
        pool.query<{ d: string; n: number }>(`
          SELECT to_char(bounced_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
          FROM email_bounces WHERE bounced_at BETWEEN $1 AND $2 ${wsFilterSql} GROUP BY d
        `, prevWsArgs2),
      ]);
      const pSent = new Map(prevSentSeries.rows.map(r => [r.d, r.n]));
      const pRep  = new Map(prevReplySeries.rows.map(r => [r.d, r.n]));
      const pInt  = new Map(prevReplySeries.rows.map(r => [r.d, r.i]));
      const pBnc  = new Map(prevBounceSeries.rows.map(r => [r.d, r.n]));
      for (let i = 0; i < cap; i++) {
        const d = new Date(prevBounds.start.getTime() + i * 24 * 60 * 60 * 1000);
        const ds = d.toISOString().slice(0, 10);
        if (d > prevBounds.end) break;
        previousSeries.push({
          date: ds,
          sent:       pSent.get(ds) ?? 0,
          replies:    pRep.get(ds)  ?? 0,
          interested: pInt.get(ds)  ?? 0,
          bounced:    pBnc.get(ds)  ?? 0,
        });
      }
    }

    return NextResponse.json({
      workspaces,
      workspace: workspaceParam,
      range: rangeParam,
      totals: t,
      rates,
      successLabel,
      conversionsBreakdown,
      series,
      previous: previousPayload ? { ...previousPayload, series: previousSeries } : null,
      meta: { meetings: meetingsDebug },
    });
  } catch (err: any) {
    console.error("[dashboard] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
