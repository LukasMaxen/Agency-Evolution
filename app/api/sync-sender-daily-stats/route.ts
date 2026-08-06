import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/sync-sender-daily-stats?workspace=slug  (or omit for all workspaces)
//
// Pulls each sender's real day-by-day Sent/Bounced/Replied/Opened/
// Interested/Unsubscribed history from EB's /api/campaign-events/stats --
// the only EB endpoint that accepts both a sender_email_ids[] filter AND a
// date range, returning a genuine per-date breakdown per sender. Upserts
// into sender_daily_stats, which app/api/account-monitor/route.ts reads
// from instead of calling EB live on every page load.
//
// One call per sender covering LOOKBACK_DAYS in one shot. A full sweep
// across every workspace at this granularity measured at ~1100 calls /
// ~50s against EB -- far too slow for a request, fine for a daily
// background job (see instrumentation.ts, "sender daily stats sync").
//
// Call this:
//  - On a schedule (instrumentation.ts, daily)
//  - From the Account Monitor UI "Sync" button, for an immediate refresh

const LOOKBACK_DAYS = 32; // covers the 30d UI option with a day of margin

function toYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}

interface EventSeries {
  label: string;
  dates: [string, number][];
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetSlug = searchParams.get("workspace");

  try {
    const wsQuery = targetSlug
      ? "SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1"
      : "SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces WHERE email_bison_api_key IS NOT NULL ORDER BY slug";
    const wsResult = await pool.query(wsQuery, targetSlug ? [targetSlug] : []);

    if (wsResult.rows.length === 0) {
      return NextResponse.json({ error: "No workspaces found" }, { status: 404 });
    }

    const endYmd   = toYmd(new Date());
    const startYmd = toYmd(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

    const results: { workspace: string; senders: number; rowsUpserted: number; failed: number; error?: string }[] = [];

    for (const ws of wsResult.rows) {
      const { slug, email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = ws;
      if (!apiKey || !instanceUrl) {
        results.push({ workspace: slug, senders: 0, rowsUpserted: 0, failed: 0, error: "Missing EB credentials" });
        continue;
      }

      try {
        const sendersRes = await pool.query(
          `SELECT email, eb_sender_id FROM sender_accounts
           WHERE workspace_slug = $1
             AND provider_type IS NOT NULL
             AND provider_type !~* '(microsoft|office365|outlook)'
             AND eb_sender_id IS NOT NULL`,
          [slug]
        );

        let rowsUpserted = 0;
        let failed = 0;

        await Promise.all(sendersRes.rows.map(async (sender) => {
          try {
            const url = `${instanceUrl}/api/campaign-events/stats?start_date=${startYmd}&end_date=${endYmd}&sender_email_ids[]=${sender.eb_sender_id}`;
            const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
            if (!r.ok) { failed++; return; }
            const body = await r.json();
            const series: EventSeries[] = body?.data ?? [];

            const byLabel = (label: string) => series.find(s => s.label === label);
            const sentSeries       = byLabel("Sent");
            const bouncedSeries    = byLabel("Bounced");
            const repliedSeries    = byLabel("Replied");
            const openedSeries     = byLabel("Unique Opens");
            const interestedSeries = byLabel("Interested");
            const unsubSeries      = byLabel("Unsubscribed");

            // Sent is the anchor series -- every date bucket EB returns for
            // this sender comes from it. The other series share the same
            // date axis, so look values up by date rather than assuming
            // identical array ordering/length.
            if (!sentSeries) return;
            const valueAt = (series: EventSeries | undefined, date: string) =>
              series?.dates.find(([d]) => d === date)?.[1] ?? 0;

            for (const [date, sent] of sentSeries.dates) {
              await pool.query(
                `INSERT INTO sender_daily_stats
                   (workspace_slug, sender_email, eb_sender_id, date, sent, bounced, replied, opened, interested, unsubscribed, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
                 ON CONFLICT (workspace_slug, sender_email, date)
                 DO UPDATE SET
                   sent = EXCLUDED.sent, bounced = EXCLUDED.bounced, replied = EXCLUDED.replied,
                   opened = EXCLUDED.opened, interested = EXCLUDED.interested,
                   unsubscribed = EXCLUDED.unsubscribed, synced_at = NOW()`,
                [
                  slug, sender.email.toLowerCase(), sender.eb_sender_id, date, sent,
                  valueAt(bouncedSeries, date), valueAt(repliedSeries, date), valueAt(openedSeries, date),
                  valueAt(interestedSeries, date), valueAt(unsubSeries, date),
                ]
              );
              rowsUpserted++;
            }
          } catch {
            failed++;
          }
        }));

        results.push({ workspace: slug, senders: sendersRes.rows.length, rowsUpserted, failed });
        console.log(`[sync-sender-daily-stats] ${slug}: ${sendersRes.rows.length} senders, ${rowsUpserted} rows upserted, ${failed} failed`);
      } catch (wsErr: any) {
        console.error(`[sync-sender-daily-stats] ${slug} failed:`, wsErr.message);
        results.push({ workspace: slug, senders: 0, rowsUpserted: 0, failed: 0, error: wsErr.message });
      }
    }

    return NextResponse.json({
      ok: true,
      synced: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      results,
    });
  } catch (err: any) {
    console.error("[sync-sender-daily-stats] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET -- status: how fresh is the cache per workspace
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        workspace_slug,
        COUNT(DISTINCT sender_email)::int AS senders,
        MAX(synced_at)                    AS last_synced,
        MAX(date)                         AS latest_date
      FROM sender_daily_stats
      GROUP BY workspace_slug
      ORDER BY workspace_slug
    `);
    return NextResponse.json({ workspaces: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
