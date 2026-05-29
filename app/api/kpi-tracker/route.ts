import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  aggregateWorkspaceSuccess,
  getWorkspaceSuccess,
  getSuccessMetricConfig,
} from "@/lib/airtable-meetings";

// KPI Tracker — replaces the weekly performance Google Sheet.
// Returns the calendar month split into 5 buckets:
//   Week 1: day 1-7
//   Week 2: day 8-14
//   Week 3: day 15-21
//   Week 4: day 22-28
//   Week 5: day 29-end of month  (length varies, may be empty if month has <29 days)
// Plus Month-To-Date totals.
//
// Query params:
//   workspace = "all" | <slug>           default "all"
//   year      = YYYY                     default current year
//   month     = 1..12                    default current month (UTC)

interface WeekBucket {
  label: string;          // "Week 1" .. "Week 5", "MTD"
  start: Date;
  end: Date;              // inclusive end-of-day
}

interface WeekKPIs {
  label: string;
  start: string;          // YYYY-MM-DD
  end:   string;          // YYYY-MM-DD
  totals: {
    sent: number;
    replies: number;
    interested: number;
    meetings: number;
  };
  efficiency: {
    reply_rate:        number; // replies / sent
    interested_rate:   number; // interested / replies
    conv_rate:         number; // meetings / interested
    emails_per_lead:   number; // sent / interested
    emails_per_meeting:number; // sent / meetings
  };
}

function buildWeekBuckets(year: number, month1to12: number): WeekBucket[] {
  // month1to12 is 1-indexed; JS Date month is 0-indexed
  const monthIdx = month1to12 - 1;
  const monthStart = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0, 0));
  const monthEnd   = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999));
  const lastDay = monthEnd.getUTCDate();

  // Mon-Sun weeks, clipped to month boundaries.
  // Week 1 = 1st of month through the first Sunday of that month.
  //          If the 1st IS a Sunday, Week 1 is just that single day.
  // Subsequent weeks = Mon-Sun. The final week may be partial if the
  // month does not end on a Sunday.
  const buckets: WeekBucket[] = [];
  let day = 1;
  let weekNumber = 0;
  while (day <= lastDay) {
    weekNumber++;
    // JS getUTCDay: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
    // For Mon-Sun weeks, we want to find the next Sunday from `day` (inclusive).
    const dow = new Date(Date.UTC(year, monthIdx, day)).getUTCDay();
    const daysUntilSunday = (7 - dow) % 7; // Sun (0) -> 0, Mon (1) -> 6, ..., Sat (6) -> 1
    const endDay = Math.min(day + daysUntilSunday, lastDay);
    buckets.push({
      label: `Week ${weekNumber}`,
      start: new Date(Date.UTC(year, monthIdx, day, 0, 0, 0, 0)),
      end:   new Date(Date.UTC(year, monthIdx, endDay, 23, 59, 59, 999)),
    });
    day = endDay + 1;
  }

  // MTD covers the full month start through min(today, monthEnd)
  const nowUtc = new Date();
  const cappedEnd = nowUtc < monthEnd ? nowUtc : monthEnd;
  buckets.push({ label: "MTD", start: monthStart, end: cappedEnd });

  return buckets;
}

function safeRate(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}
function safeRatio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceParam = searchParams.get("workspace") ?? "all";
  const now = new Date();
  const year  = Number(searchParams.get("year")  ?? now.getUTCFullYear());
  const month = Number(searchParams.get("month") ?? now.getUTCMonth() + 1);

  if (!Number.isFinite(year)  || year  < 2024 || year  > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  if (!Number.isFinite(month) || month < 1    || month > 12) {
    return NextResponse.json({ error: "invalid month" }, { status: 400 });
  }

  const buckets = buildWeekBuckets(year, month);
  const isAll = workspaceParam === "all";
  const apiKey = process.env.AIRTABLE_API_KEY;

  try {
    // Workspaces list, drives the dropdown (matches /api/dashboard).
    const wsResult = await pool.query<{ slug: string; name: string }>(`
      SELECT slug, name FROM workspaces
      WHERE slug NOT IN ('sro-consulting')
      ORDER BY name ASC
    `);
    const workspaces = wsResult.rows;
    const activeSlugs = workspaces.map(w => w.slug);

    // For each bucket, run the four DB queries + one meetings fetch.
    // Buckets typically = 6 (5 weeks + MTD). Parallel for speed.
    const wsFilterSql = isAll ? "" : "AND workspace_slug = $3";

    const bucketResults: WeekKPIs[] = await Promise.all(buckets.map(async (b) => {
      const args = isAll ? [b.start, b.end] : [b.start, b.end, workspaceParam];

      const [sentRes, replyRes, intPerWsRes] = await Promise.all([
        pool.query<{ sent: number }>(`
          SELECT COUNT(*)::int AS sent
          FROM emails_sent
          WHERE sent_at BETWEEN $1 AND $2
          ${wsFilterSql}
        `, args),
        pool.query<{ replies: number; interested: number }>(`
          SELECT COUNT(*)::int AS replies,
                 COUNT(*) FILTER (WHERE interested = TRUE)::int AS interested
          FROM replies
          WHERE received_at BETWEEN $1 AND $2
            AND tracked_reply IS NOT FALSE
          ${wsFilterSql}
        `, args),
        pool.query<{ slug: string; n: number }>(`
          SELECT workspace_slug AS slug,
                 COUNT(*) FILTER (WHERE interested = TRUE)::int AS n
          FROM replies
          WHERE received_at BETWEEN $1 AND $2
            AND tracked_reply IS NOT FALSE
          ${wsFilterSql}
          GROUP BY workspace_slug
        `, args),
      ]);

      const intMap: Record<string, number> = {};
      for (const row of intPerWsRes.rows) intMap[row.slug] = row.n;

      let conversions = 0;
      try {
        if (isAll) {
          const r = await aggregateWorkspaceSuccess(activeSlugs, b.start, b.end, intMap, apiKey);
          conversions = r.total;
        } else {
          conversions = await getWorkspaceSuccess(workspaceParam, b.start, b.end, intMap[workspaceParam] ?? 0, apiKey);
        }
      } catch (err: any) {
        console.error(`[kpi-tracker] conversions fetch failed for ${b.label}:`, err?.message ?? err);
      }

      const totals = {
        sent: sentRes.rows[0]?.sent ?? 0,
        replies: replyRes.rows[0]?.replies ?? 0,
        interested: replyRes.rows[0]?.interested ?? 0,
        meetings: conversions, // kept as legacy key for UI compat
      };

      const efficiency = {
        reply_rate:         safeRate(totals.replies, totals.sent),
        interested_rate:    safeRate(totals.interested, totals.replies),
        conv_rate:          safeRate(conversions, totals.interested),
        emails_per_lead:    safeRatio(totals.sent, totals.interested),
        emails_per_meeting: safeRatio(totals.sent, conversions),
      };

      return {
        label: b.label,
        start: b.start.toISOString().slice(0, 10),
        end:   b.end.toISOString().slice(0, 10),
        totals,
        efficiency,
      };
    }));

    // Per-workspace success label for the UI (single-workspace view).
    const successLabel = isAll
      ? "Conversions"
      : getSuccessMetricConfig(workspaceParam).successLabel;

    return NextResponse.json({
      workspaces,
      workspace: workspaceParam,
      year,
      month,
      successLabel,
      buckets: bucketResults,
      meta: { key_present: Boolean(apiKey) },
    });
  } catch (err: any) {
    console.error("[kpi-tracker] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
