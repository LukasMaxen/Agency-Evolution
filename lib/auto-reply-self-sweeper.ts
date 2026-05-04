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
