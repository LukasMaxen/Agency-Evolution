import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { fetchAllWorkspacesMeetingsCount, fetchWorkspaceMeetingsCount } from "@/lib/airtable-meetings";

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
      WHERE slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
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

    // ── Totals ──────────────────────────────────────────────────────────────
    const sentTotal = await pool.query<{ sent: number; contacted: number }>(`
      SELECT
        COUNT(*)::int                              AS sent,
        COUNT(DISTINCT lead_email)::int            AS contacted
      FROM emails_sent
      WHERE sent_at BETWEEN $1 AND $2
      ${wsFilterSql}
    `, wsArgs);

    const replyTotal = await pool.query<{ replies: number; interested: number }>(`
      SELECT
        COUNT(*)::int                                                     AS replies,
        COUNT(*) FILTER (WHERE interested = TRUE)::int                    AS interested
      FROM replies
      WHERE received_at BETWEEN $1 AND $2
      ${wsFilterSql}
    `, wsArgs);

    const bounceTotal = await pool.query<{ bounced: number }>(`
      SELECT COUNT(*)::int AS bounced
      FROM email_bounces
      WHERE bounced_at BETWEEN $1 AND $2
      ${wsFilterSql}
    `, wsArgs);

    // ── Meetings (Airtable) ─────────────────────────────────────────────────
    let meetings = 0;
    const airtableKey = process.env.AIRTABLE_API_KEY;
    if (airtableKey) {
      try {
        if (isAll) {
          // Only count meetings for workspaces in our active set (matches
          // the workspaces filter above).
          const activeSlugs = workspaces.map(w => w.slug);
          const r = await fetchAllWorkspacesMeetingsCount(start, end, airtableKey, activeSlugs);
          meetings = r.total;
        } else {
          const r = await fetchWorkspaceMeetingsCount(workspaceParam, start, end, airtableKey);
          meetings = r ?? 0;
        }
      } catch (err: any) {
        console.error("[dashboard] meetings fetch failed:", err?.message ?? err);
      }
    }

    const t = {
      sent:       sentTotal.rows[0]?.sent       ?? 0,
      contacted:  sentTotal.rows[0]?.contacted  ?? 0,
      replies:    replyTotal.rows[0]?.replies   ?? 0,
      interested: replyTotal.rows[0]?.interested ?? 0,
      bounced:    bounceTotal.rows[0]?.bounced  ?? 0,
      meetings,
    };

    const rates = {
      reply_rate:        safeRate(t.replies,    t.sent),
      interested_rate:   safeRate(t.interested, t.replies),
      bounce_rate:       safeRate(t.bounced,    t.sent),
      conv_rate:         safeRate(t.meetings,   t.interested),
      emails_per_lead:   safeRatio(t.sent,      t.interested),
      emails_per_meeting:safeRatio(t.sent,      t.meetings),
    };

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

    return NextResponse.json({
      workspaces,
      workspace: workspaceParam,
      range: rangeParam,
      totals: t,
      rates,
      series,
    });
  } catch (err: any) {
    console.error("[dashboard] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
