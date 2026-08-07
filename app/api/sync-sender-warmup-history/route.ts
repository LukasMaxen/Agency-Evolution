import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/sync-sender-warmup-history?workspace=slug  (or omit for all workspaces)
//
// For each active sender, pulls EB's warmup_score for four trailing
// periods (3/7/10/30 days, matching what EmailBison's own Sender Accounts
// dashboard shows) PLUS the same-length prior period, so a week-over-week
// (etc.) delta can be shown on the account monitor without any live EB
// calls at read time. Confirmed live that /api/warmup/sender-emails
// returns a genuinely different score for different date ranges (not just
// today's live score regardless of params requested).
//
// Call this:
//  - On a schedule (instrumentation.ts, daily)
//  - From the Account Monitor UI "Sync" button, for an immediate refresh

const PERIODS = [3, 7, 10, 30];

function toYmd(d: Date) {
  return d.toISOString().slice(0, 10);
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

    const today = new Date();
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

        // Same connection-pool lesson as sync-sender-daily-stats: cap
        // concurrency, don't fire every sender x every period at once.
        const SENDER_CONCURRENCY = 6;
        const queue = [...sendersRes.rows];
        const worker = async () => {
          while (queue.length > 0) {
            const sender = queue.shift();
            if (!sender) break;
            try {
              const values: any[] = [];
              let hadAnyScore = false;

              for (let i = 0; i < PERIODS.length; i++) {
                const periodDays = PERIODS[i];
                const currentEnd   = toYmd(today);
                const currentStart = toYmd(new Date(today.getTime() - periodDays * 24 * 60 * 60 * 1000));
                const priorEnd     = currentStart;
                const priorStart   = toYmd(new Date(today.getTime() - 2 * periodDays * 24 * 60 * 60 * 1000));

                const [currentRes, priorRes] = await Promise.all([
                  fetch(`${instanceUrl}/api/warmup/sender-emails?start_date=${currentStart}&end_date=${currentEnd}&search=${encodeURIComponent(sender.email)}&per_page=5`,
                    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }),
                  fetch(`${instanceUrl}/api/warmup/sender-emails?start_date=${priorStart}&end_date=${priorEnd}&search=${encodeURIComponent(sender.email)}&per_page=5`,
                    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }),
                ]);

                let currentScore: number | null = null;
                let priorScore: number | null = null;
                if (currentRes.ok) {
                  const j = await currentRes.json();
                  const row = (j.data || []).find((x: any) => x.id === sender.eb_sender_id);
                  currentScore = typeof row?.warmup_score === "number" && row.warmup_score > 0 ? row.warmup_score : null;
                }
                if (priorRes.ok) {
                  const j = await priorRes.json();
                  const row = (j.data || []).find((x: any) => x.id === sender.eb_sender_id);
                  priorScore = typeof row?.warmup_score === "number" && row.warmup_score > 0 ? row.warmup_score : null;
                }
                if (currentScore !== null) hadAnyScore = true;
                values.push(slug, sender.email.toLowerCase(), sender.eb_sender_id, currentScore, priorScore);
              }

              if (!hadAnyScore) continue;

              // 5 params per period: slug, sender_email, eb_sender_id,
              // current_score, prior_score. period_days is a literal
              // (from PERIODS[i], not user input) so it's safe to inline.
              await pool.query(
                `INSERT INTO sender_warmup_periods
                   (workspace_slug, sender_email, eb_sender_id, period_days, current_score, prior_score, synced_at)
                 VALUES ${PERIODS.map((periodDays, i) => {
                   const base = i * 5;
                   return `($${base + 1},$${base + 2},$${base + 3},${periodDays},$${base + 4},$${base + 5},NOW())`;
                 }).join(",")}
                 ON CONFLICT (workspace_slug, sender_email, period_days)
                 DO UPDATE SET
                   current_score = EXCLUDED.current_score,
                   prior_score   = EXCLUDED.prior_score,
                   synced_at     = NOW()`,
                values
              );
              rowsUpserted += PERIODS.length;
            } catch {
              failed++;
            }
          }
        };

        await Promise.all(Array.from({ length: SENDER_CONCURRENCY }, () => worker()));

        results.push({ workspace: slug, senders: sendersRes.rows.length, rowsUpserted, failed });
        console.log(`[sync-sender-warmup-history] ${slug}: ${sendersRes.rows.length} senders, ${rowsUpserted} rows upserted, ${failed} failed`);
      } catch (wsErr: any) {
        console.error(`[sync-sender-warmup-history] ${slug} failed:`, wsErr.message);
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
    console.error("[sync-sender-warmup-history] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET -- status: how fresh is the cache per workspace
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT workspace_slug, COUNT(DISTINCT sender_email)::int AS senders, MAX(synced_at) AS last_synced
      FROM sender_warmup_periods
      GROUP BY workspace_slug
      ORDER BY workspace_slug
    `);
    return NextResponse.json({ workspaces: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
