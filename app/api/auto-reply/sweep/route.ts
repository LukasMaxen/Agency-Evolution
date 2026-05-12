import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Cron-driven safety net for the LEAD_REPLIED webhook. Picks up any reply
// stuck at status='new' within the last 24 hours and runs the auto-reply
// processor on it. The atomic claim inside processAutoReply makes this safe
// to call concurrently with the webhook itself.
//
// Wire to a 60-second cron (Coolify scheduled task or external cron-job.org):
//   curl -fsS "$APP_URL/api/auto-reply/sweep?token=$AUTO_REPLY_SWEEP_TOKEN"
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.AUTO_REPLY_SWEEP_TOKEN;
  // If a token is configured, it must match. If no token is configured, allow the request
  // so external cron services can call this endpoint without needing Coolify env changes.
  if (expected && token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 100);

  const r = await pool.query(
    `SELECT id, workspace_slug, lead_email
     FROM replies
     WHERE status = 'new'
       AND received_at > NOW() - INTERVAL '24 hours'
     ORDER BY received_at ASC
     LIMIT $1`,
    [limit]
  );

  let ok = 0;
  let fail = 0;
  const failures: { reply_id: string; workspace: string; error: string }[] = [];

  for (const row of r.rows) {
    try {
      await processAutoReply(row.id, row.workspace_slug);
      ok++;
    } catch (err: any) {
      fail++;
      const msg = (err?.message ?? String(err)).slice(0, 300);
      failures.push({ reply_id: row.id, workspace: row.workspace_slug, error: msg });
      console.error(`[sweep] FAIL ${row.workspace_slug} ${row.lead_email}: ${msg}`);
    }
  }

  return NextResponse.json({
    found: r.rows.length,
    processed_ok: ok,
    processed_fail: fail,
    failures,
  });
}
