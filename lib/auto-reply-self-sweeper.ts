import pool from "@/lib/db";

// In-process sweep: pulls any reply stuck at status='new' within the last 24h
// and runs the auto-reply processor on it. Single-flight via `running` so two
// overlapping ticks don't double-process. The atomic claim inside
// processAutoReply also makes this safe across multiple Node instances.
//
// Lazy-imports the processor to keep the import graph at module load time
// minimal (instrumentation runs early in the server boot).

let running = false;

export async function runAutoReplySweep(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const { processAutoReply } = await import("@/app/api/auto-reply/processor");
    const { postToSlack, MANUAL_REPLIES_CHANNEL } = await import("@/lib/slack-approval");

    // Alert on any replies stuck at 'new' for >24h — these are permanently excluded
    // from auto-processing and need manual attention.
    const stale = await pool.query(
      `SELECT id, workspace_slug, lead_name, lead_email, received_at
       FROM replies
       WHERE status = 'new'
         AND received_at <= NOW() - INTERVAL '24 hours'
       LIMIT 10`
    );
    for (const row of stale.rows) {
      console.warn(`[self-sweep] Stale reply >24h: ${row.workspace_slug} / ${row.lead_name} <${row.lead_email}> received ${row.received_at}`);
      await pool.query(`UPDATE replies SET status = 'errored' WHERE id = $1`, [row.id]);
      await postToSlack({
        channel: MANUAL_REPLIES_CHANNEL,
        text: `Reply stuck >24h and auto-dropped, needs manual handling`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Reply stuck >24h, needs manual handling", emoji: true } },
          { type: "section", fields: [
            { type: "mrkdwn", text: `*Client:*\n${row.workspace_slug}` },
            { type: "mrkdwn", text: `*Lead:*\n${row.lead_name ?? "unknown"} <${row.lead_email}>` },
          ]},
          { type: "section", text: { type: "mrkdwn", text: `Reply received at ${new Date(row.received_at).toISOString()} was never processed. Marked errored. Open EmailBison and reply manually.\n\nTo re-queue: \`UPDATE replies SET status='new' WHERE id='${row.id}';\`` }},
        ],
      }).catch(e => console.error("[self-sweep] Failed to post stale reply alert:", e));
    }

    const r = await pool.query(
      `SELECT id, workspace_slug
       FROM replies
       WHERE status = 'new'
         AND received_at > NOW() - INTERVAL '24 hours'
       ORDER BY received_at ASC
       LIMIT 20`
    );

    if (r.rows.length === 0) return;

    let ok = 0;
    let fail = 0;
    for (const row of r.rows) {
      try {
        await processAutoReply(row.id, row.workspace_slug);
        ok++;
      } catch (err: any) {
        fail++;
        console.error(
          `[self-sweep] FAIL ${row.workspace_slug} ${row.id}: ${err?.message ?? err}`
        );
      }
    }

    if (ok > 0 || fail > 0) {
      console.log(`[self-sweep] processed ok=${ok} fail=${fail} (total picked=${r.rows.length})`);
    }
  } finally {
    running = false;
  }
}
